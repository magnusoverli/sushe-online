# Redundant Code Audit

Investigation of redundant, dead, legacy, and orphaned code across the entire `sushe-online` codebase.

**Started:** 2026-05-12
**Status:** Plan approved; awaiting Phase 0 kickoff
**Driver:** redundant-code-detector agent (paused id: `ac73cb4bffd5a7e07`)

---

## How to use this document

1. **Plan section** is the source of truth for what each phase covers. Edit it if scope changes — don't fork separate plan docs.
2. **Progress table** is updated each time a phase moves state (`pending` → `in-progress` → `done` / `blocked`).
3. **Findings** are appended as phases complete, one `## Phase N — Findings` heading per phase. Each finding gets a confidence tag (CERTAIN / HIGH / MEDIUM / LOW) and a unique ID (`F-<phase>-<n>`) so the decisions log can reference it.
4. **Decisions log** records what we did with each candidate (`remove` / `keep` / `defer` / `needs-info`) plus the commit hash if removed. Never re-litigate a logged decision without recording why.
5. If findings for a single phase exceed ~300 lines, split into `docs/audit/phase-N-findings.md` and link from this file.

---

## Progress table

| Phase | Topic                              | Effort | Status      | Started | Completed | Candidates | Notes |
| ----- | ---------------------------------- | ------ | ----------- | ------- | --------- | ---------- | ----- |
| 0     | Baseline & ground truth            | S      | done        | 2026-05-12 | 2026-05-12 | —          | Migration-collision question resolved; see F-0-4 |
| 1     | Orphan files & leftovers           | M      | pending     |         |           |            | Parallel after P0 |
| 2     | Dead JS exports                    | L      | pending     |         |           |            | Parallel after P0 |
| 3     | Dead routes / endpoints            | M      | pending     |         |           |            | Parallel after P0 |
| 4     | DB columns / migrations            | L      | pending     |         |           |            | HIGH RISK — never auto-remove migrations |
| 5     | Unused npm dependencies            | S      | pending     |         |           |            | Parallel after P0 |
| 6     | Unused env vars / config keys      | S      | pending     |         |           |            | Parallel after P0 |
| 7     | Duplicate utilities                | M      | pending     |         |           |            | Parallel after P0 |
| 8     | Dead CSS / Tailwind                | M      | pending     |         |           |            | Tailwind safelist is FP-heavy |
| 9     | Legacy markers / commented code    | S–M    | pending     |         |           |            | Parallel after P0 |
| 10    | Obsolete tests                     | M      | pending     |         |           |            | Depends on P1 + P2 |
| 11    | Stale scripts / CI / patches       | S      | pending     |         |           |            | Parallel after P0 |
| 12    | Root docs / leftovers              | S      | pending     |         |           |            | User confirms before any removal |

Status legend: `pending` · `in-progress` · `blocked` · `done` · `skipped`

---

## Plan

### Repo survey findings (grounding the plan)

**Stack**
- Node.js Express 5 app (CommonJS), entry `index.js`. Frontend bundled by **Vite** from `src/js/main.js` → `public/js/bundle.js` + `public/js/chunks/` (gitignored). CSS via Tailwind + PostCSS from `src/styles/input.css` → `public/styles/output.css` (gitignored).
- DB: PostgreSQL (`pg`), schema-managed via numbered migrations in `db/migrations/migrations/` (62 files, with one collision pair `006_*`, and another `053_*`). Migration runner uses `fs.readdirSync` (dynamic load).
- Tests: Node `node --test` (150+ `test/*.test.js` files), Playwright in `test/e2e/`.
- Build/lint: ESLint 10 flat config (`eslint.config.mjs`), Prettier, custom maintainability report.

**Top-level layout (in-scope)**: `index.js`, `templates.js`, `config/`, `middleware/`, `utils/`, `services/` (+ nested), `db/` (`db/repositories/`, `db/schema/`, `db/migrations/`), `routes/` (top-level + nested), `src/js/` (+ nested modules), `src/data/`, `src/styles/`, `views/`, `templates/`, `public/`, `scripts/`, `browser-extension/`, `mobile/` (empty), `patches/`, `docker-entrypoint-initdb.d/`, `docs/`.

**Suspicious / leftover signals already visible**
- Root files: `nul` (68 bytes), `.restart-trigger`, `DB_LAYER_UNIFICATION_PLAN.md`, `DB_MODERNIZATION_PLAN.tmp.txt`, `skills-lock.json`, `DESIGN.md` (some are gitignored but present in working tree).
- **Migration filename collisions**: `006_add_extension_tokens.js` vs `006_add_playlist_preferences.js`; `053_add_comments_2_column.js` vs `053_add_external_identity_mappings.js`. Recent commit "Restore playlist preferences migration" — high-risk area.
- Apparent legacy pairs that are actually orchestrator/facade patterns (NOT duplicates): `routes/auth.js` + `routes/auth/*.js`, `routes/preferences.js` + `routes/preferences/*.js`, `routes/aggregate-list.js` + `routes/aggregate-list/handlers.js`, `services/aggregate-audit.js` + `services/aggregate-audit/*.js`.
- `mobile/` folder is empty but excluded from lint and tailwind content — likely vestigial.
- `templates.js` (root) + `templates/` directory — re-export pattern, needs verification.
- `public/countries.txt` and `src/data/countries.txt` both exist — duplicate static asset suspect.
- Tailwind safelist contains many class names — false-positive risk.
- `eslint.config.mjs` documents *temporary* workarounds (`patch-package`, `eslint-plugin-import` override) — flag for removal once upstream fixes ship.
- 67 occurrences of legacy/deprecated/TODO markers across 26 files.

**Dynamic-usage landmines (false-positive sources)**
- `db/migrations/index.js` loads migrations by filename via `fs.readdirSync` — never import by name.
- Route registrar pattern: route files receive `(app, deps)` and destructure services from `deps` — references won't show in literal grep.
- Vite `manualChunks` matches by **string substring on file path** (`id.includes('music-services')`, `id.includes('import-export')`, `id.includes('musicbrainz')`). Renaming/removing affected modules silently re-bundles.
- Tailwind `safelist` preserves classes grep won't find in HTML/JS.
- Browser extension is a separate consumer of server endpoints — any route used only by the extension looks orphaned from server-grep alone.

### Phase 0 — Baseline & ground truth (sequential, blocks everything)

**Goal:** Capture the authoritative "known reference" set so all later searches have proper denominators. **Effort:** S

- Snapshot current `git status`, `git log` last 60 commits, current branch.
- Build entry-point set: `index.js`, `scripts/migrate.js`, `scripts/*.js`, `templates.js`, `src/js/main.js`, `public/service-worker.js`, `views/*.ejs`, all `routes/*.js` registered in `index.js`, all `db/migrations/migrations/*.js`, Playwright/test runners, `browser-extension/manifest.json` content scripts.
- Read `index.js` end-to-end and `routes/` index (if any) to enumerate **how routes are mounted** (convention vs explicit). Same for `db/migrations/index.js`, `db/repositories/index.js`. Record findings as inputs to every later phase.
- Confirm package manager (npm), lockfile, run `npm ls --depth=0` snapshot for dep audit later.

**Evidence required to flag:** N/A (discovery only).
**False-positive traps:** none.

### Phase 1 — Orphaned files & dead leftovers (parallel, low risk)

**Goal:** Catch files that aren't reachable from any entry point. **Effort:** M

- **1a. Root-level leftovers**: `nul`, `.restart-trigger`, `DB_LAYER_UNIFICATION_PLAN.md`, `DB_MODERNIZATION_PLAN.tmp.txt`, `skills-lock.json`, `DESIGN.md`. For each: `git log --follow`, gitignore status, reference grep.
- **1b. Empty / near-empty directories**: `mobile/`, `data/` (gitignored runtime dir but tracked).
- **1c. Orphaned source files in `src/js/modules/`, `src/js/utils/`**: build Vite import graph from `src/js/main.js`. Cross-check Vite `manualChunks` substring rules before flagging.
- **1d. Orphaned files in `services/`, `utils/`, `middleware/`, `config/`, `db/`, `routes/`**: build CommonJS require graph from `index.js` + `scripts/*.js` + tests.
- **1e. Orphaned templates/views**: grep `views/*.ejs` in `res.render(` calls; grep `templates/*` exports in `templates.js` and `routes/`.
- **1f. Duplicate static assets**: `public/countries.txt` vs `src/data/countries.txt` (and `src/data/genres.txt`).
- **1g. Orphaned icons / images**: grep `public/icons/**` filenames in `manifest.json`, EJS, JS, CSS.
- **1h. Browser-extension leftovers**: `browser-extension/screenshot-*-fixed.png` next to `screenshot-*.png` — likely staged duplicates.

**Detection technique:** AST-light static graph build (recursive `require`/`import` walk) + cross-reference to master keep-list. Grep filename literals across all text files.
**Evidence required to flag:** zero require/import target, zero filename string matches outside the file itself and `node_modules/`, not in `tailwind.safelist`, not in `manifest.json`, not in `vite.config.js` chunk substrings.
**False-positive traps:** convention-loaded migrations, Vite chunk substrings, `service-worker.js` cache lists, EJS `include()` partials, manifest icon arrays.

### Phase 2 — Dead JS/TS code

**Goal:** Identify unreferenced symbols within reachable files. **Effort:** L

- **2a. Unused server-side exports**: for each `module.exports = { ... }` / named export in `services/`, `utils/`, `middleware/`, `db/`, `routes/`, `config/` — grep export name across codebase. Filter destructuring-only. Same-file-only references = candidate.
- **2b. Unused frontend exports**: each `export ...` in `src/js/**` — grep across `src/js/**` only.
- **2c. Unreachable code**: trust ESLint `no-unreachable`. Sweep for `if (false)`, `return;` followed by code.
- **2d. Unused locals**: review existing `no-unused-vars` output; sweep for stale `_`-prefixed ignores.

**Detection technique:** AST-based export extraction + grep for symbol references. Optionally probe with `knip` or `ts-prune` but treat output as candidates only.
**Evidence required to flag:** zero references outside declaration site AND zero references in test files AND symbol not on any `deps` object passed to registrar AND not public API of a `module.exports = (app, deps) => ...` registrar.
**False-positive traps:** functions injected through `deps` object in `index.js`, factory functions (`createXService`), test fixtures in `test/helpers.js`, Tailwind safelist class names referenced from JS strings.

### Phase 3 — Dead routes & API endpoints

**Goal:** HTTP endpoints with no consumers. **Effort:** M

- Enumerate every `app.get|post|put|delete|patch(` and `router.X(` across `routes/**` and `index.js`. Build endpoint table.
- For each endpoint, grep the path string in: `src/js/**`, `browser-extension/**`, `views/**`, `templates/**`, `public/**`, `test/**`, `test/e2e/**`, `docs/**`, README, `.github/**`.
- Pay extra attention to OAuth callback URLs (consumed externally — never remove).

**Evidence required to flag:** zero matches for the path string, zero matches for any unique substring, no `redirect_uri` reference in config or `.env.example`.
**False-positive traps:** OAuth callbacks (Spotify/Tidal/Last.fm), browser-extension endpoints, Telegram webhooks, health/metrics scraping, endpoints assembled from path fragments.

### Phase 4 — Unused DB columns, indexes, tables, migrations

**Goal:** Identify schema artifacts the application no longer reads/writes. **Effort:** L. **Highest-risk phase.**

- Extract every column added/created via migrations 001–062. Build "schema as of HEAD" table.
- For each column/table, grep identifier in `db/repositories/**`, `services/**`, `routes/**`, `db/schema/**`, multi-line SQL strings.
- Cross-check repository SELECT/UPDATE/INSERT column lists against live schema.
- **Migration filename collisions**: investigate `006_*` and `053_*` pairs. Document but **do not propose removing any migration** without explicit user direction.

**Evidence required to flag:** column appears only in its creation migration AND nowhere in repository or service SQL; or repository code reads/writes columns that don't exist (drift).
**False-positive traps:** `SELECT *` (invisible to grep), ad-hoc admin SQL in `routes/admin/**`, dynamic SQL builders in `utils/query-builder.js`, columns required by old migrations for replay, recently-restored migration (commit 841a827).
**Policy:** All findings get **MEDIUM at best**. Always require user verification.

### Phase 5 — Unused npm dependencies

**Goal:** `dependencies` / `devDependencies` no file imports. **Effort:** S

- For every entry in `package.json` (both blocks), grep `require('<name>')`, `require("<name>")`, `from '<name>'`, `from "<name>"`, dynamic require, and bin invocation in `scripts`.
- Special checks: `patch-package` (postinstall + ESLint config header), `concurrently`, `nodemon`, `c8`, `session-file-store`.

**Evidence required to flag:** zero `require`/`import` matches, not in any `package.json` script, not referenced by any config file, not implicitly required by tools.
**False-positive traps:** tools invoked via `npx`, peer-dep style indirect usage, `@types/*` packages, `eslint-config-prettier`.

### Phase 6 — Unused env vars & config keys

**Goal:** Stale `.env.example` entries, unused `process.env` reads. **Effort:** S

- List all keys in `.env.example` and all `process.env.X` reads. Diff both directions.
- Check `docker-compose.yml`, `docker-compose.local.yml`, `Dockerfile`, `.github/**` for env var references.

**Evidence required to flag:** env var name appears nowhere in any `.js`/`.mjs`/`.sh`/`.yml`/`.yaml`/`Dockerfile` other than `.env.example`.
**False-positive traps:** env vars read in deployment/CI but never in app code (legitimate).

### Phase 7 — Duplicate utilities & superseded modules

**Goal:** Two implementations of the same concept. **Effort:** M

- Build function-by-name index across `services/` and `utils/`. Pairs sharing a name (or normalized name) are candidates.
- Suspected pairs already visible: `services/album-canonical.js` vs `services/album-service.js`; `utils/musicbrainz.js` vs `utils/musicbrainz-helpers.js` vs `src/js/modules/musicbrainz-artist-name.js`; `utils/spotify-auth.js` vs `services/spotify-service.js`; `services/playlist/playlist-helpers.js` vs `services/list/*`; `templates.js` (root) vs `templates/*.js` (likely facade).
- For each pair: diff exports and call sites.

**Evidence required to flag:** two modules export overlapping APIs AND one has fewer/no callers OR one is referenced only by the other (facade pattern).
**False-positive traps:** intentional facade re-exports, separation by layer (server vs browser).

### Phase 8 — Dead CSS / Tailwind

**Goal:** Class definitions / `@apply` rules / safelist entries with no usage. **Effort:** M

- Tailwind generates utilities from content scan — most "dead" CSS lives in `src/styles/input.css` custom rules and `safelist` in `tailwind.config.js`.
- For each safelist entry and each custom class: grep across `views/**`, `templates/**`, `src/js/**`, `public/**`, `templates.js`, `index.js`, dynamically-built class names.

**Evidence required to flag:** zero literal matches AND no plausible dynamic construction.
**False-positive traps:** dynamic class concatenation (`'album-' + type`), library-generated classes (Sortable.js), classes used only via `showToast`/runtime templates.

### Phase 9 — Commented-out / vestigial code blocks & legacy markers

**Goal:** Stale code preserved in comments, TODO/FIXME/HACK/DEPRECATED clusters. **Effort:** S–M

- Sweep 67 already-identified occurrences in 26 files. Classify: (a) action-item TODO (leave), (b) stale comment about removed code, (c) commented-out code (recommend removal — version control preserves it), (d) `@deprecated` symbols.
- For each `@deprecated`: Phase 2-style call-site sweep. Zero non-test callers → high-confidence removable.

**Evidence required to flag:** standard symbol-reference sweep.
**False-positive traps:** comments documenting *why* code was removed are useful — preserve unless asked.

### Phase 10 — Obsolete / orphaned tests

**Goal:** Tests for code that no longer exists, or duplicate coverage. **Effort:** M. **Depends on P1 + P2.**

- Cross-reference each `test/*.test.js` to imported modules. If those modules are Phase 1 candidates, the test is too.
- Look for `.skip(`, `.todo(`, always-failing tests left in.

**Evidence required to flag:** test imports only point at files that are themselves removal candidates OR test target file no longer exists.
**False-positive traps:** shared test helpers (`test/helpers.js`), integration tests that don't import the unit directly.

### Phase 11 — Stale scripts, CI, infra config

**Goal:** Files in `scripts/`, `.github/`, `docker-entrypoint-initdb.d/`, `patches/` not wired in. **Effort:** S

- For each `scripts/*`: check `package.json` scripts block, `.github/workflows/**`, `Dockerfile`, `docker-compose*.yml`, `setup-git-hooks.sh`.
- `patches/*`: verify each patch's target package is still installed at patched version AND `patch-package` is still in postinstall.
- `docker-entrypoint-initdb.d/`: verify files actually executed by the Postgres image init; check duplication with migrations.

**Evidence required to flag:** not referenced from any orchestrator.
**False-positive traps:** scripts invoked via cron / external orchestration; patches whose package is no longer installed (means patch is dead and *should* be removed).

### Phase 12 — Docs / plans / random root files

**Goal:** One-off planning docs at root. **Effort:** S

- `DB_LAYER_UNIFICATION_PLAN.md`, `DB_MODERNIZATION_PLAN.tmp.txt`, `DESIGN.md`, `skills-lock.json`, `nul`, `.restart-trigger`. Confirm with user before recommending removal.

**Evidence required to flag:** never referenced from code, README, or CI.
**False-positive traps:** planning docs the user is actively using; `.restart-trigger` is dev workflow.

### Phase sequencing

```
Phase 0 (baseline)                  ─── must finish first
                                    │
                                    ├─► Phase 1 (orphans)      ┐
                                    ├─► Phase 3 (routes)       │
                                    ├─► Phase 5 (deps)         │
                                    ├─► Phase 6 (env)          │  all parallel
                                    ├─► Phase 7 (duplicates)   │
                                    ├─► Phase 8 (CSS)          │
                                    ├─► Phase 9 (legacy)       │
                                    ├─► Phase 11 (infra)       │
                                    ├─► Phase 12 (root docs)   ┘
                                    │
                                    ├─► Phase 2 (dead JS)      ┐  parallel, heavier
                                    └─► Phase 4 (DB schema)    ┘
                                                │
                                                └─► Phase 10 (orphan tests)  — needs P1/P2
```

### High-risk areas demanding extra verification

1. **Migrations** — dynamic load, two filename collisions, recent restore commit. Never recommend deletion.
2. **OAuth callbacks** — external consumers.
3. **Browser-extension ↔ server endpoints** — external consumers.
4. **Telegram webhooks** — external callers; webhook URL contains a secret.
5. **Vite `manualChunks` substring matching** — renames silently change chunking.
6. **Tailwind safelist + dynamic class names** — heavy FP risk for CSS phase.
7. **Patch-package + ESLint workarounds** — documented as temporary; verify upstream status first.
8. **Route registrar `deps` object** in `index.js` — destructured access, won't grep clean.
9. **`SELECT *` in repositories** — masks column usage.
10. **EJS `include()` partials** — relative path strings, easy to miss.

### Execution policy

- Each phase ends with a structured findings report. Confidence: CERTAIN / HIGH / MEDIUM / LOW.
- Only CERTAIN items get a removal recommendation; everything else gets specific verification questions.
- No removals happen automatically. Every removal is its own atomic change the user approves.
- `lint:strict` + full test suite must be green before and after each removal commit.

### Excluded paths (dev-local / generated)

By default the audit excludes: `node_modules/`, `.git/`, `public/js/bundle.js`, `public/js/chunks/`, `public/styles/output.css`, `playwright-report/`, `test-results/`, `coverage/`, `.opencode/`, `.agents/`, `.claude/`, `screenshots/`, `plans/`.

---

## Decisions log

Format: `| ID | Phase | Confidence | Decision | Commit / Rationale |`

| ID | Phase | Confidence | Decision | Commit / Rationale |
| -- | ----- | ---------- | -------- | ------------------ |
| _(empty — will be populated as findings are reviewed)_ | | | | |

Decision values: `remove` (with commit hash), `keep` (with reason), `defer` (revisit when), `needs-info` (open question).

---

## Findings

_(Phase findings will be appended below as each phase completes. Each phase gets its own `## Phase N — Findings` heading. Findings within a phase use IDs `F-<phase>-<n>`.)_

## Phase 0 — Findings

Discovery-only baseline. No removal candidates. All later phases reference this section for the authoritative reachability set.

### F-0-1 — Repo snapshot

- **Branch:** `main`
- **HEAD:** `cbc900e` ("Add redundant code audit plan and progress tracker")
- **Working tree:** clean tracked-files-wise; only untracked path is `.claude/agent-memory/` (audit agent memory, gitignored).
- **Last 30 commit subjects** (newest first):
  1. `cbc900e` Add redundant code audit plan and progress tracker
  2. `979e0e4` Merge branch 'main' of https://github.com/magnusoverli/sushe-online
  3. `3cba470` Project-scope redundant code agent
  4. `5876f26` Update changelog [skip ci]
  5. `25f7431` Clarify duplicate review merge selection
  6. `c9af251` Update changelog [skip ci]
  7. `124c51a` Fix album cover replacement persistence
  8. `841a827` Restore playlist preferences migration
  9. `3f2ddc1` Raise maintainability baseline threshold to 90
  10. `f3fa3dd` Improve restore progress sequencing and backup download resilience
  11. `188d3f8` Fix health readiness handling for zero-latency checks
  12. `2ccde5f` Align album-summary export test with facade cleanup
  13. `8143c88` Remove final DB facade compatibility leftovers
  14. `8431d55` Update changelog [skip ci]
  15. `488f637` Handle Spotify auth polling failures and bump npm
  16. `d854f06` Update changelog [skip ci]
  17. `ed3e3db` Harden canonical DB contract checks in service factories
  18. `66ed7f8` Handle stale last-selected list references on startup
  19. `e59f65e` Merge pull request #356 from magnusoverli/refactor/close-db-modernization-leftovers
  20. `ad2f557` Record final contract seam cleanup in tracker
  21. `6f885ff` Tighten remaining db contract seams in services
  22. `54828c9` Merge pull request #355 from magnusoverli/refactor/finalize-db-modernization-plan
  23. `fe72e39` Finalize tracker with album canonical milestone
  24. `86f4991` Move album canonical into service layer
  25. `e0a5394` Merge pull request #354 from magnusoverli/refactor/track-fetch-queue-service-move
  26. `15332f3` Update tracker with track queue move milestone
  27. `0c9533b` Move track fetch queue into services layer
  28. `3862f9d` Merge pull request #353 from magnusoverli/fix/canonical-db-test-mocks
  29. `899ebc7` Align canonical db test harnesses with deps.db.raw contract
  30. `5ace64d` Prune legacy auth-route test dependency wiring

  Notable signal: a heavy "DB modernization / canonical service" refactor stream wrapped up across commits `54828c9..8143c88`; legacy DB-facade leftovers were explicitly removed in `8143c88`. This is the freshest area, so any "looks redundant" hit in `db/`, `services/`, or repository code needs extra suspicion — it may be a freshly-completed seam, not dead.

### F-0-2 — Entry-point set (reachability roots)

These are the verified entry points. Phase 1 and Phase 2 reachability graphs MUST start from this set.

- **Server runtime entry:** [`index.js`](../../index.js) (started via `node index.js`, also re-required by tests via the route registrars).
- **Standalone scripts (each is its own root):**
  - [`scripts/migrate.js`](../../scripts/migrate.js) — `npm run migrate*` (4 variants).
  - [`scripts/deduplicate-list-items.js`](../../scripts/deduplicate-list-items.js) — not wired into `package.json` scripts; check Phase 11.
  - [`scripts/resize-existing-images.js`](../../scripts/resize-existing-images.js) — not wired into `package.json` scripts; check Phase 11.
  - [`scripts/update-changelog.js`](../../scripts/update-changelog.js) — `changelog`, `changelog:quick`, `changelog:git`.
  - [`scripts/ci-changelog.js`](../../scripts/ci-changelog.js) — verify Phase 11 (likely called from `.github/workflows`).
  - [`scripts/maintainability-report.js`](../../scripts/maintainability-report.js) — `report:maintainability*`, `lint:structure:baseline`.
  - [`scripts/run-tests.sh`](../../scripts/run-tests.sh) — `npm test`.
  - [`scripts/setup-git-hooks.sh`](../../scripts/setup-git-hooks.sh) — `changelog:setup`.
  - [`scripts/optimize-icons.sh`](../../scripts/optimize-icons.sh) — `optimize:icons`.
  - [`scripts/docker-entrypoint-upgrade.sh`](../../scripts/docker-entrypoint-upgrade.sh) — verify Phase 11 (likely Dockerfile-invoked).
- **Server-side template root:** [`templates.js`](../../templates.js) — required by `index.js:55` and by individual route modules. It is the only re-exporter of `templates/*.js`; see F-0-6.
- **Frontend Vite entry:** [`src/js/main.js`](../../src/js/main.js) — single `input` in `vite.config.js:21`. Outputs `public/js/bundle.js` plus split chunks under `public/js/chunks/`. Both output dirs are gitignored.
- **Service worker:** [`public/service-worker.js`](../../public/service-worker.js) — NOT registered automatically; verify Phase 1 whether anything still registers it (only static caches `output.css`, `manifest.json`, `og-image.png`).
- **Views (EJS):** [`views/layout.ejs`](../../views/layout.ejs), [`views/login.ejs`](../../views/login.ejs), [`views/spotify-page.ejs`](../../views/spotify-page.ejs), [`views/aggregate-list-page.ejs`](../../views/aggregate-list-page.ejs), [`views/health.ejs`](../../views/health.ejs).
  - `layout.ejs` + `login.ejs` are loaded via `ejs.compile(fs.readFileSync(...))` in [`templates.js`](../../templates.js#L36-L43).
  - `spotify-page.ejs` via [`templates/spotify-template.js`](../../templates/spotify-template.js#L7).
  - `aggregate-list-page.ejs` via [`templates/aggregate-list-template.js`](../../templates/aggregate-list-template.js#L7).
  - `health.ejs` via `res.render('health')` in [`routes/health.js`](../../routes/health.js#L108). It is the ONLY `res.render()` call in the codebase — every other view is rendered via the EJS-compile facade, not `app.render`/`res.render`.
- **DB migration roots:** [`db/migrations/index.js`](../../db/migrations/index.js) + every file in `db/migrations/migrations/*.js` — see F-0-4.
- **Tests (Node):** `test/*.test.js`, plus shared helper [`test/helpers.js`](../../test/helpers.js); see F-0-10.
- **Tests (Playwright):** `test/e2e/*.spec.js` (5 files).
- **Browser-extension entries (per [`manifest.json`](../../browser-extension/manifest.json)):**
  - `background.js` (service worker)
  - `content-script.js` (RYM pages)
  - `auth-listener.js` (sushe `/extension/auth` page)
  - `popup.js` (popup action)
  - `options.js` (options page)
  - Indirectly: `auth-state.js`, `shared-utils.js` (imported by the above).

### F-0-3 — Route registration model

Mounting is **explicit, not convention-based**. Phase 3 must enumerate from `index.js` outward.

In [`index.js`](../../index.js#L240-L299) the registrars are required and called explicitly:

```js
const authRoutes         = require('./routes/auth');
const oauthRoutes        = require('./routes/oauth');
const adminRoutes        = require('./routes/admin');
const apiRoutes          = require('./routes/api/index');
const preferencesRoutes  = require('./routes/preferences');
const aggregateListRoutes= require('./routes/aggregate-list');

authRoutes(app, deps);
oauthRoutes(app, deps);
adminRoutes(app, deps);
apiRoutes(app, deps);
preferencesRoutes(app, deps);
const { aggregateList } = aggregateListRoutes(app, deps);
```

Plus [`routes/health.js`](../../routes/health.js) — registered earlier at [`index.js:204`](../../index.js#L204) via `registerHealthRoutes(app, pool, { ready })`.

Each registrar takes `(app, deps)` and EITHER calls `app.get/post/...` directly OR delegates to sub-files. Sub-registrars discovered:

- [`routes/oauth/index.js`](../../routes/oauth/index.js) → requires `./spotify`, `./tidal`, `./lastfm`.
- [`routes/admin/index.js`](../../routes/admin/index.js) → requires the seven `routes/admin/*.js` siblings (audit, backup, bootstrap, catalog-cleanup, duplicates, events, images, reidentify, stats, telegram, users, album-summaries — confirm full list in Phase 3).
- [`routes/api/index.js`](../../routes/api/index.js) → requires each `routes/api/*.js`. Notably it dynamically passes `sharedDeps` to siblings (see [line 250](../../routes/api/index.js#L250) for `telegram` — flagged as the only example I confirmed; Phase 3 must read the whole file).
- [`routes/auth.js`](../../routes/auth.js#L24-L29) → requires sibling factory modules under `routes/auth/`.
- [`routes/preferences.js`](../../routes/preferences.js) + `routes/preferences/*` — facade.
- [`routes/aggregate-list.js`](../../routes/aggregate-list.js) + `routes/aggregate-list/handlers.js` — facade.

There is no `routes/index.js` and no auto-discovery. A route file added to `routes/` but not required from `index.js` or a sibling registrar will be **silently dead**.

**Full `deps` object passed to route registrars** (from [`index.js:255-291`](../../index.js#L255-L291)). Phase 2 MUST treat each of these as live (registrars destructure them):

| Key | Source |
|-----|--------|
| `htmlTemplate` | `./templates` |
| `registerTemplate` | `./templates` |
| `loginTemplate` | `./templates` |
| `forgotPasswordTemplate` | `./templates` |
| `resetPasswordTemplate` | `./templates` |
| `invalidTokenTemplate` | `./templates` |
| `spotifyTemplate` | `./templates` |
| `extensionAuthTemplate` | `./templates` |
| `isTokenValid` | `./services/auth-utils-service` |
| `isTokenUsable` | `./services/auth-utils-service` |
| `csrfProtection` | `./middleware/csrf` (created via `createCsrfProtection()`) |
| `ensureAuth` | `./middleware/auth` |
| `ensureAuthAPI` | `./middleware/auth` (factory `createEnsureAuthAPI`) |
| `ensureAdmin` | `./middleware/auth` |
| `rateLimitAdminRequest` | factory `createRateLimitAdminRequest` |
| `upload` | local multer instance |
| `bcrypt` | `bcryptjs` |
| `crypto` | node `crypto` |
| `nodemailer` | `nodemailer` |
| `composeForgotPasswordEmail` | `./utils/forgot-email` |
| `isValidEmail` | `./utils/validators` |
| `isValidUsername` | `./utils/validators` |
| `isValidPassword` | `./utils/validators` |
| `sanitizeUser` | `./middleware/auth` |
| `adminCodeState` | `./config/admin-code` |
| `dataDir` | `./db` |
| `db` | `./db` |
| `passport` | `passport` |
| `invalidateUserCache` | `./config/passport` |
| `authService` | factory `createAuthService` |
| `userService` | factory `createUserService` |
| `usersRepository` | factory `createUsersRepository` |
| `duplicateService` | factory `createDuplicateService` |
| `reidentifyService` | factory `createReidentifyService` |
| `broadcast` | `./utils/websocket` |

Phase 2 false-positive trap: a literal grep for e.g. `isTokenValid` may only find it in `index.js` and one route file. That is normal — the rest of the codebase reads it as `deps.isTokenValid` or via destructure. Not dead.

### F-0-4 — Migration loader (the critical question)

The loader is in [`db/migrations/index.js`](../../db/migrations/index.js). Key mechanics:

- [`getMigrationFiles()`](../../db/migrations/index.js#L38-L54): `fs.readdirSync(this.migrationsDir).filter(.js).sort()`. Each entry becomes `{ version: file.replace('.js',''), filePath }`.
- The `version` IS the **full filename minus `.js`**, not a numeric prefix. So `006_add_extension_tokens` and `006_add_playlist_preferences` are TWO DIFFERENT versions.
- [`schema_migrations`](../../db/migrations/index.js#L21-L28) stores `version` with `UNIQUE NOT NULL` — uniqueness applies to the full string, so both 006 files (and both 053 files) can coexist in the table.
- [`runMigrations()`](../../db/migrations/index.js#L210-L257) executes pending files in `sort()` order under a Postgres advisory lock (`MIGRATION_LOCK_KEY = 0x53755368`).
- A `_checkForwardSchemaGuard()` ([line 188](../../db/migrations/index.js#L188-L202)) refuses to start if the DB has versions the code doesn't know — so a rolled-back deploy is protected.

**Collision-pair behavior — answered:**

Lexicographic `sort()` order for the colliding pairs:

1. `006_add_extension_tokens.js`  →  version `006_add_extension_tokens`  (runs FIRST)
2. `006_add_playlist_preferences.js` → version `006_add_playlist_preferences` (runs SECOND)
3. ...
4. `053_add_comments_2_column.js` → version `053_add_comments_2_column` (runs FIRST of the pair)
5. `053_add_external_identity_mappings.js` → version `053_add_external_identity_mappings` (runs SECOND of the pair)

**Both migrations in each pair run, in deterministic order. Neither shadows the other.** There is no duplicate-numeric-prefix detection in the loader — the duplicate `006*` / `053*` prefix is purely cosmetic. They are independent migrations that happen to share a numeric prefix.

Confirmed by git history: commit `841a827` ("Restore playlist preferences migration") only re-added `006_add_playlist_preferences.js`; commit `c840487` originally added `006_add_extension_tokens.js`. Both exist on disk now and the version strings differ. Same story for 053: `62d93ad` added `053_add_comments_2_column`, `0cd8728` added `053_add_external_identity_mappings`.

**Filename convention:** `<3-digit-prefix>_<snake_case_name>.js`. Numeric prefixes are not gap-free (no 027 is missing — verified; actually the on-disk set runs 001–062 with no numeric gaps; the only "anomaly" is the two duplicate-prefix pairs).

**Phase 4 implication:** The collision pairs are NOT a bug to fix. They are a documented, working pattern. Phase 4 must treat the 64 migration files as a single dynamically-loaded set; any "rename" or "remove" recommendation for a migration is automatically MEDIUM at best and requires explicit user direction.

### F-0-5 — Repository layer

- **No `db/repositories/index.js`** exists. There is no barrel export. Each repository is required directly by name.
- All three repositories are factory-style: `createXRepository({ db, ... })`.
- Files (3): [`db/repositories/users-repository.js`](../../db/repositories/users-repository.js), [`db/repositories/lists-repository.js`](../../db/repositories/lists-repository.js), [`db/repositories/list-items-repository.js`](../../db/repositories/list-items-repository.js).
- `index.js:62` requires only `createUsersRepository` directly; the other two are required from inside service factories (Phase 2 must verify).
- Each repository imports its column list from `db/schema/*` — Phase 4 should treat `db/schema/*.js` as the canonical column inventory.

### F-0-6 — Templates pattern (facade)

[`templates.js`](../../templates.js) is a **facade** that aggregates the per-page modules under [`templates/`](../../templates/). It does the EJS pre-compile dance for layout/login itself, then re-exports the per-page templates produced by the factories. Confirmed by reading both files:

- `templates.js` requires: `./utils/color-utils`, `./utils/template-helpers`, `./templates/auth-templates`, `./templates/extension-auth-template`, `./templates/aggregate-list-template`, `./templates/spotify-template`, `./templates/spotify-components`.
- It exports: `htmlTemplate, registerTemplate, loginTemplate, forgotPasswordTemplate, resetPasswordTemplate, invalidTokenTemplate, spotifyTemplate, aggregateListTemplate, extensionAuthTemplate, headerComponent, formatDate, formatDateTime, asset`.
- The `deps` object only consumes 8 of these (no `aggregateListTemplate`, `headerComponent`, `formatDate`, `formatDateTime`, `asset` re-export). Phase 2/7 should check whether the unused-by-deps exports have any non-`index.js` consumers — they may be used by route files that `require('../templates')` directly. Likely the case for `aggregateListTemplate` (the aggregate-list route imports it directly from the facade).

Phase 7 conclusion: `templates.js` is **NOT a duplicate** of `templates/*.js`; it is the canonical re-export.

### F-0-7 — Vite chunking rules (landmines)

Every substring rule in `vite.config.js` [`manualChunks`](../../vite.config.js#L25-L38) — Phase 1, 2, 7 must check renames against these:

| Substring | Chunk |
|-----------|-------|
| `music-services` | `music-services` |
| `import-export` | `import-export` |
| `musicbrainz` | `album-editing` |
| `sortablejs` | `vendor-sortable` |

Also a **commonjsOptions.include** allowlist: `/utils[\\/]normalization\.js$/` ([vite.config.js:18](../../vite.config.js#L18)). This is essential for [`utils/normalization.js`](../../utils/normalization.js) to be bundled correctly into the browser bundle (CJS → ESM transform). If `utils/normalization.js` is ever renamed/moved without updating this regex, the browser bundle breaks with `ReferenceError: module is not defined`. Treat this file as **must-not-rename** without code-config changes.

Alias: `@utils` → repo `utils/` directory ([vite.config.js:9](../../vite.config.js#L9)). Phase 2 must grep for `@utils/` imports as well as relative imports.

### F-0-8 — Tailwind safelist (FP minefield)

Safelist in [`tailwind.config.js`](../../tailwind.config.js#L11-L172) contains **127 explicit class names** grouped by category (album/dnd/cell/utility/flex/spacing/sizing/typography/bg/border/hover/transition/animation/focus/layout/custom). Phase 8 must enumerate these verbatim; none are removable without confirming they are not used via dynamic class concatenation in JS.

**Content-scan paths** (Tailwind's other source of "alive" classes):

- `./index.js`
- `./views/**/*.{js,ts,jsx,tsx,ejs}`
- `./public/**/*.html`
- `./src/**/*.{js,ts,jsx,tsx}`
- `./public/**/*.js`
- `./templates.js`

Note: `templates/**/*.js` is NOT in the scan list (only `templates.js`). If a per-page template file in `templates/` introduces a class not already covered by another path, it won't be picked up. Worth a Phase 8 spot-check.

Also note: `routes/**/*.js` is NOT scanned. Any HTML class string emitted from a route handler must come from a template, `index.js`, or a public asset to be detected.

### F-0-9 — Package manager and dependencies

- **Package manager:** npm. Lockfile: `package-lock.json` (present at repo root, gitignore confirmed not excluded).
- No `pnpm-lock.yaml`, no `yarn.lock`.
- `npm ls` not run (the user asked us to skip it). Listing below is read directly from [`package.json`](../../package.json).

**`dependencies` (28):**

`@anthropic-ai/sdk`, `bcryptjs`, `compression`, `connect-pg-simple`, `cors`, `csrf`, `dotenv`, `ejs`, `express`, `express-rate-limit`, `express-session`, `helmet`, `jspdf`, `multer`, `nodemailer`, `passport`, `passport-local`, `pg`, `pino`, `prom-client`, `sharp`, `socket.io`

**`devDependencies` (22):**

`@eslint/js`, `@playwright/test`, `@tailwindcss/postcss`, `@types/node`, `@types/pg`, `c8`, `concurrently`, `eslint`, `eslint-config-prettier`, `eslint-plugin-import`, `eslint-plugin-prettier`, `eslint-plugin-security`, `nodemon`, `patch-package`, `postcss`, `postcss-cli`, `prettier`, `session-file-store`, `socket.io-client`, `supertest`, `tailwindcss`, `typescript`, `vite`

**`overrides`:** `eslint-plugin-import.eslint` pinned to `$eslint` — documented as a temporary workaround.

Phase 5 will use this list verbatim.

### F-0-10 — Test discovery

- `npm test` runs `npm run lint:strict && bash scripts/run-tests.sh`. **Note:** `scripts/run-tests.sh` is a bash script — this will fail on Windows unless run from Git Bash / WSL. (Not in scope for Phase 0 but flagged for the user.)
- [`scripts/run-tests.sh`](../../scripts/run-tests.sh) does:
  1. Phase 1 — Auto-discovered unit tests via shell glob `test/*.test.js` minus a hardcoded `INTEGRATION_TESTS` exclusion list (3 files: `list-fetch-optimization.test.js`, `recommendations.test.js`, `year-locking.test.js`). Run in **parallel** via `node --test`.
  2. Phase 2 — Same 3 integration files run **serially** if `DATABASE_URL` is reachable.
  3. Phase 3 — Playwright e2e in `test/e2e/*.spec.js` (5 files), only outside CI and only if `npx playwright --version` succeeds.
- Test file count via Glob (`test/**/*.test.js`): **>100** Node unit/integration tests. Test discovery is auto-by-glob, no manifest.
- **Shared helper:** [`test/helpers.js`](../../test/helpers.js) — required by at least `test/album-service.test.js`, `test/year-lock-utils.test.js`, `test/websocket.test.js`, `test/user-service.test.js`, `test/user-preferences.test.js` (sample of 5 confirmed). Phase 10 must NOT treat `helpers.js` as orphaned even if a literal grep for its symbol names looks sparse.
- Glob `test/helpers/**` returns nothing — there is no helper directory, just the one file.

### F-0-11 — External consumer surfaces (must-not-remove)

Phase 3 false-positive prevention. Each of these paths is consumed by something OUTSIDE the server codebase. Touch only with explicit user direction.

**OAuth callbacks** (consumed by Spotify, Tidal, Last.fm — URL is registered in their dashboards):

- `GET /auth/spotify/callback` — [`routes/oauth/spotify.js:50`](../../routes/oauth/spotify.js#L50). `.env.example` line: `SPOTIFY_REDIRECT_URI=http://localhost:3000/auth/spotify/callback`.
- `GET /auth/tidal/callback` — [`routes/oauth/tidal.js:57`](../../routes/oauth/tidal.js#L57). `.env.example` line: `TIDAL_REDIRECT_URI=http://localhost:3000/auth/tidal/callback`.
- `GET /auth/lastfm/callback` — [`routes/oauth/lastfm.js:45`](../../routes/oauth/lastfm.js#L45).

**OAuth siblings** (used by user-initiated flow and disconnect, but referenced from the same external auth flow):

- `GET /auth/spotify`, `GET /auth/spotify/disconnect` — `routes/oauth/spotify.js`.
- `GET /auth/tidal`, `GET /auth/tidal/disconnect` — `routes/oauth/tidal.js`.
- `GET /auth/lastfm`, `GET /auth/lastfm/disconnect` — `routes/oauth/lastfm.js`.

**Browser-extension endpoints** (consumed by `browser-extension/background.js`, `popup.js`, `options.js`, `auth-listener.js`):

- `GET /extension/auth` — [`routes/auth.js:294`](../../routes/auth.js#L294). Referenced from extension `popup.js:167`, `options.js:113`, `background.js:736`, and matched by `manifest.json` `content_scripts.matches`.
- `POST /api/auth/extension-token` — `routes/auth.js:296-300`.
- `GET  /api/auth/validate-token` — `routes/auth.js:302`.
- `DELETE /api/auth/extension-token` — `routes/auth.js:304-308`.
- `GET /api/auth/extension-tokens` — `routes/auth.js:310-314`.
- `POST /api/auth/cleanup-tokens` — `routes/auth.js:316-319`.
- `GET /api/lists` — referenced by `browser-extension/background.js:354`.
- `GET /api/lists/:id/items` (PATCH) — referenced by `browser-extension/background.js:957`.
- `GET /api/proxy/musicbrainz?endpoint=...` — referenced by `browser-extension/background.js:871, :914`.

**Telegram webhook / bot endpoints** (server-initiated outbound; the Telegram bot pulls notifications, but admin routes under `/api/admin/telegram/*` are consumed from the admin UI — see [`routes/admin/telegram.js`](../../routes/admin/telegram.js#L42-L286)):

- The Telegram integration in this codebase is OUTBOUND (the server sends to Telegram via `telegramNotifier.sendTestMessage()` etc.). There is no inbound webhook endpoint receiving messages from Telegram. The 13 `/api/admin/telegram/*` paths are admin-UI-driven; consumers live in `src/js/**` (Phase 3 must verify).

**Health / metrics** (consumed by external monitoring — k8s probes, Prometheus scraper):

- `GET /health/db` — [`routes/health.js:90`](../../routes/health.js#L90).
- `GET /health` — `routes/health.js:107` (renders `health.ejs`).
- `GET /api/health` — `routes/health.js:112`.
- `GET /ready` — `routes/health.js:137` (k8s readiness probe).
- `GET /metrics` — `routes/health.js:149` (Prometheus, IP-restricted).

**Misc external surfaces:**

- `GET /.well-known/*` — [`index.js:150`](../../index.js#L150). Used by Android Asset Links / iOS Universal Links. Endpoint exists but returns empty.
- Icon shim routes (`/favicon.ico`, `/apple-touch-icon*.png`) — `index.js:305-327`. Consumed by browsers automatically.

### F-0-12 — Excluded paths

The plan's exclusion list still matches reality:

`node_modules/`, `.git/`, `public/js/bundle.js`, `public/js/chunks/`, `public/styles/output.css`, `playwright-report/`, `test-results/`, `coverage/`, `.opencode/`, `.agents/`, `.claude/`, `screenshots/`, `plans/`.

Additions to add to the audit's exclusion / "not a candidate" pile:

- `data/` — gitignored runtime directory referenced by `--ignore data/` in the `dev` script.
- `docker-entrypoint-initdb.d/` — Postgres image init, declared in `docker-compose*.yml`. Phase 11 will revisit.
- `patches/` — patch-package targets. Phase 11 will verify each patch.
- `mobile/` — empty directory, kept for git tracking but excluded from lint/tailwind scans. Phase 1 candidate.
- `src/data/` — runtime-loaded JSON/text data (countries, genres, changelog). Loaded by code, not modules-imported.

### F-0-13 — Open questions blocking later phases

None of these block Phase 1, 5, 6, 9, 11, or 12 — those can start in parallel.

1. **Migration-collision behavior** — RESOLVED (F-0-4). Both files in each `006_*` and `053_*` pair execute as distinct versions. Phase 4 does NOT need to remove a collision.
2. **`scripts/deduplicate-list-items.js`, `scripts/resize-existing-images.js`** — not wired into `package.json`. Phase 11 must confirm whether they are invoked from CI/Docker entrypoint or are one-off maintenance scripts the user wants to keep on disk regardless. **[User decision 2026-05-12: remove if Phase 11 confirms no caller anywhere — CI, Docker, cron, docs.]**
3. **`scripts/ci-changelog.js`** — likely called from `.github/workflows/`; Phase 11 must verify via `.github/workflows/*.yml`.
4. **`scripts/docker-entrypoint-upgrade.sh`** — likely invoked from `Dockerfile`; Phase 11 must verify.
5. **`templates.js` re-exports `aggregateListTemplate`, `headerComponent`, `formatDate`, `formatDateTime`, `asset`** — none of these are in the `deps` object passed to route registrars. Phase 2 must confirm direct `require('../templates')` consumption before flagging.
6. **`public/service-worker.js`** — Phase 1 must confirm whether any client code still calls `navigator.serviceWorker.register(...)`. If nothing registers it, this is an orphan.
7. **Bash-only `scripts/run-tests.sh`** — not a Phase question; just an environmental note for the user (Windows users need Git Bash / WSL to run `npm test`).
8. **`mobile/` empty directory** — Phase 1 candidate; user confirmation needed. **[User decision 2026-05-12: vestigial — remove once Phase 1 confirms zero references in code/configs.]**
9. **`utils/normalization.js`** — Phase 2/7 must NOT recommend rename/move without simultaneously updating the regex in [`vite.config.js:18`](../../vite.config.js#L18).
10. **Recently-completed "DB modernization" stream** — anything in `db/`, `services/`, repository factories, or `routes/api/_helpers.js` that looks redundant is suspect; cross-check git log against the freshly-merged PRs `#353..#356` before flagging.

