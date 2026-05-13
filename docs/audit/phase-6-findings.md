# Phase 6 — Unused env vars & config keys

Scope: every key declared in `.env.example` vs every `process.env.X` read across `*.js` / `*.mjs`, plus references in `docker-compose*.yml`, `Dockerfile`, `.github/workflows/**`, and `*.sh`.

## Inventory

### `.env.example` declared keys (25 entries, 16 commented-out)

Only one example file exists at the repo root: [`.env.example`](../../.env.example). No `.env.sample` or `.env.local.example`.

| # | Key | Line | Form |
| - | --- | ---- | ---- |
| 1 | `SESSION_SECRET` | 2 | active |
| 2 | `SESSION_SECRET_REQUIRED` | 4 | commented |
| 3 | `RESEND_API_KEY` | 8 | active |
| 4 | `EMAIL_FROM` | 9 | active |
| 5 | `SENDGRID_API_KEY` | 13 | commented |
| 6 | `EMAIL_FROM` (dup) | 14 | commented |
| 7 | `BASE_URL` | 17 | active |
| 8 | `SPOTIFY_CLIENT_ID` | 20 | active |
| 9 | `SPOTIFY_CLIENT_SECRET` | 21 | active |
| 10 | `SPOTIFY_REDIRECT_URI` | 22 | active |
| 11 | `TIDAL_CLIENT_ID` | 25 | active |
| 12 | `TIDAL_REDIRECT_URI` | 26 | active |
| 13 | `LASTFM_API_KEY` | 30 | active |
| 14 | `LASTFM_SECRET` | 31 | active |
| 15 | `DATABASE_URL` | 34 | active |
| 16 | `LOG_LEVEL` | 37 | active |
| 17 | `TRUST_PROXY` | 42 | commented |
| 18 | `ALLOWED_ORIGINS` | 47 | commented |
| 19 | `CORS_STRICT_MODE` | 49 | commented |
| 20 | `ADMIN_CODE_LOG_MODE` | 53 | commented |
| 21 | `RATE_LIMIT_FORGOT_MAX` | 57 | commented |
| 22 | `RATE_LIMIT_RESET_MAX` | 58 | commented |
| 23 | `RATE_LIMIT_LOGIN_MAX` | 59 | commented |
| 24 | `RATE_LIMIT_REGISTER_MAX` | 60 | commented |
| 25 | `DISABLE_RATE_LIMITING` | 61 | commented |

### Verification of each key

For every key in the table above, I confirmed it is read at least once in code, tests, docker-compose, or Dockerfile:

| Key | Confirmed consumer |
| --- | ------------------ |
| `SESSION_SECRET` | [`config/session.js:22`](../../config/session.js#L22), [`services/telegram.js:372`](../../services/telegram.js#L372), [`docker-compose.yml:11`](../../docker-compose.yml#L11), [`.github/workflows/docker-build.yml:33`](../../.github/workflows/docker-build.yml#L33) |
| `SESSION_SECRET_REQUIRED` | [`config/session.js:21`](../../config/session.js#L21), [`test/session-config.test.js:56`](../../test/session-config.test.js#L56) |
| `RESEND_API_KEY` | [`routes/api/password-reset.js:105,106,114`](../../routes/api/password-reset.js#L105), [`docker-compose.local.yml:40`](../../docker-compose.local.yml#L40) |
| `EMAIL_FROM` | [`utils/forgot-email.js:148`](../../utils/forgot-email.js#L148), [`test/forgot-email.test.js`](../../test/forgot-email.test.js), [`docker-compose.yml:13`](../../docker-compose.yml#L13), [`docker-compose.local.yml:16`](../../docker-compose.local.yml#L16) |
| `SENDGRID_API_KEY` | [`routes/api/password-reset.js:105,114`](../../routes/api/password-reset.js#L105), [`docker-compose.yml:12`](../../docker-compose.yml#L12), [`README.md:168`](../../README.md#L168) |
| `BASE_URL` | [`services/telegram.js:373`](../../services/telegram.js#L373), [`routes/oauth/lastfm.js:34`](../../routes/oauth/lastfm.js#L34), [`routes/api/password-reset.js:120`](../../routes/api/password-reset.js#L120), [`routes/api/proxies.js:135`](../../routes/api/proxies.js#L135), `docker-compose*.yml` |
| `SPOTIFY_CLIENT_ID` | [`routes/oauth/spotify.js:33,66`](../../routes/oauth/spotify.js#L33), docker-compose files |
| `SPOTIFY_CLIENT_SECRET` | [`routes/oauth/spotify.js:67`](../../routes/oauth/spotify.js#L67), docker-compose files |
| `SPOTIFY_REDIRECT_URI` | [`routes/oauth/spotify.js:35,65`](../../routes/oauth/spotify.js#L35), docker-compose files |
| `TIDAL_CLIENT_ID` | [`routes/oauth/tidal.js:43,73,110`](../../routes/oauth/tidal.js#L43), [`services/tidal-service.js:44`](../../services/tidal-service.js#L44), docker-compose files |
| `TIDAL_REDIRECT_URI` | [`routes/oauth/tidal.js:44,75`](../../routes/oauth/tidal.js#L44), docker-compose files |
| `LASTFM_API_KEY` | [`routes/oauth/lastfm.js:26,58`](../../routes/oauth/lastfm.js#L26), [`routes/api/lastfm.js`](../../routes/api/lastfm.js) (7 sites), [`services/playcount-sync-service.js:227`](../../services/playcount-sync-service.js#L227), docker-compose files |
| `LASTFM_SECRET` | [`routes/oauth/lastfm.js:59`](../../routes/oauth/lastfm.js#L59), [`routes/api/lastfm.js:260,287`](../../routes/api/lastfm.js#L260), docker-compose files |
| `DATABASE_URL` | [`db/index.js:25,28`](../../db/index.js#L25), [`scripts/migrate.js:12,17`](../../scripts/migrate.js#L12), [`scripts/resize-existing-images.js:16`](../../scripts/resize-existing-images.js#L16), [`scripts/deduplicate-list-items.js:14`](../../scripts/deduplicate-list-items.js#L14), tests, docker-compose, CI workflow |
| `LOG_LEVEL` | [`utils/logger.js:293,294`](../../utils/logger.js#L293), docker-compose files |
| `TRUST_PROXY` | [`index.js:123,124,126`](../../index.js#L123) |
| `ALLOWED_ORIGINS` | [`utils/origin-policy.js:78`](../../utils/origin-policy.js#L78), [`test/security-config.test.js`](../../test/security-config.test.js), [`test/origin-policy.test.js`](../../test/origin-policy.test.js) |
| `CORS_STRICT_MODE` | [`utils/origin-policy.js:77`](../../utils/origin-policy.js#L77), `test/security-config.test.js`, `test/origin-policy.test.js` |
| `ADMIN_CODE_LOG_MODE` | [`config/admin-code.js:31,54`](../../config/admin-code.js#L31), [`test/admin-code.test.js`](../../test/admin-code.test.js) |
| `RATE_LIMIT_FORGOT_MAX` | [`middleware/rate-limit.js:91`](../../middleware/rate-limit.js#L91), [`test/rate-limit.test.js`](../../test/rate-limit.test.js) |
| `RATE_LIMIT_RESET_MAX` | [`middleware/rate-limit.js:101`](../../middleware/rate-limit.js#L101), `test/rate-limit.test.js` |
| `RATE_LIMIT_LOGIN_MAX` | [`middleware/rate-limit.js:74`](../../middleware/rate-limit.js#L74), `test/rate-limit.test.js` |
| `RATE_LIMIT_REGISTER_MAX` | [`middleware/rate-limit.js:83`](../../middleware/rate-limit.js#L83), `test/rate-limit.test.js` |
| `DISABLE_RATE_LIMITING` | [`middleware/rate-limit.js:19`](../../middleware/rate-limit.js#L19), docker-compose.local, CI workflow |

**Every `.env.example` entry — active or commented — is read by code or referenced in deployment/CI configuration. There are zero CERTAIN-removable entries.**

---

## Summary

- `.env.example` keys analyzed: 25 (16 commented-out, 9 active)
- Distinct env vars read in code (`process.env.X`): 50+
- CERTAIN (safe to remove from `.env.example`): **0**
- HIGH: 0
- MEDIUM: 0
- LOW (suggestive only): 0
- Documentation gaps (env vars read in code but not in `.env.example`): **21** — flagged separately below

---

## Findings

### F-6-1 — `.env.example` has zero stale entries
- **Location**: `.env.example` (whole file)
- **Type**: N/A — negative result
- **Confidence**: N/A
- **Evidence**:
  - Searches performed: literal grep for each of the 25 declared key names across `*.js`, `*.mjs`, `*.sh`, `*.yml`, `*.yaml`, `Dockerfile`, `*.md`.
  - References found: every key resolves to at least one active consumer in app code, tests, docker-compose, or `.github/workflows/docker-build.yml`. See "Verification of each key" table.
  - Dynamic usage check: `middleware/rate-limit.js:62` reads via `process.env[envVar]` with `envVar` strings hardcoded to the `RATE_LIMIT_*` names declared in `.env.example`. Verified all four rate-limit envVar strings (`RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_REGISTER_MAX`, `RATE_LIMIT_FORGOT_MAX`, `RATE_LIMIT_RESET_MAX`) appear in `createRateLimiter()` call sites.
  - Public API check: `.env.example` is itself the public API surface for env config; consumers are deployers, not code.
  - Test coverage: `test/rate-limit.test.js`, `test/session-config.test.js`, `test/admin-code.test.js`, `test/security-config.test.js`, `test/origin-policy.test.js`, `test/forgot-email.test.js` all exercise env-var-driven behavior.
- **Removal Impact**: N/A
- **Recommendation**: **Preserve** all 25 entries. No removal candidates exist in this phase.
- **Verification steps for human reviewer**: None — this is a negative result. Phase 6 has no removal output.

---

## Documentation gaps (read in code, missing from `.env.example`)

These are not removal candidates — they are the opposite problem. Surfacing them as a side product of the cross-reference. Severity follows: **important** (configurable behavior with non-default impact), **operational** (production-tuning knobs), **dev-only** (test/dev workflow).

### F-6-2 — `RATE_LIMIT_SETTINGS_MAX` undocumented in `.env.example`
- **Location**: read at [`middleware/rate-limit.js:110`](../../middleware/rate-limit.js#L110); referenced in [`test/rate-limit.test.js`](../../test/rate-limit.test.js) and documented in [`README.md:259`](../../README.md#L259).
- **Severity**: important
- **Why it matters**: The other four `RATE_LIMIT_*_MAX` knobs are documented in `.env.example` (lines 57–60). `RATE_LIMIT_SETTINGS_MAX` is the fifth peer and follows the same pattern (`createRateLimiter({ envVar: 'RATE_LIMIT_SETTINGS_MAX', defaultMax: 10, ... })`) — its omission from `.env.example` is asymmetric.
- **Recommendation**: Add a commented-out `# RATE_LIMIT_SETTINGS_MAX=10` line alongside the other rate-limit comments.

### F-6-3 — Admin backup / restore env vars undocumented
- **Location**: read in [`services/admin-backup-service.js:34-56`](../../services/admin-backup-service.js#L34): `PG_MAJOR`, `PG_BIN`, `PG_DUMP`, `PG_RESTORE`, `RESTORE_MAX_FILE_BYTES`, `RESTORE_TIMEOUT_MS`, `RESTORE_PREFLIGHT_ENABLED`. `PG_MAJOR` is set in [`docker-compose.local.yml:21`](../../docker-compose.local.yml#L21); the others have no compose/env reference.
- **Severity**: operational
- **Why it matters**: Admins debugging backup/restore failures have no discoverable list of override knobs. The defaults (`/usr/lib/postgresql/${pgMajor}/bin`, `pg_dump`, `pg_restore`, etc.) work for the published image, but custom Postgres installs need overrides.
- **Recommendation**: Add an "Admin backup overrides" section to `.env.example` with all 7 vars as commented examples plus their defaults.

### F-6-4 — Claude / Anthropic summary env vars undocumented
- **Location**: read in [`utils/claude-summary.js`](../../utils/claude-summary.js): `ANTHROPIC_API_KEY` (370), `CLAUDE_MODEL` (397), `CLAUDE_MAX_TOKENS` (398), `CLAUDE_REQUEST_TIMEOUT_MS` (400), `CLAUDE_RATE_LIMIT_MS` (16), `CLAUDE_SUMMARY_MIN_CHARS` (182), `CLAUDE_SUMMARY_MAX_CHARS` (183, 410), `CLAUDE_SUMMARY_MIN_SENTENCES` (185), `CLAUDE_SUMMARY_SENTENCES` (406). Five of these (`ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_MAX_TOKENS`, `CLAUDE_RATE_LIMIT_MS`, `ALBUM_SUMMARY_CONCURRENCY`) are set in `docker-compose.yml` / `docker-compose.local.yml`.
- **Severity**: important (`ANTHROPIC_API_KEY` is required for AI features)
- **Why it matters**: The Claude integration is a substantial feature with no discoverability in `.env.example`. New deployers can't configure album summaries without reading the source.
- **Recommendation**: Add a "Claude / AI Configuration" section to `.env.example`.

### F-6-5 — `ALBUM_SUMMARY_CONCURRENCY` and `ALBUM_SUMMARY_PAGE_SIZE` undocumented
- **Location**: read in [`services/album-summary.js:190,601,625`](../../services/album-summary.js#L190). `ALBUM_SUMMARY_CONCURRENCY` is in `docker-compose.local.yml:38`.
- **Severity**: operational
- **Recommendation**: Add to the new "Claude / AI Configuration" section.

### F-6-6 — `IMAGE_REFETCH_PAGE_SIZE` undocumented
- **Location**: read in [`services/image-refetch.js:368`](../../services/image-refetch.js#L368).
- **Severity**: operational
- **Recommendation**: Document as a commented example.

### F-6-7 — Database tuning env vars undocumented
- **Location**: read in [`db/index.js:16,41`](../../db/index.js#L16) (`DATA_DIR`, `PG_APP_NAME`) and [`db/postgres.js:31,114`](../../db/postgres.js#L31) (`DB_SLOW_QUERY_MS`, `LOG_SQL`). `DATA_DIR` is set in `docker-compose.yml:16` and `docker-compose.local.yml:19`.
- **Severity**: operational
- **Recommendation**: Document `DATA_DIR` as active in `.env.example`, others as commented examples.

### F-6-8 — `DB_READY_MAX_MS` undocumented
- **Location**: read in [`routes/health.js:51`](../../routes/health.js#L51).
- **Severity**: operational (controls k8s readiness probe threshold)
- **Recommendation**: Document as a commented example near healthcheck-related comments.

### F-6-9 — `ENABLE_HSTS` undocumented
- **Location**: read in [`config/security.js:27`](../../config/security.js#L27).
- **Severity**: important (security-relevant; gates HSTS header in production)
- **Recommendation**: Document explicitly — production deployers need this discoverable.

### F-6-10 — `ENABLE_PREFERENCE_SYNC`, `ENABLE_PLAYCOUNT_SYNC` undocumented
- **Location**: read in [`config/startup-services.js:47,71`](../../config/startup-services.js#L47).
- **Severity**: operational (feature flags for startup background jobs)
- **Recommendation**: Document as commented examples; mention that production enables them automatically.

### F-6-11 — `NODE_ENV`, `PORT`, `NO_COLOR`, `ASSET_VERSION` undocumented
- **Location**: read in `index.js`, `utils/logger.js`, `templates.js`, and many other files. `NODE_ENV` and `PORT` are set in docker-compose; `NO_COLOR` set in both compose files.
- **Severity**: important for `NODE_ENV` and `PORT`; operational for the rest.
- **Why it matters**: `PORT` is the basic deploy knob and is missing from `.env.example`. `NODE_ENV` is a near-universal convention that should still be mentioned.
- **Recommendation**: Add an "Application Configuration" addition for `NODE_ENV` and `PORT`. `NO_COLOR` and `ASSET_VERSION` are optional cosmetic/cache-bust knobs — document as commented examples.

### F-6-12 — `TIDAL_CLIENT_SECRET` set in compose but never read
- **Location**: declared in [`docker-compose.local.yml:28`](../../docker-compose.local.yml#L28); zero matches in any `*.js`/`*.mjs` file across the repo (verified via grep).
- **Severity**: operational — different problem (dead compose entry, not undocumented env var).
- **Why it matters**: Tidal OAuth in this codebase uses the **PKCE flow** ([`routes/oauth/tidal.js`](../../routes/oauth/tidal.js)) and never sends a client secret; the token exchange uses `X-Tidal-Token: ${TIDAL_CLIENT_ID}` and a `code_verifier`. Setting `TIDAL_CLIENT_SECRET` does nothing.
- **Recommendation**: **Investigate** — likely safe to remove from `docker-compose.local.yml:28`, but confirm Tidal hasn't introduced a confidential-client option since the PKCE wiring was written. Not part of `.env.example`, so out of strict Phase 6 removal scope, but a related cleanup opportunity.
- **Confidence if it were a removal candidate**: HIGH (zero code references; PKCE flow is intentional).

### F-6-13 — Test-only env vars undocumented (acceptable)
- **Location**: `E2E_API_TEST_EMAIL`, `E2E_API_TEST_USERNAME`, `E2E_API_TEST_PASSWORD` in [`test/e2e/api-integration.spec.js:18-20`](../../test/e2e/api-integration.spec.js#L18). `PLAYWRIGHT_SKIP_SERVER`, `CI` in [`playwright.config.js`](../../playwright.config.js). `PG_BIN`, `PG_DUMP`, `PG_RESTORE` overrides used only in admin restore (covered in F-6-3).
- **Severity**: dev-only
- **Recommendation**: Leave as-is. `.env.example` is for app deployers, not test-runners. CI workflow already sets `PLAYWRIGHT_SKIP_SERVER`/`CI`.

---

## Reviewer notes / safety recommendations

- All `.env.example` entries pass verification. Phase 6 surfaces **zero removal candidates** — the existing `.env.example` is healthy.
- The documentation-gap findings (F-6-2..F-6-13) are deliberately *not* phrased as removal candidates. They are additions, not deletions; they fall outside the audit's redundant-code remit. Listing them here keeps the cross-reference complete and gives the user a single artifact when deciding whether to also do an "env-var documentation" pass.
- F-6-12 is the only "dead config" finding (a docker-compose entry that does nothing). Confirming the Tidal PKCE design hasn't changed upstream is the only verification step needed before removal would be safe.
- Per audit policy, no changes are recommended automatically. If the user wants to act on F-6-2..F-6-12, that work is an additive `.env.example` edit + one `docker-compose.local.yml` deletion line, all reversible.
