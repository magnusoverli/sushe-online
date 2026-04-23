# Database Layer Unification Plan

Addresses recommendations 1-4 from the DB interaction audit:

1. Unify query paths through a single interface
2. Preserve root-cause errors in `withTransaction`
3. Error classifier + targeted retry
4. Graceful shutdown (harden and verify — already partially implemented)

## Discoveries that shape the plan

- **Graceful shutdown is already wired up** in [index.js:381-385](index.js#L381) and [config/process-handlers.js:70-72](config/process-handlers.js#L70) — `pool.end()` runs on SIGTERM. Item 4 becomes "harden and verify" rather than "build from scratch."
- **`retry-wrapper.js` is misnamed** — it's a health check ([db/retry-wrapper.js](db/retry-wrapper.js)), no actual retry logic exists. Item 3 is greenfield.
- **155 direct `pool.query` calls across 28 files** (services + routes) — item 1's migration is substantial and must be phased.
- **Existing test infrastructure** supports both fast unit tests (mocked pool) and real-Postgres integration tests ([scripts/run-tests.sh](scripts/run-tests.sh) phase 2). We'll use both.

---

## Phase 0 — Baseline and safety nets (before touching code)

**Goal:** make regressions detectable.

1. Run `npm run test:all` on a clean checkout; capture the pass count (158 test files today) as the regression baseline.
2. Start the app locally against a dev DB, exercise the "golden paths" (login, open a list, add/reorder/delete list items, view stats, aggregate view). Note timings from `/metrics` (observeDbQuery) for a before/after comparison.
3. Create a feature branch `db-layer-unification`. Every phase below lands as a separate commit on this branch so we can bisect.

**Exit criterion:** green baseline captured, branch ready.

---

## Phase 1 — Preserve root-cause errors in `withTransaction`

**Smallest, most isolated change. Lands first.**

- **Change** [db/transaction.js:62-67](db/transaction.js#L62): wrap `ROLLBACK` in its own try/catch. If ROLLBACK throws, log the rollback failure (with context) but re-throw the original error.
- Also propagate the client connection's broken state: if ROLLBACK fails, the client may be poisoned — pass `{ destroy: true }` equivalent via `client.release(err)` so pg discards it rather than returning it to the pool.

**Tests** ([test/transaction.test.js](test/transaction.test.js)):

- New case: callback throws error A; ROLLBACK throws error B → `withTransaction` rejects with A; B is logged.
- New case: ROLLBACK throws → `client.release` is called with the error argument (so pg discards the connection).
- All existing 10 cases continue to pass unchanged.

**Verification:** unit tests green, no behavior change for the happy path or the previously-working error paths.

---

## Phase 2 — Error taxonomy module

Create [db/errors.js](db/errors.js), a pure classifier with no side effects. Greenfield, no callers change yet.

- **Export** `classify(err) → { kind: 'retryable' | 'constraint' | 'fatal' | 'unknown', code, retryAfterMs? }`.
- **Retryable** SQLSTATE codes: `40001` (serialization failure), `40P01` (deadlock), `08006`/`08003`/`08000` (connection failure), `57P01`/`57P02`/`57P03` (admin shutdown/crash), `53300` (too many connections), plus Node-level `ECONNRESET`/`ETIMEDOUT`.
- **Constraint** (never retry, surface to caller): `23505` (unique), `23503` (FK), `23502` (not null), `23514` (check), `22P02` (invalid text rep).
- **Fatal** (operational, don't retry, alert): `42P01` (undefined table), `42703` (undefined column), `42601` (syntax).
- **Unknown** fallback.

**Tests** ([test/db-errors.test.js](test/db-errors.test.js) — new file):

- Table-driven: each known code → expected kind. ~25 cases covering every code listed above plus an unknown code plus a plain `Error`.
- Guard test: classify does not mutate its input.

**Verification:** new test file passes; no production code references this module yet, so nothing can regress.

---

## Phase 3 — Retry helper built on the classifier

Add `withRetry(fn, opts)` to [db/retry-wrapper.js](db/retry-wrapper.js) (keep `healthCheck` export for backward compatibility).

- Contract: `withRetry(fn, { retries = 3, baseMs = 50, maxMs = 1000, jitter = true, classify = defaultClassify })`.
- Uses `classify()` from Phase 2. Only `retryable` errors retry; all others throw immediately.
- Exponential backoff with full-jitter: `delay = random(0, min(maxMs, baseMs * 2^attempt))`.
- **Idempotency guard:** `withRetry` accepts `{ idempotent: true }` — if `false`, retries are only allowed before the first query executes (connection-level failures). Default: `false`. This prevents retrying a half-completed multi-statement transaction.
- Logs every retry with attempt number, error code, and delay.

**Tests** ([test/retry-helper.test.js](test/retry-helper.test.js) — new file):

- Happy path: fn succeeds on first try → called once.
- Retry then succeed: throws `40001` twice then succeeds → 3 calls, 2 backoff delays, returns value.
- Non-retryable: throws `23505` → 1 call, re-throws immediately.
- Exhaustion: throws `40001` 4 times → 4 calls, final error re-thrown.
- Non-idempotent with post-first-call error: throws `40001` after simulated "query ran" marker → no retry (guards against double-writes).
- Backoff: use fake timers to assert delays are within `[0, baseMs * 2^n]`.

**Verification:** new test file passes, existing retry-wrapper tests still pass.

---

## Phase 4 — Unified query interface

Add two new methods to [db/postgres.js](db/postgres.js) and wire them through `PgDatastore`.

- **`PgDatastore.raw(sql, params, { name, retryable = false } = {})`** — a first-class escape hatch with the same logging, metrics (`observeDbQuery`), and optional prepared-statement name as existing `_query`/`_preparedQuery`. If `retryable: true`, wraps the call in `withRetry` using `idempotent: true`.
- **`PgDatastore.withClient(cb, { retryable = false } = {})`** — for multi-statement non-transactional work on a single connection. Acquires → cb(client) → releases (with error-aware release).
- **`PgDatastore.withTransaction(cb, { retryable = false, isolation } = {})`** — thin wrapper over [db/transaction.js](db/transaction.js) that adds classifier-aware retry on serialization/deadlock errors and optional `SET TRANSACTION ISOLATION LEVEL ...`. This is what services will call in future instead of importing `withTransaction` directly (the standalone helper stays for backward compat).

**No callsites change in this phase.** The existing `find`/`findOne`/`insert`/`update`/`remove` routes internally go through the same metrics path — unchanged.

**Tests** (extend [test/postgres.test.js](test/postgres.test.js)):

- `raw()` emits metrics (assert `observeDbQuery` called with correct operation).
- `raw()` with `name` uses prepared statement path (pg `query({name, text})`).
- `raw()` with `retryable: true` retries on `40001` and surfaces final result.
- `raw()` does NOT retry on `23505`.
- `withClient` releases on success, releases with error on failure.
- `withTransaction` retries on serialization failure up to limit, then fails.
- A new integration test [test/db-raw-integration.test.js](test/db-raw-integration.test.js) (in the integration list in [scripts/run-tests.sh](scripts/run-tests.sh)): runs `raw()` against real Postgres, forces a deadlock between two concurrent transactions, asserts retry resolves it.

**Verification:** unit + integration tests green. Full suite still green (no callers changed).

---

## Phase 5 — Harden graceful shutdown

Shutdown exists; the goal here is to make it trustworthy under load.

- In [db/index.js](db/index.js), export `closePool(opts)` that:
  1. Sets a "draining" flag so new `PgDatastore` calls reject fast with `SHUTTING_DOWN` (pre-empts 5-min client wait).
  2. `await pool.end()` — pg waits for in-flight queries to finish.
  3. Timeout-bounded: if pool doesn't drain within `opts.timeoutMs` (default 8000, leaving 2s headroom within the 10s force-exit in [config/process-handlers.js:24](config/process-handlers.js#L24)), log the stuck clients and resolve anyway so SIGTERM can proceed.
- Replace the inline `pool.end()` in [index.js:382-384](index.js#L382) with `await closePool()`.

**Tests:**

- Unit ([test/close-pool.test.js](test/close-pool.test.js) — new): mock pool; assert drain flag blocks new queries; assert timeout path still resolves if pool.end hangs (use fake timers).
- Existing [test/process-handlers.test.js](test/process-handlers.test.js) (if present — check first) gains a case: SIGTERM triggers `closeDatabasePool` which calls our new helper.
- Integration smoke (manual or scripted in a `scripts/smoke-shutdown.sh`): start app, kick off 5 long-running `raw()` queries, send SIGTERM, assert all 5 complete and exit code is 0 within 10 s. Repeatable and cheap to run locally.

**Verification:** SIGTERM during load → no partial transactions logged, exit 0 within budget.

---

## Phase 6 — Migrate callsites to the unified interface

**This is 28 files, 155 calls. We phase it so each step is reviewable and reversible.**

Order by blast radius (lowest first):

1. **Read-only/analytics** first: [services/stats-service.js](services/stats-service.js), [services/admin-events.js](services/admin-events.js), [services/admin-backup-service.js](services/admin-backup-service.js), [services/aggregate-list.js](services/aggregate-list.js), [services/aggregate-audit/](services/aggregate-audit/). Rewrite each `pool.query(...)` to the appropriate datastore's `.raw()` (pick by primary table). Run full test suite after each file.
2. **Per-user writes**: [services/auth-service.js](services/auth-service.js), [services/user-service.js](services/user-service.js) (if it has direct calls), [services/preference-sync.js](services/preference-sync.js), [routes/api/user.js](routes/api/user.js), [routes/admin/bootstrap.js](routes/admin/bootstrap.js).
3. **List/album hot paths**: [services/list-service.js](services/list-service.js), [services/list/setup-status.js](services/list/setup-status.js), [services/album-service.js](services/album-service.js), [services/album-summary.js](services/album-summary.js), [services/group-service.js](services/group-service.js), [services/duplicate-service.js](services/duplicate-service.js).
4. **Background workers** (lowest user impact, highest risk of hidden behavior): [services/cover-fetch-queue.js](services/cover-fetch-queue.js), [services/image-refetch.js](services/image-refetch.js), [services/playcount-service.js](services/playcount-service.js), [services/playcount-sync-service.js](services/playcount-sync-service.js), [services/catalog-cleanup.js](services/catalog-cleanup.js), [services/recommendation-service.js](services/recommendation-service.js), [services/reidentify-service.js](services/reidentify-service.js), [services/external-identity-service.js](services/external-identity-service.js), [services/telegram/](services/telegram/).

For each file:

- Replace `pool.query(sql, params)` → `<datastore>.raw(sql, params, { name: 'descriptive-name' })`. Choose the datastore by the table that dominates the query; if unclear, use `users` (any datastore works — same pool).
- Replace ad-hoc `pool.connect()`/BEGIN patterns with `datastore.withTransaction(...)`.
- Flag `retryable: true` only on idempotent reads and idempotent upserts (`INSERT ... ON CONFLICT`). Multi-statement writes stay non-retryable unless we prove idempotency.
- Add a `name` for repeat-hit queries — pg's prepared-statement cache becomes effective.

**Tests per file-group:**

- Existing unit tests (mocked datastore) should continue to pass because `raw` is a new method and service tests that mock `users.findOne` etc. still work — but if a service test mocks `pool.query` directly, update the mock to the datastore's `raw`. Expect ~10-15 test files to need the mock swap.
- For each file-group in phase 6, run `node --test test/<matching-file>.test.js` plus the full suite. No file-group commits unless the full suite is green.
- Integration suite ([scripts/run-tests.sh](scripts/run-tests.sh) phase 2) runs on every commit.

**Rollback strategy:** every commit is a single file (or small file group). If a regression surfaces post-merge, `git revert <sha>` restores the file without unwinding the whole effort.

---

## Phase 7 — Final validation gate

Before merging to `main`:

1. `npm run test:all` green.
2. Integration suite green with real Postgres (`TEST_DATABASE_URL` set).
3. Playwright e2e green (`npm run test:e2e`).
4. Re-run the Phase 0 golden-path workflow; compare `/metrics` DB query timings — regressions > 10% on any operation get investigated.
5. Shutdown smoke script passes.
6. `grep -rn "pool\.query\|pool\.connect" services/ routes/ | wc -l` returns 0 (or a justified allowlist).
7. Manual `git log --stat` review — each commit should be small, single-purpose, reversible.

**Deploy strategy:** merge to `main`, deploy to staging (if present) or keep the branch alive for one cycle before flipping. Monitor `/metrics` and logs for `db.retry` / `db.rollback_failed` events for 24 h post-deploy.

---

## What this plan is NOT doing

- **Not extending `_buildWhere`** (item 5 from the audit). Adding `$in`/`$or` is an independent improvement; bundling it here bloats the PR.
- **Not replacing `SELECT *`** (item 6). Also independent; do it after, per table, driven by profiling.
- **Not migrating tests from mocks to real DB.** Separate effort; the mock approach is fine for what it tests.

---

## Effort estimate

| Phase | Size | Risk |
|-------|------|------|
| 0 baseline | S | none |
| 1 withTransaction | S | very low |
| 2 error classifier | S | none (pure) |
| 3 retry helper | M | low (isolated) |
| 4 unified interface | M | low (additive) |
| 5 shutdown hardening | S | low |
| 6 callsite migration | **L** | medium — spread across many files |
| 7 validation | S | none |
