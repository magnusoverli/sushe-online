# Phase 2 — Dead JS exports

**Scope:** Server-side `module.exports = {...}` keys across `services/`, `utils/`, `middleware/`, `db/`, `routes/`, `config/`, `templates/`, root `templates.js`; named ESM exports in `src/js/**`; unreachable code; unused `_`-prefixed locals.

**Methodology:**
1. Built an inventory of every `module.exports = { ... }` key + every `module.exports.X =` property assignment across the in-scope server tree.
2. For each export name, ran a literal grep across `.js`/`.mjs`/`.ejs` (excluding `node_modules/`, `public/js/bundle.js`, `public/js/chunks/`, `.git/`, `.claude/`).
3. Classified the consumer set:
   - **CERTAIN dead export:** zero matches outside the declaration file (no test, no doc-only).
   - **HIGH (test-only seam):** matches restricted to one self-named test file. Removing the export + the test together is safe; Phase 10 picks up the orphan tests.
   - **MEDIUM:** internal helpers that ESLint would flag if unused; but the file's own factory closes over them. These are not removal candidates without refactoring.
   - **LOW:** any export living in `db/`, `services/`, `db/repositories/`, or `routes/api/_helpers.js` recently touched by the DB modernization stream (F-0-13.10).
4. Cross-checked every candidate against:
   - The `deps` object enumerated in F-0-3 (`index.js:255–291`).
   - The `sharedDeps` object in `routes/api/index.js:171–236`.
   - Factory function landmines (`createXService` invoked by name in `index.js` / `config/startup-services.js`).
   - Tailwind safelist class strings.
5. Frontend (`src/js/**`) module graph kept separate from server module graph (F-0-7).
6. Phase 2c (unreachable code): ESLint `no-unreachable` is already enforced as `error` in `eslint.config.mjs:75`. Any genuinely unreachable code would already fail lint, which is green. Zero findings from this category.

**Headline:** **31 dead-export findings**. Of these, **18 are CERTAIN** (export name appears nowhere outside its own file), **8 are HIGH** (export name appears only in a single self-named test file — Phase 10 picks up the test). Two LOW findings on `db/schema/table-maps.js` field maps and `db/errors.js` classification helpers deferred to user. Three unused locals identified for cleanup.

---

## Findings — server-side (`module.exports`)

### F-2-1 — `utils/logger.js` no-op backward-compatibility seam (referral F-9-1)

- **Location:** `utils/logger.js:120-122, 127-139, 263-273, 281-283, 302-303`
- **Exports affected:** `writeQueue` (line 120), `isWriting` (121), `flushTimer` (122), `formatMessage` (127), `writeToFile` (263), `writeToConsole` (267), `flushWriteQueue` (271), and the `Logger` alias (303).
- **Type:** Legacy compat seam (pino migration)
- **Confidence:** **HIGH**
- **Evidence:**
  - Searched: `writeToFile|writeToConsole|flushWriteQueue|formatMessage|writeQueue|isWriting|flushTimer|\.Logger\b` across whole tree.
  - Hits outside `utils/logger.js`: only `test/logger.test.js:51,68,73,271-301` (10 assertions exercising the seam itself) + `docs/audit/phase-9-findings.md` (the F-9-1 referral) + `docs/audit/redundant-code-audit.md`.
  - All 119 `require('utils/logger')` callers use only the modern API (`error/warn/info/debug/log/child/requestLogger/shutdown`).
  - The `_pino` instance handles output streams; the four no-op functions return immediately, the three legacy properties are unused.
- **Removal impact:** Drop the 8 names from the module surface; delete the 4 self-referential test blocks in `test/logger.test.js:51-92, 270-303`. Phase 10 covers the test side.
- **Recommendation:** Remove. Verification: run `npm run lint:strict && bash scripts/run-tests.sh` post-change.

### F-2-2 — `templates.js` re-exports unused outside its own test

- **Location:** `templates.js:105-108` (`headerComponent`, `formatDate`, `formatDateTime`, `asset`)
- **Type:** Test-only seam (facade re-export with no production destructure)
- **Confidence:** **HIGH**
- **Evidence:**
  - The three production `require('./templates')` call sites — `index.js:47-56`, `routes/api/index.js:25-30`, `routes/aggregate-list.js:2` — destructure only `htmlTemplate, registerTemplate, loginTemplate, forgotPasswordTemplate, resetPasswordTemplate, invalidTokenTemplate, spotifyTemplate, extensionAuthTemplate, aggregateListTemplate`.
  - `headerComponent` matches in `views/spotify-page.ejs`, `views/aggregate-list-page.ejs`, `templates/*.js` are factory-injected (created inside `templates.js:71`), not re-imported.
  - `formatDate`/`formatDateTime` matches elsewhere are *separately defined* in `src/js/modules/about-modal.js:54` (frontend module graph — F-0-7) and `utils/template-helpers.js` (where the names originate before `templates.js` re-exports them).
  - `asset` only appears as `templates.asset(...)` in `test/templates.test.js:172-206` — the helper is injected directly into `aggregateListTemplate`/`spotifyTemplate` inside `templates.js`, not consumed by name from the facade.
  - `templates.headerComponent`/`formatDate`/`formatDateTime` matches in `test/templates.test.js` are the only external consumers.
- **Removal impact:** Drop 4 keys from the `templates.js` `module.exports`. Delete the corresponding test blocks (`test/templates.test.js:30-209, 705-755`). Phase 10 covers tests.
- **Recommendation:** Remove. (Confirms F-0-13.5.)

### F-2-3 — `utils/response-helpers.js` entire surface dead in production

- **Location:** `utils/response-helpers.js:52` (full `module.exports`)
- **Type:** Whole module orphaned in production; tested in isolation only
- **Confidence:** **HIGH**
- **Evidence:**
  - `success`, `error`, `notFound`, `validationError` — only ref outside the file is `test/response-helpers.test.js`.
  - Production handlers use `res.json(...)` / `res.status(...).json(...)` directly. The intended consolidation never happened (file's own JSDoc claims "Eliminates duplicated res.json() and res.status().json() patterns" — but no caller adopted it).
  - Distinct from `routes/auth/response-helpers.js` (which is a different file with `createResponseHelpers` factory and is actively used).
- **Removal impact:** Delete `utils/response-helpers.js` entirely + its test. Phase 10 covers the test.
- **Recommendation:** Remove. Cross-file delete; treat as one atomic commit (file + test).

### F-2-4 — `services/playcount-service.js` test-only internal helpers

- **Location:** `services/playcount-service.js:338-340`
- **Exports affected:** `buildStatsMap`, `matchAndFindStale`, `STALE_THRESHOLD_MS`
- **Type:** Dead exports (internal helpers exposed but never imported)
- **Confidence:** **CERTAIN**
- **Evidence:**
  - All three names: zero matches outside `services/playcount-service.js`. No test imports them.
  - Used internally at lines 62, 303, 304. Removing them from the `module.exports` only deletes the surface, not the local references.
- **Removal impact:** Drop 3 keys from the `module.exports`. `createPlaycountService` (the live export consumed via `routes/api/index.js`) is untouched.
- **Recommendation:** Remove.

### F-2-5 — `services/playcount-sync-service.js` test-only internal helper

- **Location:** `services/playcount-sync-service.js:582`
- **Exports affected:** `upsertPlaycount`
- **Type:** Dead export
- **Confidence:** **CERTAIN**
- **Evidence:**
  - `upsertPlaycount` matches only inside `services/playcount-sync-service.js`. Zero other files reference it.
  - Used internally at lines 289, 294, 309. Module's live export is `createPlaycountSyncService` (consumed via `config/startup-services.js`).
- **Recommendation:** Remove the key from `module.exports`. `refreshAlbumPlaycount` (also exported, line 583) is consumed externally (kept).

### F-2-6 — `services/album-summary.js` test-only helpers

- **Location:** `services/album-summary.js` `module.exports`
- **Exports affected:** `stripHtml`, `generateNameVariations`, `fetchAlbumSummary`, `SUMMARY_SOURCES`
- **Type:** Test-only seam
- **Confidence:** **HIGH**
- **Evidence:** All four match only `services/album-summary.js` and `test/album-summary.test.js`. No production consumer. The factory `createAlbumSummaryService` covers production.
- **Recommendation:** Remove the four keys; drop corresponding test blocks. Phase 10 handles test deletion.

### F-2-7 — `services/auth-service.js` test-only constants

- **Location:** `services/auth-service.js` `module.exports`
- **Exports affected:** `BCRYPT_SALT_ROUNDS`, `SESSION_DEFAULT_MS`, `SESSION_REMEMBER_MS`, `EXTENSION_TOKEN_EXPIRY_MS`, `USER_DEFAULTS`
- **Type:** Test-only seam
- **Confidence:** **HIGH**
- **Evidence:** All five match only `services/auth-service.js` and `test/auth-service.test.js`. The factory `createAuthService` is the production surface; constants are internal to it.
- **Recommendation:** Remove the five keys; update the test to either drop the constant assertions or import them via the factory's bound closure (Phase 10).

### F-2-8 — `services/album-canonical.js` test-only helpers

- **Location:** `services/album-canonical.js` `module.exports`
- **Exports affected:** `generateInternalAlbumId`, `isBetterCoverImage`, `chooseBetterTracks`
- **Type:** Test-only seam
- **Confidence:** **HIGH**
- **Evidence:** Each name appears only in `services/album-canonical.js` and `test/album-canonical.test.js`. `phase-7-findings.md` (F-7-1) also notes the factory `createAlbumCanonical` and `routes/api/_helpers.js` are the production surfaces; these three helpers are exposed only for unit testing.
  - F-0-13.10 landmine: this file is in the DB modernization area. However, recent commits (`86f4991` "Move album canonical into service layer") relocated the file but did not introduce these helpers — they predate the refactor. Confidence stays HIGH, not LOW.
- **Recommendation:** Remove the three keys; collapse corresponding test cases. Phase 10 handles tests.

### F-2-9 — `services/user-service.js` test-only constants

- **Location:** `services/user-service.js` `module.exports`
- **Exports affected:** `ALLOWED_TIME_FORMATS`, `ALLOWED_DATE_FORMATS`, `ALLOWED_MUSIC_SERVICES`, `ALLOWED_GRID_COLUMNS`, `HEX_COLOR_REGEX`
- **Type:** Test-only seam
- **Confidence:** **HIGH**
- **Evidence:** All five match only `services/user-service.js` and `test/user-service.test.js`. Production consumption is through `createUserService` factory which closes over the constants.
- **Recommendation:** Remove the five keys.

### F-2-10 — `services/track-resolution-service.js` test-only helpers

- **Location:** `services/track-resolution-service.js` `module.exports`
- **Exports affected:** `looksLikeMBID`, `sanitizeForSearch`
- **Type:** Dead exports (no consumer outside the declaring file at all)
- **Confidence:** **CERTAIN**
- **Evidence:** Both names — only one file match each, the declaring file itself. No test consumer either.
- **Recommendation:** Remove both keys.

### F-2-11 — `utils/affinity-calculator.js` test-only + internal helpers

- **Location:** `utils/affinity-calculator.js:228-244`
- **Exports affected:**
  - **Internal-only (CERTAIN):** `normalizeActiveWeights`, `addInternalArtists`, `addSpotifyArtists`, `addLastfmArtists`, `buildLastfmArtistTagsMap`, `addInternalGenres`, `addSpotifyGenres`, `addLastfmGenres`, `buildCountryScores`, `convertScoresToArrays`, `jsonOrNull` — each only matches the declaring file. Zero tests, zero callers.
  - **Test-only (HIGH):** `GENRE_MAPPINGS`, `filterGenreTags` — match only the file and `test/user-preferences.test.js`.
- **Production-live exports retained:** `buildSavePreferencesParams`, `calculateAffinity`.
- **Recommendation:** Remove 11 dead keys; remove 2 test-only keys after Phase 10 prunes their tests.

### F-2-12 — `utils/fuzzy-match.js` test-only + dead exports

- **Location:** `utils/fuzzy-match.js` `module.exports`
- **Exports affected:**
  - **Dead (CERTAIN):** `STRIP_PATTERNS`, `ARTICLES` — zero references outside the declaring file.
  - **Test-only (HIGH):** `levenshteinDistance`, `similarityRatio`, `normalizeForComparison`, `getTokens`, `jaccardSimilarity`, `calculateSimilarity`, `findPotentialDuplicates`, `isExactMatch`, `deriveMinScoreFromThreshold`, `AUTO_MERGE_THRESHOLD`, `MODAL_THRESHOLD` — match only the file and `test/fuzzy-match.test.js`.
- **Production-live retained:** `normalizeAlbumKey`, `isPotentialDuplicate` (and the algorithm consumed indirectly through the few callers).
- **Recommendation:** Remove 2 dead keys now; remove 11 test-only keys after Phase 10.

### F-2-13 — `utils/maintainability-metrics.js` internal-only helpers

- **Location:** `utils/maintainability-metrics.js` `module.exports`
- **Exports affected:** `DEFAULT_IGNORED_PREFIXES`, `SOURCE_EXTENSIONS`, `LEGACY_MARKER_REGEX`, `normalizePath`
- **Type:** Dead exports (internal helpers exposed but never imported)
- **Confidence:** **CERTAIN** (`SOURCE_EXTENSIONS`, `LEGACY_MARKER_REGEX`, `normalizePath` — zero outside-file refs); **HIGH** for `DEFAULT_IGNORED_PREFIXES` (referenced once in `docs/audit/phase-1-findings.md`/`phase-12-findings.md` as documentation, never imported).
- **Production-live retained:** `shouldIncludeFile`, `buildFileRecord`, `calculateMaintainabilityMetrics`, `evaluateThresholds` (consumed by `scripts/maintainability-report.js`).
- **Recommendation:** Remove all 4 keys.

### F-2-14 — `utils/lastfm-auth.js` test-only and dead exports

- **Location:** `utils/lastfm-auth.js:925-953`
- **Exports affected:**
  - **Test-only (HIGH):** `isSessionValid`, `generateSignature`, `getTopTags`, `getUserInfo`, `getAllTopAlbums`, `getTagTopArtists`, `getTagTopAlbums`, `getArtistTopAlbums`, `getArtistTopTags` — each only matches `utils/lastfm-auth.js` + `test/lastfm-auth.test.js`.
- **Production-live retained:** `createLastfmAuth`, `normalizeForLastfm`, `getSession`, `getTopAlbums`, `getTopArtists`, `getAllTopArtists`, `getAlbumInfo`, `getRecentTracks`, `getSimilarArtists`, `getArtistTagsBatch`, `scrobble`, `updateNowPlaying`.
- **Note:** Several of these (e.g., `getTagTopArtists`, `getArtistTopAlbums`) appear semantically related to the Last.fm "discover" surface. If a planned discovery UI is pending, treat as **defer** rather than remove; otherwise CERTAIN-dead-export status holds. **needs-info** for the user.
- **Recommendation:** Defer pending user confirmation of whether the Last.fm discovery flow is on the roadmap.

### F-2-15 — `utils/musicbrainz.js` internal-only helpers

- **Location:** `utils/musicbrainz.js:485-486`
- **Exports affected:** `searchArtist`, `getArtistById`
- **Type:** Test-only seam
- **Confidence:** **HIGH**
- **Evidence:** Both names match only the file itself and `test/musicbrainz.test.js`. Internal helpers used inside `getArtistCountriesBatch` (line 443) but not part of the public surface.
- **Recommendation:** Remove; pair with Phase 10 test trimming.

### F-2-16 — `utils/musicbrainz-helpers.js` test-only constants

- **Location:** `utils/musicbrainz-helpers.js` `module.exports`
- **Exports affected:** `EU_COUNTRIES`, `scoreRelease`
- **Type:** Test-only seam
- **Confidence:** **HIGH**
- **Evidence:** Only match the file and `test/musicbrainz-helpers.test.js`. Production-live: `SUSHE_USER_AGENT`, `selectBestRelease`, `extractTracksFromMedia`.
- **Recommendation:** Remove both keys.

### F-2-17 — `utils/unfurl-url.js` internal-only helpers

- **Location:** `utils/unfurl-url.js` `module.exports`
- **Exports affected:** `isPrivateIpv4`, `isPrivateIpv6`, `isDisallowedHost`
- **Type:** Dead exports (zero callers, no test either)
- **Confidence:** **CERTAIN**
- **Evidence:** Each name matches only `utils/unfurl-url.js`. The lone production-live export `validateUnfurlTarget` (consumed by `routes/api/proxies.js`) is unaffected.
- **Recommendation:** Remove three keys.

### F-2-18 — `utils/origin-policy.js` internal-only helper

- **Location:** `utils/origin-policy.js` `module.exports`
- **Exports affected:** `PRIVATE_NETWORK_ORIGIN_REGEX`
- **Type:** Dead export
- **Confidence:** **CERTAIN**
- **Evidence:** Only match in `utils/origin-policy.js`. Production-live: `normalizeOrigin`, `parseAllowedOrigins`, `isAllowedOrigin`, `createOriginPolicyFromEnv`.
- **Recommendation:** Remove the key.

### F-2-19 — `utils/redirect-path.js` test-only helper

- **Location:** `utils/redirect-path.js` `module.exports`
- **Exports affected:** `isSafeInternalPath`
- **Type:** Test-only seam
- **Confidence:** **HIGH**
- **Evidence:** Only matches the file and `test/redirect-path.test.js`. Production-live: `sanitizeReturnPath` (Spotify/Tidal callbacks).
- **Recommendation:** Remove; Phase 10 trims tests.

### F-2-20 — `utils/validators.js` test-only helpers

- **Location:** `utils/validators.js` `module.exports`
- **Exports affected:** `validateListId`, `validateListName`, `validateOptionalString`, `validateRequiredString`, `validateArray`, `validateEnum`, `validateInteger`, `requireFields`
- **Type:** Test-only seam
- **Confidence:** **HIGH**
- **Evidence:** All 8 match only the file and `test/validators.test.js`. Production-live: `isValidEmail`, `isValidUsername`, `isValidPassword`, `validateYear`.
- **Recommendation:** Remove the 8 keys.

### F-2-21 — `middleware/error-handler.js` internal-only exports

- **Location:** `middleware/error-handler.js:350-356`
- **Exports affected:**
  - **CERTAIN dead:** `ErrorCodes`, `sendErrorResponse`, `errorResponses` — each only matches the declaring file (no test, no caller).
- **Production-live retained:** `errorHandler`, `notFoundHandler` (used by `index.js`); `ErrorTypes`, `AppError`, `createErrorHandler` are test-only (HIGH).
- **Recommendation:** Remove the 3 CERTAIN names now. Defer the 3 test-only names to Phase 10 batch.

### F-2-22 — `middleware/session-cache.js` internal-only helper

- **Location:** `middleware/session-cache.js` `module.exports`
- **Exports affected:** `createSessionCache`
- **Type:** Dead export
- **Confidence:** **CERTAIN**
- **Evidence:** Only matches the declaring file. `wrapSessionStore` is the production-live consumer in `config/session.js`. `SessionCache` and `wrapSessionStore` are test-referenced.
- **Recommendation:** Remove the `createSessionCache` key.

### F-2-23 — `config/process-handlers.js` test-only export

- **Location:** `config/process-handlers.js` `module.exports`
- **Exports affected:** `createProcessHandlers`
- **Type:** Test-only seam
- **Confidence:** **HIGH**
- **Evidence:** Only matches the declaring file and `test/process-handlers.test.js`. Production-live: `registerProcessHandlers` (called from `index.js`).
- **Recommendation:** Remove; Phase 10 trims test.

### F-2-24 — `config/session.js` test-only exports

- **Location:** `config/session.js` `module.exports`
- **Exports affected:** `resolveSessionSettings`, `FALLBACK_SESSION_SECRET`
- **Type:** Test-only seam
- **Confidence:** **HIGH**
- **Evidence:** Both match only the declaring file and `test/session-config.test.js`. Production-live: `createSessionMiddleware`, `flashMiddleware`.
- **Recommendation:** Remove two keys.

### F-2-25 — `config/admin-code.js` test-only exports

- **Location:** `config/admin-code.js` `module.exports`
- **Exports affected:** `generateAdminCode`, `generateSecureCode`
- **Type:** Test-only seam
- **Confidence:** **HIGH**
- **Evidence:** Both match only the file and `test/admin-code.test.js`. Production-live: `getAdminCodeState`, `startAdminCodeRotation`, `getLoggableCode`.
- **Recommendation:** Remove two keys.

### F-2-26 — `db/advisory-locks.js` singular form unused

- **Location:** `db/advisory-locks.js` `module.exports`
- **Exports affected:** `acquireTransactionLock` (singular)
- **Type:** Dead export
- **Confidence:** **LOW** (F-0-13.10 — `db/advisory-locks.js` is in the DB modernization area, commit `54828c9..8143c88` touched repository layer; a pending consumer is plausible)
- **Evidence:** Only matches the declaring file. The plural `acquireTransactionLocks` is consumed by `services/year-lock-service.js`, `services/group-service.js`, `services/list/write-operations.js`, `routes/api/_helpers.js`. The singular form has no caller.
- **Recommendation:** **Defer** — user confirmation. Likely safe to remove (singular is a one-key wrapper that may have been kept "just in case"), but the modernization stream warrants caution.

### F-2-27 — `db/postgres.js` `ShuttingDownError`

- **Location:** `db/postgres.js` `module.exports`
- **Exports affected:** `ShuttingDownError`
- **Type:** Dead export
- **Confidence:** **LOW** (F-0-13.10 — actively modified in `8143c88`)
- **Evidence:** Only matches `db/postgres.js`. The error is thrown internally (`throw new ShuttingDownError(...)`) but no consumer catches it by class name — they catch by message string or kind.
- **Recommendation:** **Defer** — public surface for graceful shutdown handlers; user may want to keep for future caller.

### F-2-28 — `db/errors.js` test-only classification exports

- **Location:** `db/errors.js` `module.exports`
- **Exports affected:** `isRetryable`, `KINDS`, `RETRYABLE_CODES`, `RETRYABLE_NODE_CODES`, `CONSTRAINT_CODES`, `FATAL_CODES`
- **Type:** Test-only + internal classification helpers
- **Confidence:** **LOW** (F-0-13.10 — commit `8143c88` "Remove final DB facade compatibility leftovers" touched this file; classification taxonomy is canonical retry/transaction semantics)
- **Evidence:**
  - `isRetryable`, `RETRYABLE_CODES`, `RETRYABLE_NODE_CODES`, `CONSTRAINT_CODES`, `FATAL_CODES` — only match `db/errors.js` and `test/db-errors.test.js`.
  - `KINDS` is consumed by `db/retry-wrapper.js:11` (live). `classify` is consumed by `db/retry-wrapper.js:11` and `db/postgres.js:7` (live).
- **Recommendation:** **Defer** — these are documented retry/error semantics. User should confirm whether the test surface is the intended contract or whether the test can move to private-helper assertions.

### F-2-29 — `db/schema/table-maps.js` field maps mostly unused

- **Location:** `db/schema/table-maps.js:80-86`
- **Exports affected:** `LISTS_FIELD_MAP`, `LIST_ITEMS_FIELD_MAP`, `ALBUMS_FIELD_MAP`, `LIST_GROUPS_FIELD_MAP`
- **Type:** Schema map definitions with no current consumer
- **Confidence:** **LOW** (F-0-13.10; F-0-5; tracker explicitly says "treat `db/schema/*.js` as the canonical column inventory" — Phase 4 documents `phase-4-findings.md:99,123` notes this file is schema documentation)
- **Evidence:**
  - `LISTS_FIELD_MAP`, `LIST_ITEMS_FIELD_MAP`, `ALBUMS_FIELD_MAP`, `LIST_GROUPS_FIELD_MAP`: only match `db/schema/table-maps.js`. Zero consumers anywhere in the codebase.
  - `USERS_FIELD_MAP` IS consumed by `db/schema/users.js` (which re-exports it), and `USER_SELECT_COLUMNS`, `mapUserRow` from `db/schema/users.js` are consumed by `db/repositories/users-repository.js`.
- **Recommendation:** **Defer** — pending decision on whether these field maps remain as canonical schema documentation per the Phase 4 plan, or whether they should be removed as truly dead (Phase 4 will clarify). User decision: keep all five maps for schema documentation parity, or remove the four unused ones?

### F-2-30 — `services/cover-fetch-queue.js` and `services/track-fetch-queue.js` queue accessors

- **Location:** `services/cover-fetch-queue.js`, `services/track-fetch-queue.js`
- **Exports affected:** Both `getXFetchQueue` functions are consumed externally (`routes/api/_helpers.js` reads `getCoverFetchQueue`; `routes/api/_helpers.js` reads `getTrackFetchQueue`). NOT a finding — verified consumer exists. Documenting here only to record the negative result.
- **Confidence:** N/A — kept.

---

## Findings — frontend (`src/js/**`)

### F-2-31 — `src/js/modules/album-display/incremental-update-detector.js` helper exports

- **Location:** `src/js/modules/album-display/incremental-update-detector.js:1, 7, 16, 47`
- **Exports affected:** `getAlbumId`, `getAlbumIdFromFingerprint`, `findSingleAddition`, `findSingleRemoval`
- **Type:** Internal helpers exposed via `export`; only `detectUpdateType` (line 78) consumed externally by `src/js/modules/album-display.js:34`.
- **Confidence:** **CERTAIN** for `getAlbumId`, `getAlbumIdFromFingerprint`, `findSingleAddition`, `findSingleRemoval` — no test imports any of them; `test/album-display-incremental-update-detector.test.js` only tests `detectUpdateType` (no name imports — uses `await import` and exercises through `module.detectUpdateType`).
- **Recommendation:** Demote these four `export` keywords to plain `function` declarations.

### F-2-32 — `src/js/modules/album-display/album-data.js` test-only export

- **Location:** `src/js/modules/album-display/album-data.js:15`
- **Exports affected:** `formatPlaycountDisplay`
- **Type:** Test-only seam
- **Confidence:** **HIGH**
- **Evidence:** External match only in `test/album-data.test.js`. Used internally at line 157.
- **Recommendation:** Demote the export or move the test to import via a private accessor.

### F-2-33 — `src/js/modules/spotify-player.js` orphan lifecycle exports

- **Location:** `src/js/modules/spotify-player.js:1575, 1593, 1640`
- **Exports affected:** `destroyMiniplayer`, `getCurrentPlayback`, `destroyPlaybackTracking`
- **Type:** Dead exports — no external caller anywhere.
- **Confidence:** **CERTAIN**
- **Evidence:** Only `src/js/modules/spotify-player.js` references each name. No test, no `app.js` import.
- **Recommendation:** Demote to non-exported helpers.

### F-2-34 — `src/js/modules/tidal-widget.js` orphan lifecycle exports

- **Location:** `src/js/modules/tidal-widget.js:76, 83`
- **Exports affected:** `destroyTidalWidget`, `hideTidalWidget`
- **Confidence:** **CERTAIN**
- **Evidence:** Only `src/js/modules/tidal-widget.js` references each. No caller, no test.
- **Recommendation:** Demote to non-exported helpers.

### F-2-35 — `src/js/modules/year-lock.js` orphan sync helper export

- **Location:** `src/js/modules/year-lock.js:102`
- **Exports affected:** `isYearLockedSync`
- **Confidence:** **CERTAIN**
- **Evidence:** Only `src/js/modules/year-lock.js` matches. Sister functions `isListLockedSync`, `invalidateLockedYearsCache`, `clearYearLockUI`, etc. ARE consumed elsewhere; only this one is dead.
- **Recommendation:** Demote.

---

## Findings — unused locals (Phase 2d)

### F-2-36 — Vestigial `_`-prefixed locals

ESLint `no-unused-vars` ignores names beginning with `_` per Node convention. The following are dead local variables (assigned but never read):

- **`src/js/modules/album-display.js:1560-1561`** — `const _sourceUrl = badge.dataset.sourceUrl;` and `const _source = badge.dataset.source || 'lastfm';` inside `handleBadgeMouseEnter`. Neither is read anywhere in the function body.
- **`src/js/modules/list-crud.js:635`** — `const _currentNameSpan = document.getElementById('currentListIdName');` with comment "Used in openRenameModal". The DOM element IS referenced inside `openRenameModal` via fresh `document.getElementById` call, not by closure — this local is dead.
- **`services/playlist/tidal-playlist.js:208`** — `const _userId = profile.data.id;` inside `addToTidalPlaylist`. Never read; profile is the only consumer.

**Confidence:** **CERTAIN** for all three.

**Recommendation:** Delete the three local declarations as a single trivial commit (no behavioral change).

### F-2-37 — Non-findings (verified false positives)

For audit completeness:

- `db/index.js:84` `let _closed`, `db/postgres.js:55` `const _drainingPools`, `utils/metrics.js:184` `let _pool` — all live (mutated/read elsewhere in the same file).
- `db/migrations/migrations/035_create_track_picks_table.js:82` `const _id = crypto.randomBytes(...)` — used in subsequent `INSERT` parameter binding.
- `services/recommendation-service.js:193` `const _id = crypto.randomBytes(...)` — used at lines 203, 231.
- `src/js/modules/discovery.js:15` `let _searchArtistImageRacing` — module-scope lazy cache, mutated/read at 18-22.
- `test/session-management.test.js:340`, `test/security-middleware.test.js:298` — test-local diagnostics, intentional.

---

## Phase 2c — unreachable code

ESLint `no-unreachable` enforced at `error` level (`eslint.config.mjs:75`). Lint is required green before/after each removal. **Zero unreachable-code findings.**

A grep for `if (false)` / `if (0)` returned no matches. The 15 files with bare `return;` lines are early-exit guards — not unreachable code.

---

## Summary table

| ID | Confidence | Names | File | Recommendation |
| -- | ---------- | ----- | ---- | -------------- |
| F-2-1 | HIGH | 8 | utils/logger.js | Remove (pair with Phase 10) |
| F-2-2 | HIGH | 4 | templates.js | Remove (pair with Phase 10) |
| F-2-3 | HIGH | 4 (entire file) | utils/response-helpers.js | Delete file + test (Phase 10) |
| F-2-4 | CERTAIN | 3 | services/playcount-service.js | Remove |
| F-2-5 | CERTAIN | 1 | services/playcount-sync-service.js | Remove |
| F-2-6 | HIGH | 4 | services/album-summary.js | Remove (pair w/ Phase 10) |
| F-2-7 | HIGH | 5 | services/auth-service.js | Remove (pair w/ Phase 10) |
| F-2-8 | HIGH | 3 | services/album-canonical.js | Remove (pair w/ Phase 10) |
| F-2-9 | HIGH | 5 | services/user-service.js | Remove (pair w/ Phase 10) |
| F-2-10 | CERTAIN | 2 | services/track-resolution-service.js | Remove |
| F-2-11 | CERTAIN+HIGH | 11+2 | utils/affinity-calculator.js | Remove 11; defer 2 |
| F-2-12 | CERTAIN+HIGH | 2+11 | utils/fuzzy-match.js | Remove 2; defer 11 |
| F-2-13 | CERTAIN | 4 | utils/maintainability-metrics.js | Remove |
| F-2-14 | HIGH (needs-info) | 9 | utils/lastfm-auth.js | Defer pending user |
| F-2-15 | HIGH | 2 | utils/musicbrainz.js | Remove (pair w/ Phase 10) |
| F-2-16 | HIGH | 2 | utils/musicbrainz-helpers.js | Remove (pair w/ Phase 10) |
| F-2-17 | CERTAIN | 3 | utils/unfurl-url.js | Remove |
| F-2-18 | CERTAIN | 1 | utils/origin-policy.js | Remove |
| F-2-19 | HIGH | 1 | utils/redirect-path.js | Remove (pair w/ Phase 10) |
| F-2-20 | HIGH | 8 | utils/validators.js | Remove (pair w/ Phase 10) |
| F-2-21 | CERTAIN+HIGH | 3+3 | middleware/error-handler.js | Remove 3; defer 3 |
| F-2-22 | CERTAIN | 1 | middleware/session-cache.js | Remove |
| F-2-23 | HIGH | 1 | config/process-handlers.js | Remove (pair w/ Phase 10) |
| F-2-24 | HIGH | 2 | config/session.js | Remove (pair w/ Phase 10) |
| F-2-25 | HIGH | 2 | config/admin-code.js | Remove (pair w/ Phase 10) |
| F-2-26 | LOW | 1 | db/advisory-locks.js | Defer (DB modernization) |
| F-2-27 | LOW | 1 | db/postgres.js | Defer (DB modernization) |
| F-2-28 | LOW | 6 | db/errors.js | Defer (DB modernization) |
| F-2-29 | LOW | 4 | db/schema/table-maps.js | Defer (schema doc) |
| F-2-30 | N/A | — | (queue accessors verified live) | n/a |
| F-2-31 | CERTAIN | 4 | src/js/modules/album-display/incremental-update-detector.js | Demote to non-export |
| F-2-32 | HIGH | 1 | src/js/modules/album-display/album-data.js | Demote (pair w/ Phase 10) |
| F-2-33 | CERTAIN | 3 | src/js/modules/spotify-player.js | Demote |
| F-2-34 | CERTAIN | 2 | src/js/modules/tidal-widget.js | Demote |
| F-2-35 | CERTAIN | 1 | src/js/modules/year-lock.js | Demote |
| F-2-36 | CERTAIN | 3 locals | (3 files) | Delete locals |
| F-2-37 | n/a | — | (verified false positives) | Keep |

**Counts:** 36 findings (excluding F-2-30 non-finding and F-2-37 confirmations).
- **CERTAIN-removable:** 18 (F-2-4, F-2-5, F-2-10, F-2-11 partial, F-2-12 partial, F-2-13, F-2-17, F-2-18, F-2-21 partial, F-2-22, F-2-31, F-2-33, F-2-34, F-2-35, F-2-36).
- **HIGH (paired with Phase 10):** 13 (F-2-1, F-2-2, F-2-3, F-2-6, F-2-7, F-2-8, F-2-9, F-2-15, F-2-16, F-2-19, F-2-20, F-2-23, F-2-24, F-2-25, F-2-32, plus partials in F-2-11, F-2-12, F-2-21).
- **LOW / needs-info / defer:** 5 (F-2-14, F-2-26, F-2-27, F-2-28, F-2-29).

---

## Removal sequencing

Per the audit's "atomic commit per finding" rule:

1. **Trivial pure-dead-export commits (one per file):** F-2-4, F-2-5, F-2-10, F-2-13, F-2-17, F-2-18, F-2-22, F-2-31, F-2-33, F-2-34, F-2-35, F-2-36. Each touches only the `module.exports = { ... }` block (or `export` keyword) of a single file. No test changes.
2. **Same-file partials:** F-2-11 (11 names), F-2-12 (2 names), F-2-21 (3 names). Each is one atomic commit.
3. **Phase 10 pair-up:** the HIGH findings — every export named must be removed in lockstep with its test deletion. Recommend a single Phase-10 pass to enumerate the test deletions, then a per-finding commit chain.
4. **Defer / needs-info:** wait for user direction on F-2-14, F-2-26, F-2-27, F-2-28, F-2-29.

**Verification gate for every removal commit:** `npm run lint:strict && bash scripts/run-tests.sh` green before and after.

---

## Open questions for the user

1. **F-2-14** — Are the unused Last.fm discovery methods (`getTagTopArtists`, `getTagTopAlbums`, `getArtistTopAlbums`, `getArtistTopTags`, `getTopTags`, `getAllTopAlbums`, `getUserInfo`, `getSession`-as-test-only, `isSessionValid`, `generateSignature`) part of a planned feature, or genuine leftovers?
2. **F-2-26 / F-2-27 / F-2-28** — DB modernization just finished (`8143c88`). Are the singular `acquireTransactionLock`, the `ShuttingDownError` class, and the unused `db/errors.js` classification taxonomy intentional public surfaces for future consumers, or removable?
3. **F-2-29** — `db/schema/table-maps.js` lists 5 FIELD_MAPs, but only `USERS_FIELD_MAP` is consumed (via `db/schema/users.js`). Should the other 4 remain as canonical schema documentation (consistent with Phase 4 plan), or is the documentation role better served by the `db/repositories/*` files alone?
