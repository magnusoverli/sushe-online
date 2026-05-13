# Phase 7 — Duplicate utilities & superseded modules

**Scope:** `services/`, `utils/`, `middleware/`, `config/`, `db/` (server only). Function-by-name index built across all module exports; suspected pairs from Phase 0 diffed; call-site counts established.

**Methodology:** For each suspected pair, (a) read both files end-to-end, (b) compared exported API surfaces, (c) counted callers via grep on import paths and exported symbol names, (d) classified as facade, parallel implementations, or true duplicate.

**Headline:** Zero CERTAIN removable duplicates. Every "looks like a pair" candidate examined is either (a) a deliberate facade composing sub-modules, (b) two modules that share a *concept* (e.g., "MusicBrainz", "Spotify", "album") but expose disjoint APIs that serve different concrete needs, or (c) layer-separated (server vs browser).

---

## Findings

### F-7-1 — `services/album-canonical.js` vs `services/album-service.js`

- **Paths:** `services/album-canonical.js` (757 LOC), `services/album-service.js` (525 LOC)
- **Type:** Adjacent layers, no API overlap
- **Confidence:** LOW (NOT a duplicate)
- **Evidence:**
  - `album-canonical.js` exports: `createAlbumCanonical`, plus pure helpers `sanitizeForStorage`, `normalizeForLookup`, `generateInternalAlbumId`, `isBetterCoverImage`, `chooseBetterText`, `chooseBetterTracks`. The factory returns `{ findByNormalizedName, findByAlbumId, smartMergeMetadata, upsertCanonical, batchUpsertCanonical, normalizeForLookup, generateInternalAlbumId, isBetterCoverImage }`. Scope = canonical row upsert/dedup over the `albums` table.
  - `album-service.js` exports `{ createAlbumService }`. Factory returns `{ getCoverImage, updateCoverImage, getSummary, updateSummary, updateCountry, updateGenres, batchUpdate, checkSimilar, markDistinct, mergeMetadata }`. Scope = HTTP-level business operations (lazy cover fetch, summary CRUD, country/genre updates, fuzzy similarity, distinct-pair management).
  - Zero exported-symbol overlap. `album-service.js` does NOT require `album-canonical.js` directly; it receives a pre-bound `upsertAlbumRecord` via `deps` (built from `album-canonical.js` in `routes/api/_helpers.js:9,41`).
- **Caller counts:**
  - `album-canonical.js`: 1 production caller (`routes/api/_helpers.js`) + 2 test files (`test/album-canonical.test.js`, `test/factory-compat.test.js`). Helper `resolveCountryCode` imported from `utils/musicbrainz.js` (not duplicated).
  - `album-service.js`: `routes/api/index.js`, `routes/api/albums.js`, `services/external-identity-service.js`, plus 2 test files.
- **Removal Impact:** N/A — different responsibilities.
- **Recommendation:** Preserve both.

### F-7-2 — `utils/musicbrainz.js` vs `utils/musicbrainz-helpers.js` vs `src/js/modules/musicbrainz-artist-name.js`

- **Paths:**
  - `utils/musicbrainz.js` (490 LOC, server)
  - `utils/musicbrainz-helpers.js` (119 LOC, server)
  - `src/js/modules/musicbrainz-artist-name.js` (106 LOC, browser ESM)
- **Type:** Concept-shared, API-disjoint, layer-separated
- **Confidence:** LOW (NOT duplicates)
- **Evidence:**
  - `utils/musicbrainz.js` — REST API client. Exports `createMusicBrainz`, `resolveCountryCode`, `searchArtist`, `getArtistById`, `getArtistCountriesBatch`, `COUNTRY_CODE_MAP`. Owns the rate-limited `mbFetch` + ISO 3166-1 alpha-2 to full-name resolution.
  - `utils/musicbrainz-helpers.js` — release-selection helpers. Exports `SUSHE_USER_AGENT`, `EU_COUNTRIES`, `scoreRelease`, `selectBestRelease`, `extractTracksFromMedia`. Pure functions over MB release JSON; no HTTP.
  - `src/js/modules/musicbrainz-artist-name.js` — browser-only artist-name display formatter (handles non-Latin scripts). Exports `hasNonLatinCharacters`, `extractLatinName`, `formatArtistDisplayName`. ESM (`export function`), consumed only from `src/js/musicbrainz.js`. Different module graph (Vite bundle) — `vite.config.js` `manualChunks` matches `id.includes('musicbrainz')` to route this into the `album-editing` chunk (per F-0-7 — landmine).
  - Zero symbol-name overlap across all three. Server pair shares no exported names. `COUNTRY_CODE_MAP` (utils/musicbrainz.js) ≠ `EU_COUNTRIES` (utils/musicbrainz-helpers.js).
- **Caller counts:**
  - `utils/musicbrainz.js`: 3 callers (`services/album-canonical.js`, `services/preference-sync.js`, `test/musicbrainz.test.js`).
  - `utils/musicbrainz-helpers.js`: 4 callers (`routes/api/proxies.js`, `services/reidentify-service.js`, `services/track-resolution-service.js`, `test/musicbrainz-helpers.test.js`).
  - `src/js/modules/musicbrainz-artist-name.js`: 2 callers (`src/js/musicbrainz.js`, `test/musicbrainz-artist-name.test.js`).
- **Recommendation:** Preserve all three. (Note: per F-0-7, renaming any of the two server files would still be safe; renaming/moving the browser file requires updating Vite's `manualChunks` substring rule.)

### F-7-3 — `utils/spotify-auth.js` vs `services/spotify-service.js`

- **Paths:** `utils/spotify-auth.js` (435 LOC), `services/spotify-service.js` (644 LOC)
- **Type:** Layered (transport + auth vs business logic)
- **Confidence:** LOW (NOT a duplicate)
- **Evidence:**
  - `utils/spotify-auth.js` — OAuth token lifecycle (wraps `createOAuthTokenManager`) + raw API transport. Exports `createSpotifyAuth`, plus default-instance shortcuts `ensureValidSpotifyToken`, `spotifyApiRequest`, `getTopArtists`, `getTopTracks`, `getSavedAlbums`, `getRecentlyPlayed`, `fetchAllPages`, `getAllTopArtists`, `getAllTopTracks`. Owns refresh logic + per-user metrics.
  - `services/spotify-service.js` — album/track search domain logic. Exports only `createSpotifyService`. Factory returns `{ searchAlbum, searchTrack, getDevices, schedulePlaycountRefresh }`. Internally builds queries, fuzzy-scores candidates, persists mappings via `externalIdentityService`. Does NOT do any token management — caller passes already-validated `accessToken`.
  - Zero exported-symbol overlap. `routes/api/spotify.js:12` creates `spotifyService`; `routes/api/playlists.js:21` separately destructures `ensureValidSpotifyToken` from the `deps` object. They are composed at the route layer.
- **Caller counts:**
  - `utils/spotify-auth.js`: `routes/api/index.js`, `routes/api/playlists.js` (via deps), `services/preference-sync.js`, `middleware/service-auth.js`, `db/repositories/users-repository.js` (string reference only — for column name), plus 3 test files.
  - `services/spotify-service.js`: `routes/api/spotify.js` (sole production caller).
- **Recommendation:** Preserve both.

### F-7-4 — `services/playlist/playlist-helpers.js` vs `services/list/*`

- **Paths:** `services/playlist/playlist-helpers.js` (159 LOC), `services/list/*` (10 files: `fetchers.js`, `setup-status.js`, `item-comments.js`, `item-operations.js`, `item-mapper.js`, `item-playcount-refresh.js`, `management-operations.js`, `write-operations.js`, plus `list/management/*.js`, `list/write/*.js`)
- **Type:** Different domain — "playlist" (Spotify/Tidal external playlist export) vs "list" (user's internal album lists)
- **Confidence:** LOW (NOT duplicates — different domains)
- **Evidence:**
  - `services/playlist/playlist-helpers.js` exports `{ resolveTrackPicks, processTrackBatches }`. Both consumed by `services/playlist/spotify-playlist.js`, `services/playlist/tidal-playlist.js`, and `services/playlist/index.js`. Pure batching utility for *external playlist creation* (Spotify/Tidal playlists).
  - `services/list/*` is the internal-album-list domain (user lists with album items, comments, ranking, etc.). Different table set (`lists`, `list_items`), different concept ("list" = ranked album collection, "playlist" = external service track list).
  - Zero exported-symbol overlap. The Phase 0 hint to compare these was conservative — the file/dir similarity is the only signal; the actual code touches separate concerns.
- **Caller counts:**
  - `playlist-helpers.js`: 4 callers within `services/playlist/` + `test/playlist-helpers.test.js`.
  - `services/list/*`: composed exclusively under `services/list-service.js`.
- **Recommendation:** Preserve both. Filename-clash risk only.

### F-7-5 — `services/aggregate-audit.js` vs `services/aggregate-audit/*` (intra-facade check)

- **Paths:** `services/aggregate-audit.js` (97 LOC), `services/aggregate-audit/duplicate-audit.js` (404 LOC), `services/aggregate-audit/manual-reconciliation.js` (~520 LOC)
- **Type:** Facade + sub-modules (confirmed per Phase 0)
- **Confidence:** LOW (NOT a duplicate)
- **Evidence:**
  - `services/aggregate-audit.js` is a deliberate facade: requires both sub-modules, spreads their returned methods onto a single `createAggregateAudit` factory result. Also defines `selectCanonicalAlbumId` locally (not in either sub-module) — that helper is then passed *down* into `createDuplicateAuditService` via the context object.
  - Within: `duplicate-audit.js` exports `{ basicNormalizeAlbumKey, createDuplicateAuditService }`; `manual-reconciliation.js` exports `{ createManualReconciliationService }`. Zero overlap between the two sub-modules.
  - `basicNormalizeAlbumKey` is re-exported by the facade and used inside `duplicate-audit.js` only (line 169). It is intentionally distinct from `normalizeAlbumKey` (in `utils/fuzzy-match.js`) — one is "basic lowercase+trim", the other strips edition suffixes/articles.
- **Caller counts:**
  - `services/aggregate-audit.js` (facade): `routes/admin/audit.js` (sole production caller), `test/aggregate-audit.test.js`.
  - Sub-modules: only via facade.
- **Recommendation:** Preserve. Internal split is clean; no redundancy within.

### F-7-6 — `chooseBetterText` defined in two places (function-name collision)

- **Paths:** `services/album-canonical.js:58` and `services/duplicate-service.js:54`
- **Type:** Same function name, **different semantics**
- **Confidence:** LOW (NOT a duplicate — semantically distinct)
- **Evidence:**
  - `album-canonical.js`'s `chooseBetterText(existing, newVal)` — prefers the longer value strictly (`b.length > a.length ? b : a`). Exported in `module.exports`, tested in `test/album-canonical.test.js`. Used at lines 242/245/247/251.
  - `duplicate-service.js`'s `chooseBetterText(existing, incoming)` — module-LOCAL (not exported), prefers incoming only when meaningfully longer (`candidate.length > current.length + 2`, threshold of 2 chars). Used at lines 463/468/483.
  - Each is module-scoped; the two values can never collide at the import level. Tests cover album-canonical's variant explicitly.
  - Consolidating would change behaviour: the +2-char threshold in `duplicate-service` is deliberately stricter to avoid trivial-length-difference flapping during merges.
- **Caller counts:** Each is used only inside its own file.
- **Recommendation:** Preserve both. (Optional follow-up: rename `duplicate-service.js`'s local helper to `pickLongerWithThreshold` to remove the visual collision — but that is a *clarity* refactor, not a redundancy removal.)

### F-7-7 — Cross-`services/` function-by-name scan: no further candidates

Index built from all top-level function declarations across `services/`, `utils/`, `middleware/`, `config/`, `db/`. Names that appear in more than one file:

| Name | Files | Verdict |
|------|-------|---------|
| `chooseBetterText` | `services/album-canonical.js`, `services/duplicate-service.js` | See F-7-6 — distinct semantics |
| `createAlbumCoverService` | `services/album-cover-service.js` (defined), `services/album-service.js` (calls) | One definition, one caller |
| `normalizeText` | `services/duplicate-service.js` (module-local) | Single definition |
| `toRowCount` | `services/catalog-cleanup.js:70`, `services/duplicate-service.js:34` | Module-local in each, trivial 3-line helper. Inlining would cost more than it saves; consolidation possible but not "redundancy". MEDIUM at most — defer to Phase 2 dead-export sweep if a shared `utils/parsers.js` ever emerges. |
| Factory pattern `create*Service(deps)` | ~25 files | Each is a distinct service factory, no overlap. |
| `ensureDb(deps.db, '<name>')` | Many | Single definition in `db/postgres.js`, every caller passes a unique service tag. Correct usage. |

No further pairs surface a CERTAIN or HIGH candidate.

---

## Cross-phase referrals

- **Phase 2** — Inside `album-canonical.js`'s factory return, `normalizeForLookup` and `generateInternalAlbumId` are re-exposed despite being available on the module exports object too. If Phase 2 (dead exports) finds the module-level re-exports unused outside tests, that's a Phase 2 finding, not a Phase 7 one.
- **Phase 2** — `toRowCount` could become a shared util if (and only if) Phase 2 finds other tiny duplications of integer-parsing helpers. Not actionable now.

---

## Summary

| Category | Count |
|----------|-------|
| Files in scope | services/* (60), utils/* (28), middleware/* (10), config/* (6), db/* (~25) |
| Suspected pairs examined | 6 (5 from Phase 0 hints + 1 cross-scan find) |
| CERTAIN removals | **0** |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW (preserve) | 6 |

**Conclusion:** No removal recommendations. The codebase has a consistent factory/facade pattern, and what initially look like "two modules doing the same thing" are in every case either (a) facade + sub-modules, (b) layered (transport/auth vs domain logic), or (c) sharing only a domain name (Spotify/MusicBrainz/album) while exposing disjoint APIs. The single function-name collision (`chooseBetterText`) is semantically distinct and both variants are file-local enough that the visual clash does not cause real risk.

Phase 7 complete. Nothing to add to the decisions log.
