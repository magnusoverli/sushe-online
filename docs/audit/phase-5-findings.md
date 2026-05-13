# Phase 5 — Findings

**Run:** 2026-05-13  |  **Phase:** 5 — Unused npm dependencies

## Summary

- **Dependencies audited:** 50 total (22 `dependencies` + 23 `devDependencies` — F-0-9 counted 22 devDeps before `socket.io-client`; current count is 23).
- **Total Phase-5 candidates:** 1 (CERTAIN: **1**, HIGH: 0, MEDIUM: 0, LOW: 0, needs-info: 0).
- **CERTAIN removal:** `c8` (devDependency). Coverage infrastructure was explicitly removed in commit `cc561bf` (2026-01-05); the devDependency entry was overlooked.
- **All 22 `dependencies` entries are reachable via direct `require()` from the runtime graph.**
- **All other `devDependencies` are wired into either `package.json` scripts, config files (`eslint.config.mjs`, `postcss.config.js`, `playwright.config.js`, `vite.config.js`, `tsconfig.json`), JSDoc type-imports checked by `tsc --noEmit`, or load-bearing tooling (`patch-package` postinstall, `prettier` peer of `eslint-plugin-prettier`, `postcss` peer of `postcss-cli`).**
- **Special-check verdicts:**
  - **`patch-package`** — load-bearing: `postinstall: "patch-package || true"` in `package.json`, two `COPY patches/ patches/` in `Dockerfile`, header in `eslint.config.mjs`. Patch `patches/eslint-plugin-security+3.0.1.patch` still applies (installed version is `eslint-plugin-security@3.0.1`, confirmed via `node_modules/eslint-plugin-security/package.json`). **Keep.**
  - **`concurrently`** — used in `dev` script (`concurrently "npm run watch:css" "npm run watch:js" "nodemon …"`). **Keep.**
  - **`nodemon`** — used in `dev` script; `services/admin-backup-service.js:434-446` touches `.restart-trigger` to drive it after a DB restore. **Keep.**
  - **`c8`** — **ZERO references anywhere in the working tree** outside `package.json` / `package-lock.json` / this audit. Removed deliberately. **Remove.** (See F-5-1.)
  - **`session-file-store`** — present in `devDependencies`; used only by `test/session-management.test.js:6` (`require('session-file-store')(session)`). **Not** a silent runtime fallback — `index.js` and `config/session.js` use `connect-pg-simple` exclusively. The test exercises an alternative session store; legitimate test-only dep. **Keep.**
  - **`eslint-config-prettier`** — `import prettierConfig from 'eslint-config-prettier'` in `eslint.config.mjs:35`. **Keep.**
  - **`@types/*`** — `@types/node` is implicitly enabled by `tsconfig.json:"types": ["node"]` (consumed by `typecheck` script `tsc --noEmit`). `@types/pg` is consumed by JSDoc `import('pg').Pool` / `import('pg').PoolClient` / `import('pg').QueryResult` in `db/postgres.js`, `db/transaction.js`, `db/types.js` — `tsconfig.json` includes `db/**/*.js` with `checkJs: true`. **Both keep.**
  - **`tailwindcss`** — referenced by `src/styles/input.css:1` (`@import 'tailwindcss';`) which is processed at build time by `@tailwindcss/postcss`. Top-level entry is load-bearing for `@import` resolution and for the JSDoc `@type {import('tailwindcss').Config}` annotation in `tailwind.config.js:1`. **Keep.**
  - **`postcss`** — declared as a `peerDependency` by `postcss-cli@11.0.1` (the `build:css`/`watch:css` binary). Required for the peer relationship. **Keep.**
- **Recently-added / DB-modernization context:** No dependency added or removed in the last 30 commits — the only recent dependency change was `cc561bf` (2026-01-05) which removed coverage. No LOW-confidence "too fresh to call" candidates.

---

## Findings

### F-5-1 — `c8` devDependency

- **Confidence:** **CERTAIN**
- **Type:** Stale devDependency (coverage tool whose infrastructure was deliberately removed)
- **Location:** `package.json:77` (`"c8": "^10.1.3"` in `devDependencies`)
- **Evidence:**
  - **Source-tree references:** ZERO. Grep across all files excluding `node_modules/`:
    - `require('c8')` / `from 'c8'` — no matches.
    - Literal `c8` token — appears only in `package.json:77` (the devDependency entry), `package-lock.json` (lockfile metadata, including transitive `node_modules/postcss-cli` which lists c8 as its own devDep — not relevant to us), `docs/audit/redundant-code-audit.md` (this audit plan), and an unrelated hex color literal `#0a0e27` inside `.agents/skills/uncodixfy/SKILL.md` / `Uncodixfy.md` (false match on the substring `c8` inside hex).
  - **Scripts:** No `package.json` script contains `c8 `. The previous invocation was `"test:coverage": "c8 --reporter=text --reporter=html --reporter=lcov node --test"` and it was deleted alongside `c8` from the `test:all` chain in commit `cc561bf`.
  - **Config files:** No `.c8rc*`, no `nyc.config.*`, no `.nycrc`. The file `.c8rc.json` existed previously and was deleted by `cc561bf` (confirmed in the commit's stat: `.c8rc.json | 26 --`).
  - **CI / Docker:** `.github/workflows/docker-build.yml` does not invoke `c8` or `npm run test:coverage`. `Dockerfile`, `docker-compose.yml`, `docker-compose.local.yml` do not reference it.
  - **Binary invocation:** `c8` provides a `c8` bin; nothing in `scripts/`, `.github/workflows/`, `package.json`, or `Dockerfile` calls it.
  - **Git history confirms intent:** commit `cc561bf8d1d992167e731eac972ac1333ad1733b` (2026-01-05) — *"Remove test coverage infrastructure"* — explicitly deleted `.c8rc.json`, the `test:coverage` script, the c8 step from `test:all`, and the c8 invocation in `scripts/run-tests.sh`. The author's stated intent was complete removal of c8 coverage tooling. The `devDependencies` entry was missed in that commit (a 4-line oversight).
- **Indirect-usage / dynamic-dispatch check:** None possible. `c8` is a CLI coverage tool with no programmatic consumers in this codebase.
- **Public API / external consumer check:** N/A — devDependency.
- **Doc fallout (not in Phase 5 scope but for Phase 9 awareness):** Several docs still reference the removed `npm run test:coverage` script — `AGENTS.md:32, :48, :962, :997`, `TESTING.md:126`, `README.md:305, :343`. These are stale references to a removed script (Phase 9 / Phase 12 territory), independent of whether the `c8` dep is removed. Mention only so the Phase 9 sweep notices them.
- **Removal impact:** None on runtime, build, lint, type-check, or tests. `npm ci` / `npm install` will skip the entry; the resulting lockfile will drop ~50 transitive packages (per the lockfile entries under `node_modules/c8/**` and dedicated `c8` dependencies). No installed binary will be lost that any script invokes.
- **Recommendation:** **Remove** — delete the `"c8": "^10.1.3"` line from `devDependencies`, then run `npm install` to refresh `package-lock.json`. Commit as its own atomic change.
- **Verification steps for human reviewer:**
  - `npm install` after removing the entry — lockfile diff should show only c8 + transitive removals; no production dep churn expected.
  - `npm run lint:strict && npm test` should still pass (c8 was never invoked from any current script).
  - `npm run typecheck` should still pass.
  - Optionally update doc references to `test:coverage` in Phase 9.

---

## Verification methodology

For each of the 50 dependencies in `package.json` (`dependencies` ∪ `devDependencies`):

1. **Static import grep** — `require('<name>')`, `require("<name>")`, `from '<name>'`, `from "<name>"` across the entire repo excluding `node_modules/`.
2. **Bin / script grep** — every `package.json` `scripts` entry was read; binaries provided by each package (`eslint`, `prettier`, `tsc`, `nodemon`, `concurrently`, `vite`, `postcss`, `playwright`, `nyc`/`c8`, etc.) were searched verbatim in script bodies.
3. **Config-file grep** — `eslint.config.mjs`, `postcss.config.js`, `tailwind.config.js`, `playwright.config.js`, `vite.config.js`, `tsconfig.json`, `.prettierrc`, `Dockerfile`, `docker-compose*.yml`, `.github/workflows/*.yml`.
4. **Peer/transitive-dep awareness** — for `postcss` (peer of `postcss-cli`), `prettier` (peer of `eslint-plugin-prettier`), `tailwindcss` (`@import` from CSS).
5. **JSDoc type-import sweep** — `import('pg')` style references for `@types/pg`; tsconfig `types` for `@types/node`.
6. **Git-history sanity** — `git log -S '"<name>":' -- package.json` for any dep that had no static match.

Findings count is intentionally low (1) because Phase 0 already established the codebase as densely wired — every other devDependency is reachable through at least one of the six channels above.
