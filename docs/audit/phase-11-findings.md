# Phase 11 — Findings

**Run:** 2026-05-12  |  **Phase:** 11 — Stale scripts / CI / patches

## Summary

- Total candidates: **3** (CERTAIN: 2, HIGH: 0, MEDIUM: 1, LOW: 0)
- Scripts in scope: **10**; Patches: **1**; Workflows: **1**; initdb files: **1**
- Git-hooks dir: none (no `.husky/`; `.git/hooks/` contains only `*.sample` files — no installed hooks)

## Scope inventory

### `scripts/` (10 files)

| File | Wired via |
|------|-----------|
| [`scripts/migrate.js`](../../scripts/migrate.js) | `package.json` scripts `migrate`, `migrate:up`, `migrate:down`, `migrate:status`, `migrate:create` |
| [`scripts/update-changelog.js`](../../scripts/update-changelog.js) | `package.json` scripts `changelog`, `changelog:quick`, `changelog:git` |
| [`scripts/ci-changelog.js`](../../scripts/ci-changelog.js) | `.github/workflows/docker-build.yml:181` (`run: node scripts/ci-changelog.js`) |
| [`scripts/maintainability-report.js`](../../scripts/maintainability-report.js) | `package.json` scripts `report:maintainability`, `report:maintainability:json`, `lint:structure:baseline` |
| [`scripts/run-tests.sh`](../../scripts/run-tests.sh) | `package.json` script `test` (`bash scripts/run-tests.sh`) |
| [`scripts/setup-git-hooks.sh`](../../scripts/setup-git-hooks.sh) | `package.json` script `changelog:setup`; documented in [`AGENTS.md:156-158`](../../AGENTS.md) |
| [`scripts/optimize-icons.sh`](../../scripts/optimize-icons.sh) | `package.json` script `optimize:icons` |
| [`scripts/docker-entrypoint-upgrade.sh`](../../scripts/docker-entrypoint-upgrade.sh) | [`docker-compose.yml:63-64`](../../docker-compose.yml) (mounted as `:ro`, set as `entrypoint:`) |
| [`scripts/deduplicate-list-items.js`](../../scripts/deduplicate-list-items.js) | **NONE** — see F-11-1 |
| [`scripts/resize-existing-images.js`](../../scripts/resize-existing-images.js) | **NONE** — see F-11-2 |

### `patches/` (1 file)

| File | Wired via |
|------|-----------|
| [`patches/eslint-plugin-security+3.0.1.patch`](../../patches/eslint-plugin-security+3.0.1.patch) | `package.json` `postinstall: "patch-package \|\| true"`; [`Dockerfile:21`](../../Dockerfile) + [`Dockerfile:57`](../../Dockerfile) (`COPY patches/ patches/`); documented in [`eslint.config.mjs:1-21`](../../eslint.config.mjs) |

### `.github/workflows/` (1 file)

| File | Trigger | One-line summary |
|------|---------|------------------|
| [`docker-build.yml`](../../.github/workflows/docker-build.yml) | `push: branches: [main]` | Runs three jobs: `test` (lint + structural baseline + `npm test`), `e2e` (Playwright against built server), `build` (regenerates changelog via `scripts/ci-changelog.js`, builds and pushes Docker image to GHCR). |

References inside the workflow that need to exist: `scripts/ci-changelog.js` (✓ exists), `npm run lint`, `npm run lint:structure:baseline`, `npm test`, `npm run build`, `node index.js`, `npx playwright test`. All present.

### `docker-entrypoint-initdb.d/` (1 file)

| File | Executed by |
|------|-------------|
| [`docker-entrypoint-initdb.d/01-extensions.sql`](../../docker-entrypoint-initdb.d/01-extensions.sql) | `postgres:18.1` image's first-boot `/docker-entrypoint-initdb.d/*` hook. **Only mounted in `docker-compose.local.yml:77`**; **not mounted in the production `docker-compose.yml`**. See F-11-3. |

### Git-hooks dirs

- No `.husky/` directory exists.
- `.git/hooks/` contains only `.sample` files (git defaults); no installed hooks.
- `scripts/setup-git-hooks.sh` is an opt-in installer the user runs via `npm run changelog:setup` — it writes into `.git/hooks/pre-commit` and `.git/hooks/post-commit`. The hooks it generates reference `npm run format`, `npm run lint:fix`, and `npm run changelog`, all of which exist.

## Findings

### F-11-1 — `scripts/deduplicate-list-items.js`

- **Confidence:** CERTAIN
- **Location:** [`scripts/deduplicate-list-items.js`](../../scripts/deduplicate-list-items.js)
- **Type:** Dead script (one-off migration, never re-wired)
- **Evidence:**
  - Searched scopes: `package.json` scripts block, `Dockerfile`, `docker-compose.yml`, `docker-compose.local.yml`, all `.github/workflows/*.yml`, `scripts/setup-git-hooks.sh`, all `*.md` (README, AGENTS, docs/, root), all `*.js`/`*.mjs`/`*.sh` repo-wide.
  - Matches for `deduplicate-list-items`: only `docs/audit/redundant-code-audit.md` (the audit doc that flagged it) and the file's own body (`async function deduplicateListItems()`, `deduplicateListItems().catch(...)`).
  - Function name `deduplicateListItems` itself is not referenced outside the script.
  - Header comment frames this as a one-time migration: "NULL-ifies fields that match albums table to save storage. Expected savings: ~13 MB". The savings have presumably already been realized; running it again is idempotent (re-NULLs already-NULL rows).
  - Not invoked by any cron / external orchestration that exists in this repo (no `cron`, `crontab`, or `systemd` references anywhere — verified via grep).
- **Removal Impact:** None at runtime. Removing the file does not affect any wired npm script, CI job, Docker build, or `package.json` scripts block. If the user ever needs to re-run a one-off backfill, the script remains in git history.
- **Recommendation:** **remove** (matches user pre-approved decision F-0-13 #2 — "remove if Phase 11 confirms no caller anywhere — CI, Docker, cron, docs"). Atomic removal commit: delete the single file.
- **Verification questions for user:** None — pre-approved. (Caveat: if the script is invoked externally by an ops process not represented in this repo, Phase 11 cannot detect that. Confirm there is no out-of-repo runbook that calls it.)

### F-11-2 — `scripts/resize-existing-images.js`

- **Confidence:** CERTAIN
- **Location:** [`scripts/resize-existing-images.js`](../../scripts/resize-existing-images.js)
- **Type:** Dead script (one-off migration, never re-wired)
- **Evidence:**
  - Searched scopes: same as F-11-1.
  - Matches for `resize-existing-images`: only `docs/audit/redundant-code-audit.md` (audit doc) and the file itself.
  - The script's header explicitly tags it as a backfill script: "Migration script to resize all existing album cover images to 512x512 pixels. Processes the albums table only (list_items no longer stores cover images)."
  - Confirms it is the OLD shape of the data model — list_items no longer holds cover images. Going forward, new uploads are resized at write-time by [`utils/image-processor.js`](../../utils/image-processor.js) / `sharp` (verified by Phase 0 stack notes).
  - Not invoked by cron or external orchestration in this repo (no cron/systemd refs).
- **Removal Impact:** None at runtime. Same as F-11-1.
- **Recommendation:** **remove** (matches user pre-approved decision F-0-13 #2). Atomic removal commit: delete the single file.
- **Verification questions for user:** Same caveat as F-11-1: confirm there is no out-of-repo runbook that calls this script.

### F-11-3 — `docker-entrypoint-initdb.d/01-extensions.sql`

- **Confidence:** MEDIUM
- **Location:** [`docker-entrypoint-initdb.d/01-extensions.sql`](../../docker-entrypoint-initdb.d/01-extensions.sql)
- **Type:** Possibly redundant init script (overlap with migration + CI manual setup)
- **Evidence:**
  - Three-line file: `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS "pgcrypto";`.
  - **Mount points:**
    - `docker-compose.local.yml:77` mounts the directory: `./docker-entrypoint-initdb.d:/docker-entrypoint-initdb.d` ✓
    - `docker-compose.yml` (production) does **NOT** mount it. Production's `db` service has only `postgres-data:/var/lib/postgresql` and `postgres-socket:/var/run/postgresql`, plus the upgrade-script bind mount.
  - **CI** (`.github/workflows/docker-build.yml:52-53, 125-126`) runs both extensions explicitly via `psql` — does not use this file (CI doesn't mount it, its postgres service has no init.d volume).
  - **Migration 038** ([`db/migrations/migrations/038_add_list_groups.js:19`](../../db/migrations/migrations/038_add_list_groups.js)) already runs `CREATE EXTENSION IF NOT EXISTS pgcrypto` at app boot. So `pgcrypto` is set up by the migration runner even without the init file.
  - **`uuid-ossp`**: searched the entire codebase for `uuid-ossp` and `uuid_generate` — only appears in this init SQL and the CI workflow's `psql -c` lines. **No migration creates `uuid-ossp`**, and **no SQL in the app calls `uuid_generate_*()`** (verified by repo-wide grep). So `uuid-ossp` is created on first boot only in `docker-compose.local.yml` and in CI, but is not actually used by any application SQL.
  - Net effect of the init file:
    - In local dev (docker-compose.local.yml): creates `uuid-ossp` (unused) + `pgcrypto` (also created by migration 038).
    - In production (docker-compose.yml): the file is in the repo but **not mounted** — it does nothing.
    - In CI: the workflow runs equivalent `psql` commands itself; the file is not involved.
- **Removal Impact:**
  - Removing the file alone: local dev would lose its `uuid-ossp` (no impact — unused) and would lose its first-boot `pgcrypto` (migration 038 still creates it before any code reads from `list_groups`). Production unaffected (not mounted there). CI unaffected (uses inline psql).
  - Removing the bind mount in `docker-compose.local.yml:77` would also be needed if the file is deleted; otherwise it silently mounts an empty dir.
- **Recommendation:** **needs-info / keep until investigated**. Even though the file is not load-bearing at the application SQL level today, this is a cross-cutting infra question:
  1. **Is `uuid-ossp` deliberate future-proofing or a legacy leftover?** It is created in both local-dev (via this file) and CI (via inline psql) but never consumed by code today. If it's leftover, both the init file AND the two CI lines that create `uuid-ossp` (`docker-build.yml:52, 125`) are equally redundant.
  2. **Why is the init file not mounted in production?** Either (a) production relies on migration 038 to bootstrap pgcrypto and never needed uuid-ossp at all, or (b) the production mount was forgotten. Recommend the user confirm intent before any change.
- **Verification questions for user:**
  - Is `uuid-ossp` intentionally pre-installed for a future feature? If not: it is unused everywhere (no migration, no service query references it) and the two CI `psql` lines plus this SQL file would all be removable.
  - Should `docker-compose.yml` (production) also mount `docker-entrypoint-initdb.d` for parity with local-dev? If your fresh-production-DB workflow has worked without it, that confirms the init file isn't load-bearing.

## Items verified as NOT redundant

The following infrastructure files were investigated and confirmed live. No action needed.

- **`scripts/migrate.js`** — wired through 5 npm scripts.
- **`scripts/update-changelog.js`** — wired through 3 npm scripts and the `setup-git-hooks.sh` post-commit hook (which calls `npm run changelog`).
- **`scripts/ci-changelog.js`** — confirmed wired in `.github/workflows/docker-build.yml:181`. Phase 0's hypothesis (F-0-13 #3) is confirmed.
- **`scripts/maintainability-report.js`** — wired through 3 npm scripts including `lint:structure:baseline` which is invoked from CI (`docker-build.yml:76`).
- **`scripts/run-tests.sh`** — wired through `npm test`.
- **`scripts/setup-git-hooks.sh`** — wired through `npm run changelog:setup` and documented in [`AGENTS.md:156-158`](../../AGENTS.md).
- **`scripts/optimize-icons.sh`** — wired through `npm run optimize:icons`.
- **`scripts/docker-entrypoint-upgrade.sh`** — confirmed wired as the `db` service entrypoint in [`docker-compose.yml:63-64`](../../docker-compose.yml). Handles PG16→17 and PG17→18 upgrades; the PG16→17 branch is now dead code on a fresh-PG18 install but kept for any existing PG16/PG17 deployments. Phase 0's hypothesis (F-0-13 #4) is confirmed.
- **`patches/eslint-plugin-security+3.0.1.patch`** — Verified all preconditions for keeping:
  1. Target package `eslint-plugin-security` is still in `package.json:83` at `^3.0.1` (matches patch filename version).
  2. `patch-package` is still in `package.json:85` (devDep) AND in `package.json:6` `postinstall: "patch-package || true"`.
  3. Dockerfile still copies `patches/` (lines 21 and 57) before `npm ci`.
  4. `eslint.config.mjs:8-22` header explicitly documents this patch and the conditions for its removal: "Once eslint-plugin-security >= 3.1 (or whichever version fixes [issue #185](https://github.com/eslint-community/eslint-plugin-security/issues/185)) is released, upgrade the dependency and delete the patch file."
  Currently pinned to `^3.0.1`; npm-registry status of `eslint-plugin-security >= 3.1` was NOT checked per task constraints. **Not flagging for removal in Phase 11 — this is a Phase 5 (deps) follow-up: bump the dep and the patch becomes removable, but that requires verifying upstream first.**
- **`.github/workflows/docker-build.yml`** — Single workflow. Every referenced script exists. No dead workflow references.

## Cross-references

- Phase 0 entry-point set: F-0-2.
- Phase 0 open question on unwired scripts: F-0-13 #2 (resolved by F-11-1 + F-11-2).
- Phase 0 open questions on `ci-changelog.js` and `docker-entrypoint-upgrade.sh`: F-0-13 #3 + #4 (resolved — both wired, no action).
- Phase 5 follow-up: when bumping `eslint-plugin-security` past the upstream fix, also remove `patches/eslint-plugin-security+3.0.1.patch`, the `COPY patches/` lines in `Dockerfile`, the `postinstall` script in `package.json`, and the `patch-package` devDep.
