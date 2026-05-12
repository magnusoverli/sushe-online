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
| 0     | Baseline & ground truth            | S      | pending     |         |           |            | Blocks every other phase |
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
