# Codebase Evaluation Groups

1. **App Composition & Startup**
   - **Scope:** `index.js`, `config/`
   - **Focus:** how the system is wired, initialized, and dependency-injected.

2. **HTTP Interface Layer (Routes/Controllers)**
   - **Scope:** `routes/auth.js`, `routes/preferences.js`, `routes/aggregate-list.js`, `routes/api/`, `routes/admin/`, `routes/oauth/`, `routes/health.js`
   - **Focus:** request parsing, response shaping, route-level SoC.

3. **Core Business Services**
   - **Scope:** `services/`, `services/playlist/`
   - **Focus:** domain logic and orchestration quality (SRP/OCP/DIP especially).

4. **Data Access & Schema Evolution**
   - **Scope:** `db/index.js`, `db/postgres.js`, `db/transaction.js`, `db/retry-wrapper.js`, `db/migrations/`
   - **Focus:** query patterns, transaction boundaries, migration hygiene, DB efficiency.

5. **Cross-Cutting Middleware & Shared Utilities**
   - **Scope:** `middleware/`, `utils/`
   - **Focus:** security/auth middleware, validation, queues, caching, logging, helper reuse (DRY).

6. **Web UI (Server-Rendered + Frontend Modules)**
   - **Scope:** `templates.js`, `views/`, `src/js/`, `src/styles/`
   - **Focus:** frontend modularity, duplication, rendering/data-flow boundaries.

7. **Browser Extension Subsystem**
   - **Scope:** `browser-extension/`
   - **Focus:** separate client surface with its own architecture and quality concerns.

8. **Quality & Test Architecture**
   - **Scope:** `test/`, `test/e2e/`, `playwright.config.js`
   - **Focus:** test coverage by layer, contract/integration confidence, maintainability of test code.

9. **Tooling, Build, and Ops Scripts**
   - **Scope:** `scripts/`, `package.json`, `vite.config.js`, `postcss.config.js`, `tailwind.config.js`, `docker-compose.yml`, `docker-compose.local.yml`, `Dockerfile`
   - **Focus:** build pipeline clarity, script cohesion, CI reliability, maintainability.

## Progress

- **Step 1 / Area 1 (Group 1: App Composition & Startup):** Complete
- **Next area to evaluate:** Group 2 - HTTP Interface Layer (Routes/Controllers)

## Default Scope Exclusions

- Generated/vendor/runtime artifacts: `node_modules/`, `public/js/bundle.js`, `playwright-report/`, `test-results/`, `.git/`

## Evaluation Areas (Apply To Every Group)

1. **Correctness / Bug Risk**
   - Logic errors, edge cases, race conditions, null/undefined handling, stale cache behavior.

2. **Performance & Efficiency**
   - Query efficiency, unnecessary work per request, memory usage, startup/runtime overhead, queue/concurrency tuning.

3. **Reliability & Resilience**
   - Failure handling, retries/timeouts, graceful shutdown, idempotency, partial-failure behavior.

4. **Security**
   - Auth/authz boundaries, input validation, session/cookie hardening, CSRF/CORS posture, secret handling.

5. **Data Integrity**
   - Transaction boundaries, migration safety, uniqueness constraints, consistency under concurrent writes.

6. **Test Effectiveness**
   - Coverage of critical paths and regressions, test realism, flaky test risk, missing negative-path tests.

7. **Observability**
   - Logging quality, metrics coverage, traceability, incident diagnosability.

8. **Maintainability (Principles)**
   - SOLID, DRY, SoC, readability, modularity, coupling, extensibility.

## Recommended Review Output Format (Per Group)

1. **Bug risks found**
   - What can fail, how to trigger it, and likely user/business impact.

2. **Performance & latency opportunities**
   - Hot paths and measurable opportunities (`p50/p95/p99` latency, startup time, query count, CPU/memory).

3. **SOLID / DRY / SoC findings**
   - Concrete violations (with file/function references) and why they hurt maintainability.

4. **Prioritized fixes (high / medium / low)**
   - Include expected impact, implementation risk, and non-breaking rollout notes.

5. **Regression safety plan**
   - Tests to add/update and quick verification steps to confirm no behavior regressions.

6. **Success metrics after implementation**
   - Which metrics should improve and how to verify (latency, error rate, throughput, resource usage).
