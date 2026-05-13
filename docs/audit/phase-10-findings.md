# Phase 10 — Obsolete / orphaned tests

**Scope:** Every `test/*.test.js` (168 files at repo root of `test/`), plus `test/e2e/*.spec.js` (5 Playwright specs), plus the shared `test/helpers.js`. Cross-referenced against:

- Files deleted in audit commits (`0396896`, `c880a1d`, `28fcf9c`, `ffc2fc0`).
- Phase 2 findings (`docs/audit/phase-2-findings.md`) — 18 CERTAIN and 13 HIGH "test-only seam" findings.
- Phase 1 findings (`docs/audit/phase-1-findings.md`) — no `.js` orphan removed; no test side-effects.

**Methodology:**
1. Enumerated all 168 unit/integration test files and 5 Playwright e2e specs.
2. Resolved every `require('../…')` and `await import('../…')` path against the working tree (PowerShell sweep). **All 168 test files resolve cleanly — zero tests import a now-deleted module.** None of the audit deletions so far (countries.txt, two scripts, two planning docs, one SQL init file) had any test consumer.
3. Searched `.skip(`, `.todo(`, `{ skip: true }` across `test/`. Hits restricted to `test/e2e/api-integration.spec.js:117,172,461` — all are conditional `test.skip(condition, ...)` guards for missing E2E env (legitimate; not always-skipped).
4. Read each test file that imports one of Phase 2's HIGH "test-only seam" or CERTAIN "dead-export" modules. Classified the test as:
   - **Whole-file removable** if every import target is a Phase 2 candidate.
   - **Surgery only (MEDIUM)** if the test file mixes Phase 2 candidates with production-live exports — must keep the file and drop only the relevant assertion blocks.
5. Confirmed `test/helpers.js` consumption: 34 test files require it (literal grep) — **never removable** unless every consumer is also removed (it isn't).
6. Playwright specs in `test/e2e/` exercise HTTP, not module imports — none can be flagged from a static module graph.

**Headline:** **1 whole-file CERTAIN removal candidate** (`test/response-helpers.test.js`, pairs with F-2-3). **17 paired-surgery findings** where the Phase 2 commit must also trim assertion blocks from a shared test file — these are not whole-file removals. **0 orphan tests** from earlier audit commits. **0 always-skipped or always-failing tests.** **0 broken imports** (every `require('../...')` resolves on disk).

---

## Findings

### F-10-1 — `test/response-helpers.test.js` — whole file orphans with F-2-3

- **Location:** `test/response-helpers.test.js` (entire file, 185 lines).
- **Type:** Orphan test file (target module is whole-file dead).
- **Confidence:** **CERTAIN**.
- **Pairs with:** F-2-3 (`utils/response-helpers.js` — entire module dead in production; only consumer is this test).
- **Evidence:**
  - Single `require` at line 3-8: imports `success, error, notFound, validationError` exclusively from `../utils/response-helpers`.
  - No other imports. No use of `test/helpers.js`. No production consumers of `utils/response-helpers.js` (per F-2-3).
  - The test has been verified to only exercise the four dead exports against a local `createMockRes()`.
- **Removal impact:** Delete the file in the same atomic commit that deletes `utils/response-helpers.js` (F-2-3). No assertion-renaming needed.
- **Recommendation:** **Remove together with F-2-3 in one atomic commit.**

### F-10-2 — `test/logger.test.js` — surgery only, pairs with F-2-1

- **Location:** `test/logger.test.js:51-78, 270-303` (formatMessage block + legacy methods/properties block + flushTimer block — approx 60 lines across 4 test cases).
- **Type:** Assertions exercising no-op compat seam (`formatMessage`, `writeToFile`, `writeToConsole`, `flushWriteQueue`, `writeQueue`, `flushTimer`).
- **Confidence:** **HIGH (surgery)**.
- **Pairs with:** F-2-1 (8 names on `utils/logger.js`).
- **Evidence:**
  - File is 320+ lines and asserts the live `createLogger`/`LogLevels`/`LogLevelNames`/`child`/`requestLogger`/`error`/`warn`/`info`/`debug`/`log`/`shutdown` surfaces — those MUST stay.
  - Only the four assertion blocks listed above touch the F-2-1 seam.
- **Removal impact:** Drop ~4 test cases (and any property assertions on `writeQueue`/`flushTimer` like lines 287, 297). File continues to exist and still gates the live pino-backed logger.
- **Recommendation:** **Surgical edit only**, paired with F-2-1.

### F-10-3 — `test/templates.test.js` — surgery only, pairs with F-2-2

- **Location:** `test/templates.test.js:706-755` (`headerComponent` describe), plus the `formatDate`, `formatDateTime`, and `asset` describe blocks higher up in the file (~lines 32-239).
- **Type:** Assertions exercising `templates.js` re-exports unused in production.
- **Confidence:** **HIGH (surgery)**.
- **Pairs with:** F-2-2 (`headerComponent`, `formatDate`, `formatDateTime`, `asset`).
- **Evidence:**
  - PowerShell counts: `headerComponent` 6 references, `formatDate` 22, `formatDateTime` 12, `asset` 8 — all inside this test only.
  - The rest of the 756-line file asserts the live exports (`htmlTemplate`, `spotifyTemplate`, `loginTemplate`, etc.) and must stay.
- **Removal impact:** Drop four `describe` blocks. File continues to exist.
- **Recommendation:** **Surgical edit only**, paired with F-2-2.

### F-10-4 — `test/album-summary.test.js` — surgery only, pairs with F-2-6

- **Location:** `test/album-summary.test.js` — `describe` blocks exercising `stripHtml`, `generateNameVariations`, `fetchAlbumSummary`, `SUMMARY_SOURCES`.
- **Type:** Test-only seam assertions.
- **Confidence:** **HIGH (surgery)**.
- **Pairs with:** F-2-6.
- **Evidence:** Imports at lines 3-9 destructure the four F-2-6 names alongside the live `createAlbumSummaryService`. The factory's behavior is the real production surface and must keep its tests.
- **Removal impact:** Drop the `stripHtml` / `generateNameVariations` / `fetchAlbumSummary` / `SUMMARY_SOURCES` describe blocks; keep `createAlbumSummaryService` tests.
- **Recommendation:** **Surgical edit only**, paired with F-2-6.

### F-10-5 — `test/auth-service.test.js` — surgery only, pairs with F-2-7

- **Location:** `test/auth-service.test.js` — assertions reading `BCRYPT_SALT_ROUNDS`, `SESSION_DEFAULT_MS`, `SESSION_REMEMBER_MS`, `EXTENSION_TOKEN_EXPIRY_MS`, `USER_DEFAULTS` directly.
- **Type:** Test-only constants.
- **Confidence:** **HIGH (surgery)**.
- **Pairs with:** F-2-7.
- **Evidence:** Imports at lines 3-10 destructure the 5 F-2-7 constants alongside `createAuthService` (live).
- **Removal impact:** Either drop the constant-asserting cases, or rewrite them to exercise the factory's bound behavior. The bulk of the file (factory tests) stays.
- **Recommendation:** **Surgical edit only**, paired with F-2-7.

### F-10-6 — `test/album-canonical.test.js` — surgery only, pairs with F-2-8

- **Location:** `test/album-canonical.test.js:8-16` (import block) + helper-specific describe blocks.
- **Type:** Test-only helper assertions for `generateInternalAlbumId`, `isBetterCoverImage`, `chooseBetterTracks`.
- **Confidence:** **HIGH (surgery)**.
- **Pairs with:** F-2-8.
- **Evidence:** Imports destructure 3 F-2-8 names alongside live `createAlbumCanonicalBase`, `sanitizeForStorage`, `normalizeForLookup`, `chooseBetterText`.
- **Recommendation:** **Surgical edit only**, paired with F-2-8.

### F-10-7 — `test/user-service.test.js` — surgery only, pairs with F-2-9

- **Location:** `test/user-service.test.js:3-10` (import block) + constant-asserting describe blocks.
- **Type:** Test-only constants.
- **Confidence:** **HIGH (surgery)**.
- **Pairs with:** F-2-9.
- **Evidence:** Imports destructure 5 F-2-9 constants alongside live `createUserService`. The factory tests are extensive and must stay.
- **Recommendation:** **Surgical edit only**, paired with F-2-9.

### F-10-8 — `test/user-preferences.test.js` — surgery only, pairs with F-2-11 (partial)

- **Location:** `test/user-preferences.test.js:13-16` (imports `filterGenreTags`, `GENRE_MAPPINGS` from `utils/affinity-calculator`).
- **Type:** Test-only seam (Phase 2 HIGH partial).
- **Confidence:** **HIGH (surgery)**.
- **Pairs with:** F-2-11 (the 2 HIGH names — `GENRE_MAPPINGS`, `filterGenreTags`). Note F-2-11's 11 CERTAIN names are internal-only — never touched by tests.
- **Evidence:** Test also imports `createUserPreferences` (`services/user-preferences-service.js`), `POSITION_POINTS`/`getPositionPoints` (`utils/scoring.js`), and `normalizeArtistName`/`normalizeAlbumName`/`normalizeGenre`/`artistNamesMatch` (`utils/normalization.js`) — none of which are Phase 2 candidates.
- **Removal impact:** Drop the `filterGenreTags` and `GENRE_MAPPINGS` assertion blocks only.
- **Recommendation:** **Surgical edit only**, paired with the HIGH half of F-2-11.

### F-10-9 — `test/fuzzy-match.test.js` — surgery only, pairs with F-2-12 (partial)

- **Location:** `test/fuzzy-match.test.js:8-21` (import block destructures 11 F-2-12 HIGH names alongside live `isPotentialDuplicate`).
- **Type:** Test-only seam.
- **Confidence:** **HIGH (surgery)**.
- **Pairs with:** F-2-12 (the 11 HIGH names — `levenshteinDistance`, `similarityRatio`, `normalizeForComparison`, `getTokens`, `jaccardSimilarity`, `calculateSimilarity`, `findPotentialDuplicates`, `isExactMatch`, `deriveMinScoreFromThreshold`, `AUTO_MERGE_THRESHOLD`, `MODAL_THRESHOLD`). F-2-12's 2 CERTAIN names (`STRIP_PATTERNS`, `ARTICLES`) are internal-only, never tested.
- **Removal impact:** Drop the 11 helper-specific describe blocks; keep tests around `isPotentialDuplicate`/`normalizeAlbumKey`.
- **Recommendation:** **Surgical edit only**, paired with F-2-12.

### F-10-10 — `test/lastfm-auth.test.js` — DEFER (pairs with F-2-14, which itself is needs-info)

- **Location:** `test/lastfm-auth.test.js` — covers `generateSignature`, `getTopTags`, `getUserInfo`, `getAllTopAlbums`, `getTagTopArtists`, `getTagTopAlbums`, `getArtistTopAlbums`, `getArtistTopTags`, `isSessionValid` (9 names).
- **Type:** Test-only seam, gated on user's Last.fm discovery roadmap decision.
- **Confidence:** **HIGH (surgery)** if F-2-14 is removed; otherwise keep.
- **Pairs with:** F-2-14.
- **Evidence:** Import block at lines 3-7 destructures `createLastfmAuth` and `normalizeForLastfm` only — but the test then exercises the 9 F-2-14 names through `const { generateSignature } = createLastfmAuth(...)` factory results (e.g., line 17). Means the tests reach the helpers *via the factory's closure*, not via top-level destructure. Removing the top-level `module.exports` keys wouldn't break the test; deleting the helpers themselves would.
- **Recommendation:** **DEFER pending user's F-2-14 decision.** If user confirms Last.fm discovery is shelved, drop the 9 helper describe blocks. If user keeps the discovery API, leave both module + tests alone.

### F-10-11 — `test/musicbrainz.test.js` — surgery only, pairs with F-2-15

- **Location:** `test/musicbrainz.test.js` — `searchArtist`/`getArtistById` describe blocks.
- **Type:** Test-only seam.
- **Confidence:** **HIGH (surgery)**.
- **Pairs with:** F-2-15.
- **Evidence:** Imports at line 4 destructure `createMusicBrainz` and `COUNTRY_CODE_MAP` only — like F-10-10, the F-2-15 helpers are reached through the factory's closure. The factory and `COUNTRY_CODE_MAP`/`resolveCountryCode` tests stay.
- **Removal impact:** Drop only the `searchArtist`/`getArtistById` describe blocks.
- **Recommendation:** **Surgical edit only**, paired with F-2-15.

### F-10-12 — `test/musicbrainz-helpers.test.js` — surgery only, pairs with F-2-16

- **Location:** `test/musicbrainz-helpers.test.js:3-9` (import block destructures `EU_COUNTRIES`, `scoreRelease` alongside live `SUSHE_USER_AGENT`, `selectBestRelease`, `extractTracksFromMedia`).
- **Type:** Test-only seam.
- **Confidence:** **HIGH (surgery)**.
- **Pairs with:** F-2-16.
- **Removal impact:** Drop the `EU_COUNTRIES` and `scoreRelease` describe blocks; keep the rest.
- **Recommendation:** **Surgical edit only**, paired with F-2-16.

### F-10-13 — `test/redirect-path.test.js` — surgery only, pairs with F-2-19

- **Location:** `test/redirect-path.test.js:4-7` (import block destructures `isSafeInternalPath`, `sanitizeReturnPath`).
- **Type:** Test-only seam — `isSafeInternalPath` is HIGH-removable, `sanitizeReturnPath` is live (Spotify/Tidal callbacks).
- **Confidence:** **HIGH (surgery)**.
- **Pairs with:** F-2-19.
- **Evidence:** File is short (30 lines). Three `it()` cases call `isSafeInternalPath` directly; one calls `sanitizeReturnPath`. Mixed.
- **Removal impact:** Drop the three `isSafeInternalPath` cases; keep the `sanitizeReturnPath` case.
- **Recommendation:** **Surgical edit only**, paired with F-2-19.

### F-10-14 — `test/validators.test.js` — surgery only, pairs with F-2-20

- **Location:** `test/validators.test.js:3-16` (import block destructures 8 F-2-20 names alongside 4 live ones).
- **Type:** Test-only seam.
- **Confidence:** **HIGH (surgery)**.
- **Pairs with:** F-2-20.
- **Evidence:** Imports `isValidEmail`, `isValidUsername`, `isValidPassword`, `validateYear` (live, must keep) + `validateListId`, `validateListName`, `validateOptionalString`, `validateRequiredString`, `validateArray`, `validateEnum`, `validateInteger`, `requireFields` (the 8 F-2-20 HIGH names).
- **Removal impact:** Drop the 8 helper-specific describe blocks; keep the 4 live-export tests.
- **Recommendation:** **Surgical edit only**, paired with F-2-20.

### F-10-15 — `test/error-handler.test.js` — surgery only, pairs with F-2-21 (HIGH half)

- **Location:** `test/error-handler.test.js:4-9` (import block).
- **Type:** Test-only seam — Phase 2 F-2-21 splits 3 CERTAIN (`ErrorCodes`, `sendErrorResponse`, `errorResponses` — never tested) + 3 HIGH (`ErrorTypes`, `AppError`, `createErrorHandler` — tested here).
- **Confidence:** **HIGH (surgery)**.
- **Pairs with:** F-2-21 (HIGH half only).
- **Evidence:** Imports `ErrorTypes`, `AppError`, `createErrorHandler`, `notFoundHandler`. The latter is the only production-consumed export; the first three are HIGH "test-only".
- **Removal impact:** If user decides to remove the 3 HIGH names too, drop the `AppError`/`ErrorTypes`/`createErrorHandler` describes; keep `notFoundHandler` tests.
- **Recommendation:** **Surgical edit only**, paired with F-2-21's HIGH half. The CERTAIN half of F-2-21 has no test-side action.

### F-10-16 — `test/session-cache.test.js` — surgery only, pairs with F-2-22

- **Location:** `test/session-cache.test.js:3-6` (imports `SessionCache`, `wrapSessionStore`).
- **Type:** F-2-22 only removes the `createSessionCache` factory key, which has no test caller (CERTAIN-removable from `module.exports` standalone).
- **Confidence:** **N/A** — this test is **NOT** orphaned by F-2-22. Recorded here to confirm the negative result.
- **Pairs with:** None. F-2-22 is a standalone trivial commit.
- **Recommendation:** **No test changes needed for F-2-22.**

### F-10-17 — `test/process-handlers.test.js` — surgery only, pairs with F-2-23

- **Location:** `test/process-handlers.test.js:3` (imports `createProcessHandlers` — the HIGH test-only seam).
- **Type:** Whole-test file targets the test-only seam.
- **Confidence:** **HIGH** (test exists solely for the test-only seam).
- **Pairs with:** F-2-23.
- **Evidence:** File imports only `createProcessHandlers`. The production export `registerProcessHandlers` is NOT tested here.
- **Removal impact:** If F-2-23 is removed, this test becomes a whole-file orphan. **Could escalate to CERTAIN if user removes F-2-23 and `registerProcessHandlers` has no test of its own elsewhere.** Confirmed via grep: no other test file references `registerProcessHandlers` or `process-handlers.js`.
- **Recommendation:** **Whole-file removal candidate**, paired with F-2-23. Promote to CERTAIN once F-2-23 is approved.

### F-10-18 — `test/session-config.test.js` — paired surgery / whole-file with F-2-24

- **Location:** `test/session-config.test.js:3-6` (imports `resolveSessionSettings`, `FALLBACK_SESSION_SECRET` — the two F-2-24 HIGH names).
- **Type:** Whole-test file targets the test-only seam.
- **Confidence:** **HIGH**.
- **Pairs with:** F-2-24.
- **Evidence:** File imports ONLY the two F-2-24 names. Production exports `createSessionMiddleware`, `flashMiddleware` are NOT covered here. Confirmed via grep: no other test references them by name (only e2e flows touch session indirectly).
- **Removal impact:** Whole-file deletion in same commit as F-2-24.
- **Recommendation:** **Whole-file removal candidate**, paired with F-2-24.

### F-10-19 — `test/admin-code.test.js` — surgery only, pairs with F-2-25

- **Location:** `test/admin-code.test.js:3-7` (imports `generateSecureCode`, `getLoggableCode`).
- **Type:** Mixed — `generateSecureCode` is HIGH test-only (F-2-25), `getLoggableCode` is live.
- **Confidence:** **HIGH (surgery)**.
- **Pairs with:** F-2-25 (the `generateSecureCode` half; `generateAdminCode` is not used here).
- **Evidence:** 30-line file. First `it()` asserts `generateSecureCode`; second asserts `getLoggableCode` (live).
- **Removal impact:** Drop the first `it()` case; keep the second.
- **Recommendation:** **Surgical edit only**, paired with F-2-25.

### F-10-20 — `test/album-data.test.js` — surgery only, pairs with F-2-32

- **Location:** `test/album-data.test.js:9-15` (dynamic import block).
- **Type:** Mixed — `formatPlaycount` is live, `formatPlaycountDisplay` is the F-2-32 HIGH test-only export. `createAlbumDataProcessor` is the live primary surface.
- **Confidence:** **HIGH (surgery)**.
- **Pairs with:** F-2-32.
- **Removal impact:** If F-2-32 is demoted, drop the `formatPlaycountDisplay` assertions; keep the rest.
- **Recommendation:** **Surgical edit only**, paired with F-2-32.

---

## Negative findings (verified non-orphans)

For completeness, these tests were checked and confirmed NOT orphaned by any audit phase:

- **`test/maintainability-metrics.test.js`** — imports `shouldIncludeFile`, `buildFileRecord`, `calculateMaintainabilityMetrics`, `evaluateThresholds` — all four are live (consumed by `scripts/maintainability-report.js`). F-2-13's 4 CERTAIN dead names are NOT tested. No action.
- **`test/album-display-incremental-update-detector.test.js`** — imports only `detectUpdateType` (live). F-2-31's 4 CERTAIN names are NOT tested. No action.
- **`test/playcount-service.test.js`** — imports only `createPlaycountService` (live factory). F-2-4's 3 CERTAIN names are NOT tested. No action.
- **`test/track-fetch-queue.test.js`** — imports `createTrackFetchQueue`, `initializeTrackFetchQueue`, `getTrackFetchQueue` — all confirmed live (F-2-30 negative finding). No action.
- **`test/db-errors.test.js`** — imports `classify`, `isRetryable`, `KINDS`, `RETRYABLE_CODES`, `RETRYABLE_NODE_CODES`, `CONSTRAINT_CODES`, `FATAL_CODES` — F-2-28 is deferred (LOW); test stays until user decides on the classification taxonomy.
- **34 tests requiring `./helpers`** — `test/helpers.js` is consumed by 34 test files. Not removable under any current scenario. Listed in F-0-10.
- **5 Playwright specs in `test/e2e/`** — exercise running app via `@playwright/test`; do not import server modules statically; only `.skip()` hits are conditional guards, not always-skipped. No action.
- **All 168 require/import paths resolve on disk** — zero broken imports despite four audit deletions in this branch.
- **No always-skipped or always-failing tests** detected via grep for `.skip(` / `.todo(` / `{ skip: true }`.

---

## Summary table

| ID | Type | Confidence | File / scope | Pairs with | Recommendation |
| -- | ---- | ---------- | ------------ | ---------- | -------------- |
| F-10-1 | Whole-file orphan | **CERTAIN** | `test/response-helpers.test.js` (185 lines) | F-2-3 | Remove file in same atomic commit as F-2-3 |
| F-10-2 | Surgery | HIGH | `test/logger.test.js` lines 51-78, 270-303 | F-2-1 | Drop 4 cases; keep file |
| F-10-3 | Surgery | HIGH | `test/templates.test.js` ~lines 32-239, 706-755 | F-2-2 | Drop 4 describe blocks; keep file |
| F-10-4 | Surgery | HIGH | `test/album-summary.test.js` | F-2-6 | Drop helper-only blocks; keep factory tests |
| F-10-5 | Surgery | HIGH | `test/auth-service.test.js` | F-2-7 | Drop constant assertions; keep factory tests |
| F-10-6 | Surgery | HIGH | `test/album-canonical.test.js` | F-2-8 | Drop helper blocks; keep `createAlbumCanonical` tests |
| F-10-7 | Surgery | HIGH | `test/user-service.test.js` | F-2-9 | Drop constant blocks; keep factory tests |
| F-10-8 | Surgery | HIGH | `test/user-preferences.test.js` | F-2-11 (HIGH half) | Drop `GENRE_MAPPINGS`/`filterGenreTags` cases |
| F-10-9 | Surgery | HIGH | `test/fuzzy-match.test.js` | F-2-12 (HIGH half) | Drop 11 helper describes; keep `isPotentialDuplicate` |
| F-10-10 | Defer | DEFER | `test/lastfm-auth.test.js` (9 helper blocks) | F-2-14 (needs-info) | Wait for user's Last.fm discovery decision |
| F-10-11 | Surgery | HIGH | `test/musicbrainz.test.js` | F-2-15 | Drop `searchArtist`/`getArtistById` blocks |
| F-10-12 | Surgery | HIGH | `test/musicbrainz-helpers.test.js` | F-2-16 | Drop `EU_COUNTRIES`/`scoreRelease` blocks |
| F-10-13 | Surgery | HIGH | `test/redirect-path.test.js` (30 lines) | F-2-19 | Drop 3 `isSafeInternalPath` cases; keep 1 `sanitizeReturnPath` |
| F-10-14 | Surgery | HIGH | `test/validators.test.js` | F-2-20 | Drop 8 helper describes; keep email/username/password/year |
| F-10-15 | Surgery | HIGH | `test/error-handler.test.js` | F-2-21 (HIGH half) | Drop `AppError`/`ErrorTypes`/`createErrorHandler` blocks (only if user removes HIGH names) |
| F-10-16 | Non-finding | n/a | `test/session-cache.test.js` | F-2-22 | No test action needed; F-2-22 removes only a factory wrapper |
| F-10-17 | Whole-file orphan | HIGH→CERTAIN | `test/process-handlers.test.js` | F-2-23 | Remove file entirely if F-2-23 approved |
| F-10-18 | Whole-file orphan | HIGH | `test/session-config.test.js` | F-2-24 | Remove file entirely in same commit as F-2-24 |
| F-10-19 | Surgery | HIGH | `test/admin-code.test.js` (30 lines) | F-2-25 | Drop `generateSecureCode` case; keep `getLoggableCode` |
| F-10-20 | Surgery | HIGH | `test/album-data.test.js` | F-2-32 | Drop `formatPlaycountDisplay` assertions |

**Counts:**
- **Whole-file CERTAIN orphan:** 1 (F-10-1, pairs with F-2-3).
- **Whole-file HIGH orphans (escalate to CERTAIN on user approval of paired Phase 2 finding):** 2 (F-10-17 pairs with F-2-23; F-10-18 pairs with F-2-24).
- **Surgery (drop assertion blocks, keep file):** 15 (F-10-2..-9, F-10-11..-15, F-10-19, F-10-20).
- **Defer (needs-info upstream):** 1 (F-10-10 pairs with F-2-14).
- **Non-findings:** 1 (F-10-16).
- **No standalone CERTAIN Phase 2 finding (F-2-4, F-2-5, F-2-10, F-2-13, F-2-17, F-2-18, F-2-22, F-2-31, F-2-33, F-2-34, F-2-35, F-2-36, F-2-18 partial, F-2-21 CERTAIN-half) triggers any test change** — all 18 CERTAIN dead exports are unimported by any test.

---

## Removal sequencing

Per the audit's "atomic commit per finding" rule and the Phase 2 sequencing plan:

1. **One pure-file commit:** F-10-1 + F-2-3 together — delete `utils/response-helpers.js` AND `test/response-helpers.test.js` in one atomic commit. CERTAIN, no surgery required.
2. **Whole-test-file deletions paired with Phase 2 commits:** F-10-17 (with F-2-23) and F-10-18 (with F-2-24).
3. **Surgical edits paired with Phase 2 commits:** Each F-10-N (surgery) is part of the same atomic commit as its F-2-M counterpart — both the `module.exports` keys AND the test assertion blocks land in one commit per finding. Do not split.
4. **Deferred:** F-10-10 waits on F-2-14's user decision.

**Verification gate (each commit):** `npm run lint:strict && bash scripts/run-tests.sh` green before and after. On Windows, run via Git Bash / WSL per F-0-10.

---

## Open questions for the user

None new. F-10-10's open question is already captured under F-2-14 (Last.fm discovery roadmap). No Phase 10 finding adds new user-decision items beyond the Phase 2 ones it pairs with.
