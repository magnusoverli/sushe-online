# Phase 3 — Dead routes & API endpoints — Findings

**Started:** 2026-05-13
**Status:** complete
**Scope:** All HTTP routes registered via `app.get|post|put|delete|patch(...)` in `routes/**` and `index.js`. Consumer search across `src/js/**`, `browser-extension/**`, `views/**`, `templates/**`, `templates.js`, `public/**` (excluding gitignored `public/js/chunks/**` and `public/js/bundle.js`), `test/**`, `docs/**`, `README.md`, `.github/**`, `Dockerfile`, `docker-compose*.yml`.

---

## Methodology notes

- **Route table built from**: `app.X(` literal-path enumeration across `routes/**`. No `app.use('/api', router)` mount prefixes exist — all paths are absolute literals (verified). Sub-registrars in `routes/oauth/**`, `routes/admin/**`, `routes/api/**`, `routes/auth/**`, `routes/preferences/**`, `routes/aggregate-list/**` all register against the root `app` instance.
- **Dynamic path landmines confirmed (NOT dead — flagged for memory)**:
  - `src/js/utils/playback-service.js:124-125` builds `/api/spotify/${type}` and `/api/tidal/${type}` where `type` is `'album'` or `'track'`. This keeps `/api/spotify/track`, `/api/tidal/album`, `/api/tidal/track` alive.
  - `src/js/modules/settings-drawer/handlers/aggregate-actions.js:141` builds `/api/aggregate-list/${year}/${action}` with `action` in `{'lock','unlock'}`. Keeps `/api/aggregate-list/:year/lock` and `/unlock` alive.
  - `src/js/modules/settings-drawer/handlers/aggregate-actions.js:174` builds `/api/recommendations/${year}/${action}` similarly. Keeps `/api/recommendations/:year/lock` and `/unlock` alive.
- **External surface filter (per Phase 0 F-0-11) — NOT flagged regardless of grep result**: every `/auth/{spotify,tidal,lastfm}*` route, `/extension/auth`, `/api/auth/extension-token`, `/api/auth/validate-token`, `/api/auth/extension-tokens`, `/api/auth/cleanup-tokens`, `/health`, `/health/db`, `/api/health`, `/ready`, `/metrics`, `/.well-known/*`, `/favicon.ico`, `/apple-touch-icon*.png`, `/api/telegram/webhook/:secret` — all consumed by external clients (OAuth providers, k8s probes, browsers, browser extensions, Telegram).
- **Bootstrap supersession signal**: commit `7cd7672` ("Unify admin settings load into single bootstrap payload", 2026-04-16) consolidated several formerly-active admin endpoints into `GET /api/admin/bootstrap`. The originals were not removed.

---

## Summary

| Confidence | Count |
| ---------- | ----- |
| CERTAIN    | 14 |
| HIGH       | 9 |
| MEDIUM     | 12 |
| LOW        | 0 |
| **Total candidates** | **35** |

- **CERTAIN** = zero non-test consumers anywhere in the searched surface AND no plausible dynamic-construction reach AND not an external surface AND no recent dependency in adjacent commits.
- **HIGH** = zero consumers but at least one minor concern (e.g., the route is part of a documented REST surface or was added intentionally with tests, suggesting deliberate-but-unwired design).
- **MEDIUM** = endpoint reads like an intentional public/admin API surface that was added with explicit documentation but never wired into the current UI. Could be intentional public-API design or recently-added feature pending UI.

---

## Findings

### F-3-1 — `GET /api/admin/stats`

- **Location**: `routes/admin/stats.js:45`
- **Type**: Dead endpoint (superseded)
- **Confidence**: CERTAIN
- **Evidence**:
  - Grep `/api/admin/stats['"`+space]` across all consumer paths excluding gitignored chunks: zero non-route, non-changelog references.
  - Only mention in `src/data/changelog.json:1376` is the original "Add admin stats API endpoint" commit message.
  - No tests target it (the e2e/contract specs do not touch it; `test/admin-routes.test.js` covers `/api/admin/status` only).
  - Bootstrap (`routes/admin/bootstrap.js:50` `GET /api/admin/bootstrap`) returns `stats: adminStats` from the identical `statsService.getAdminStats()` call. Commit `7cd7672` migrated the settings drawer off this endpoint.
- **Recommendation**: Remove.
- **Verification steps for human reviewer**: confirm no out-of-tree admin tooling (e.g., personal scripts) hits `/api/admin/stats`; bootstrap response covers all data points.

### F-3-2 — `GET /api/admin/status`

- **Location**: `routes/admin/stats.js:20`
- **Type**: Dead endpoint
- **Confidence**: CERTAIN
- **Evidence**: Only references are the route declaration and 5 hits in `test/admin-routes.test.js:794-841` that exercise the endpoint for its own sake. Zero non-test consumers in `src/js/**`, `views/**`, `templates/**`, `browser-extension/**`. The `adminCodeExpiry` info it returns is not re-fetched by any client.
- **Recommendation**: Remove (and drop the corresponding describe block in `admin-routes.test.js`).

### F-3-3 — `GET /api/admin/events`

- **Location**: `routes/admin/events.js:29`
- **Type**: Dead endpoint (superseded)
- **Confidence**: CERTAIN
- **Evidence**: Bootstrap returns `events.pending` via the same `adminEventService.getPendingEvents()` call. Grep `apiCall.*admin/events` and `fetch.*admin/events` in `src/js/**`: zero matches for the bare path. Zero non-route consumers anywhere.
- **Recommendation**: Remove.

### F-3-4 — `GET /api/admin/events/counts`

- **Location**: `routes/admin/events.js:68`
- **Type**: Dead endpoint (superseded)
- **Confidence**: CERTAIN
- **Evidence**: Bootstrap returns `events.counts` via the same `getPendingCountsByPriority()` call. No grep hits for the path string outside the route file.
- **Recommendation**: Remove.

### F-3-5 — `GET /api/admin/telegram/status`

- **Location**: `routes/admin/telegram.js:42`
- **Type**: Dead endpoint (superseded)
- **Confidence**: CERTAIN
- **Evidence**: Bootstrap returns `telegram: {...}` from `telegramNotifier.getConfig()` — same data. Git log (`git log -S "/api/admin/telegram/status" -- src`) shows the last consumer disappeared in commit `7cd7672` (admin bootstrap unification). Zero non-route grep hits in any consumer path.
- **Recommendation**: Remove.

### F-3-6 — `POST /api/admin/album-summaries/fetch-single`

- **Location**: `routes/admin/album-summaries.js:128`
- **Type**: Dead endpoint
- **Confidence**: CERTAIN
- **Evidence**: Inline comment at routes/admin/album-summaries.js:127 reads `// Fetch summary for a single album (for testing/manual trigger)` — labeled as a manual-trigger scratch endpoint. Grep `album-summaries/fetch-single` finds only the route definition and the file header docblock. No test exercises it; no UI consumer in `src/js/modules/settings-drawer/handlers/album-summary-actions.js` (only `/stats`, `/status`, `/fetch`, `/stop` are called there).
- **Recommendation**: Remove.

### F-3-7 — `POST /admin/api/merge-albums`

- **Location**: `routes/admin/duplicates.js:67`
- **Type**: Legacy endpoint (replaced by `/admin/api/merge-cluster`)
- **Confidence**: CERTAIN
- **Evidence**: Only `/admin/api/merge-cluster` and `/admin/api/merge-cluster/dry-run` are called from `src/js/modules/duplicate-review-modal.js:475,500`. `/admin/api/merge-albums` has zero non-route references. `src/data/changelog.json:1327` is a historical commit message ("Add admin merge albums API"); no live consumer. The merge-cluster endpoint is the current UI's "merge selected duplicates" entry point.
- **Recommendation**: Remove.

### F-3-8 — `GET /api/admin/catalog-cleanup/default-age`

- **Location**: `routes/admin/catalog-cleanup.js:80`
- **Type**: Dead endpoint
- **Confidence**: CERTAIN
- **Evidence**: Returns the constant `DEFAULT_MIN_AGE_DAYS`. Grep `catalog-cleanup/default-age`: zero matches outside the route file. The two live catalog-cleanup endpoints (`/preview` and `/execute`) are consumed by `src/js/modules/settings-drawer/handlers/admin-handlers.js:397,469`; neither defaults the age via this endpoint — they construct the query string explicitly.
- **Recommendation**: Remove.

### F-3-9 — `GET /api/aggregate-list-years`

- **Location**: `routes/aggregate-list.js:92`
- **Type**: Dead endpoint
- **Confidence**: CERTAIN
- **Evidence**: Zero non-route grep hits. The UI fetches per-year status via `/api/aggregate-list/${year}/status` and per-year contributors via separate endpoints; the "list of years" data the admin UI uses comes from the bootstrap response's `aggregateLists` array (composed from `aggregateListService.getYearsWithMainLists()`). No consumer touches the standalone years list.
- **Recommendation**: Remove.

### F-3-10 — `GET /api/aggregate-list-years/with-main-lists`

- **Location**: `routes/aggregate-list.js:100`
- **Type**: Dead endpoint
- **Confidence**: CERTAIN
- **Evidence**: Zero non-route grep hits. Same supersession story as F-3-9 — bootstrap calls `getYearsWithMainLists()` directly via the service factory, not via this HTTP endpoint.
- **Recommendation**: Remove.

### F-3-11 — `GET /api/aggregate-list/viewed-years`

- **Location**: `routes/aggregate-list.js:151`
- **Type**: Dead endpoint
- **Confidence**: CERTAIN
- **Evidence**: Zero non-route grep hits. The seen/has-seen flow in `views/aggregate-list-page.ejs:1615` uses the per-year `/has-seen` and `/mark-seen` endpoints, not the bulk `viewed-years` listing.
- **Recommendation**: Remove.

### F-3-12 — `GET /api/spotify/token`

- **Location**: `routes/api/spotify.js:164`
- **Type**: Dead endpoint
- **Confidence**: CERTAIN
- **Evidence**: Inline comment at routes/api/spotify.js:163 says "Get Spotify access token for Web Playback SDK". Grep `Spotify\.Player|webplayback|web-playback|access_token` in `src/js/**` returns no Web Playback SDK consumer code. The Spotify integration uses the server-side Connect endpoints (`/play`, `/pause`, `/devices`, `/transfer`, etc.), not the in-browser SDK. No consumer fetches `/api/spotify/token`.
- **Recommendation**: Remove.

### F-3-13 — `GET /api/lastfm/recent-tracks`

- **Location**: `routes/api/lastfm.js:369`
- **Type**: Dead endpoint
- **Confidence**: CERTAIN
- **Evidence**: Zero non-route grep matches (no `src/js/**`, no `views/**`, no `browser-extension/**`, no tests). The endpoint returns the user's recent listening history; no UI surface displays it.
- **Recommendation**: Remove.

### F-3-14 — `POST /api/lastfm/refresh-playcounts`

- **Location**: `routes/api/lastfm.js:424`
- **Type**: Dead endpoint
- **Confidence**: CERTAIN
- **Evidence**: Only the route declaration and a `changelog.json` historical reference. The actual playcount refresh path used by `src/js/modules/album-display/playcount-sync.js:212` is `/api/lastfm/list-playcounts/${listId}?refresh=true` — a query-flag on the list-playcounts endpoint, not this dedicated refresh endpoint. Zero consumers.
- **Recommendation**: Remove.

### F-3-15 — `GET /api/lastfm/top-albums`

- **Location**: `routes/api/lastfm.js:82`
- **Type**: Dead endpoint
- **Confidence**: HIGH
- **Evidence**: Zero non-route grep matches. However, `/api/preferences/lastfm/albums` (route at `routes/preferences.js:140`) provides an equivalent server-side wrapper that pulls top albums via `lastfm_top_albums` field. The two endpoints serve overlapping data domains; this `/top-albums` endpoint may be the original or a duplicate. Listed as HIGH rather than CERTAIN because (a) lastfm is a documented external integration, (b) no test exists for either to confirm which path was canonical.
- **Recommendation**: Investigate further. Confirm whether `/api/preferences/lastfm/albums` covers the same use case before removal.

### F-3-16 — `GET /api/lastfm/album-playcount`

- **Location**: `routes/api/lastfm.js:124`
- **Type**: Dead endpoint
- **Confidence**: HIGH
- **Evidence**: Zero non-route grep matches. Single-album playcount fetches in the UI go through `/api/lastfm/list-playcounts/:listId` (bulk per list) at `src/js/modules/album-display/playcount-sync.js:126`. HIGH rather than CERTAIN because a single-album lookup variant is a plausible-but-currently-unused API surface for a hypothetical track-detail modal.
- **Recommendation**: Investigate further. If no planned consumer, remove.

### F-3-17 — `POST /api/lastfm/batch-playcounts`

- **Location**: `routes/api/lastfm.js:190`
- **Type**: Dead endpoint
- **Confidence**: HIGH
- **Evidence**: Zero non-route grep matches. The list-playcounts endpoint is the canonical bulk path used by the UI. HIGH rather than CERTAIN — batch-by-id (this endpoint) vs batch-by-listId (the live endpoint) are subtly different surfaces; user may have kept this for an alternate use case.
- **Recommendation**: Investigate further. Confirm `/list-playcounts/:listId` covers all current needs; if so, remove.

### F-3-18 — `GET /api/proxy/deezer` (bare album-search proxy)

- **Location**: `routes/api/proxies.js:42`
- **Type**: Dead endpoint
- **Confidence**: HIGH
- **Evidence**: Zero programmatic consumers. The browser extension's `README.md:138` claims it uses this endpoint for cover-art fetching, but `browser-extension/background.js` only calls `/api/proxy/musicbrainz` — the README is stale. The other Deezer proxies (`/api/proxy/deezer/artist` at line 65 and `/api/proxy/deezer/artist/:artistId/albums` at line 88) ARE consumed (`src/js/musicbrainz.js:172`). Only the bare album-search proxy is dead. HIGH rather than CERTAIN because the stale README claim raises a faint doubt that some installed browser extension version may still call it.
- **Recommendation**: Investigate further. If the user can confirm no live extension build calls `/api/proxy/deezer?q=`, remove. The README also needs updating either way.

### F-3-19 — `GET /api/admin/events/history`

- **Location**: `routes/admin/events.js:46`
- **Type**: Dead-or-feature-stub
- **Confidence**: MEDIUM
- **Evidence**: Zero non-route grep matches. Service-layer method (`adminEventService.getEventHistory`) exists. Adjacent endpoints (`/api/admin/events`, `/counts`) were superseded by bootstrap but this one was not — bootstrap only returns *pending* events, not history. The endpoint is documented in the file's header docblock but has no consumer. Could be an admin UI feature not yet wired up.
- **Recommendation**: Investigate further. Ask user whether an admin event-history view is planned. If not, remove. If yes, leave but note as not currently wired.

### F-3-20 — `GET /api/admin/events/:eventId`

- **Location**: `routes/admin/events.js:83`
- **Type**: Dead-or-feature-stub
- **Confidence**: MEDIUM
- **Evidence**: Zero non-route grep matches. The only `/api/admin/events/${eventId}` template-literal in the codebase is `admin-actions.js:298` which always appends `/action/${action}` — i.e., never invokes the bare event-by-ID GET. Service method `getEventById` is exposed. Same "feature stub" story as F-3-19.
- **Recommendation**: Investigate further alongside F-3-19.

### F-3-21 — `GET /api/admin/events/actions/:eventType`

- **Location**: `routes/admin/events.js:140`
- **Type**: Dead-or-feature-stub
- **Confidence**: MEDIUM
- **Evidence**: Zero non-route grep matches. Returns "available actions for an event type" — clearly meant to drive a generic event-action UI that doesn't exist yet.
- **Recommendation**: Investigate further alongside F-3-19.

### F-3-22 — `POST /api/admin/telegram/test`

- **Location**: `routes/admin/telegram.js:148`
- **Type**: Dead-or-feature-stub
- **Confidence**: MEDIUM
- **Evidence**: Zero non-route grep matches. Distinct from `/test-preview` (which IS consumed at `telegram-actions.js:461`). The file's header docblock at lines 7-8 distinguishes `/test` (send a test message) from `/test-preview` (preview without sending). The UI currently only calls `/test-preview`. Could be a one-time admin debugging tool the user keeps but doesn't expose via UI.
- **Recommendation**: Investigate further. Confirm with user whether `/test` is invoked manually (e.g., via curl) during onboarding.

### F-3-23 — `POST /api/admin/telegram/link-account`

- **Location**: `routes/admin/telegram.js:202`
- **Type**: Dead-or-feature-stub
- **Confidence**: MEDIUM
- **Evidence**: Zero non-route grep matches. Per file docblock (line 13): "Link admin to Telegram". This is an admin-to-bot account linking flow that no UI currently invokes. The Telegram integration code at `services/telegram/*` does account linking via bot-side message handlers, not HTTP. May be an alternative entry point kept around intentionally.
- **Recommendation**: Investigate further. Confirm whether Magnus manually invokes this (e.g., one-time during setup).

### F-3-24..F-3-35 — `/api/preferences/*` granular endpoints

- **Type**: REST API surface with no UI consumer (12 endpoints)
- **Confidence**: MEDIUM (all)
- **Context**: Commit `229a435` ("Add preferences API endpoints with documentation (Phase 6)") deliberately added these as a documented REST surface. Each has dedicated tests in `test/preferences-routes.test.js` — they are tested and stable but not consumed by the current UI. The UI uses `/api/preferences` (root, consumed at `data-loaders.js:78`), `/api/preferences/summary` (consumed), `/api/preferences/sync` (consumed), `/api/preferences/spotify/artists`, `/api/preferences/spotify/tracks`, `/api/preferences/lastfm/artists` (all consumed by `data-loaders.js`). Everything else is test-only.
- **Recommendation**: Investigate further with user. These may be intentional public API surface. **Do not remove without explicit confirmation**.

| ID | Endpoint | File:Line |
| -- | -------- | --------- |
| F-3-24 | `GET /api/preferences/status` | `routes/preferences.js:46` |
| F-3-25 | `GET /api/preferences/genres` | `routes/preferences.js:58` |
| F-3-26 | `GET /api/preferences/artists` | `routes/preferences.js:64` |
| F-3-27 | `GET /api/preferences/countries` | `routes/preferences.js:70` |
| F-3-28 | `GET /api/preferences/spotify` (bare) | `routes/preferences.js:76` |
| F-3-29 | `GET /api/preferences/spotify/albums` | `routes/preferences.js:112` |
| F-3-30 | `GET /api/preferences/lastfm` (bare) | `routes/preferences.js:118` |
| F-3-31 | `GET /api/preferences/lastfm/albums` | `routes/preferences.js:139` |
| F-3-32 | `GET /api/preferences/affinity` | `routes/preferences.js:154` |
| F-3-33 | `GET /api/preferences/affinity/genres` | `routes/preferences.js:160` |
| F-3-34 | `GET /api/preferences/affinity/artists` | `routes/preferences.js:172` |
| F-3-35 | `POST /api/preferences/aggregate` | `routes/preferences.js:184` |

For each: zero non-test, non-route consumers in `src/js/**`, `views/**`, `templates/**`, `browser-extension/**`, `public/**` (excluding gitignored chunks), `.github/**`, `Dockerfile`, `docker-compose*.yml`.

---

## Non-candidates explicitly cleared (illustrative subset)

These were investigated and confirmed alive — recorded so future Phase 3 reruns don't re-examine them.

| Endpoint | Alive because |
| -------- | ------------- |
| `/api/spotify/track`, `/api/tidal/track`, `/api/tidal/album` | Built dynamically as `/api/spotify/${type}` / `/api/tidal/${type}` in `src/js/utils/playback-service.js:124-125`. |
| `/api/aggregate-list/:year/lock`, `/unlock` | Built as `/api/aggregate-list/${year}/${action}` in `src/js/modules/settings-drawer/handlers/aggregate-actions.js:141`. |
| `/api/recommendations/:year/lock`, `/unlock` | Built as `/api/recommendations/${year}/${action}` in `aggregate-actions.js:174`. |
| `/api/aggregate-list/:year/has-seen`, `/mark-seen` | Consumed by EJS template `views/aggregate-list-page.ejs:1615,1506`. |
| `/api/admin/stats`-adjacent `/api/stats` | Consumed by `src/js/modules/settings-drawer/data-loaders.js:178`. |
| `/api/admin/bootstrap` | Consumed by `data-loaders.js:206` and is the *replacement* for several F-3-N candidates. |
| `/api/health` | Consumed by `Dockerfile:96`, `.github/workflows/docker-build.yml:61,134`, and `views/health.ejs:42`. |

---

## Safety recommendations

1. **Per the audit's CERTAIN-only removal policy**, the 14 CERTAIN findings (F-3-1..F-3-14) are the only candidates for an automatic removal commit. The 9 HIGH and 12 MEDIUM findings require explicit user direction.
2. **Staged removal**: group by route file to minimize churn. Suggested commits:
   - admin-stats group: F-3-1, F-3-2 (one commit, `routes/admin/stats.js`).
   - admin-events group: F-3-3, F-3-4 (one commit, `routes/admin/events.js`). Leave F-3-19, F-3-20, F-3-21 for user decision.
   - admin-telegram group: F-3-5 (one commit). Leave F-3-22, F-3-23 for user decision.
   - One-offs: F-3-6 (album-summaries), F-3-7 (duplicates merge-albums), F-3-8 (catalog-cleanup default-age) — one commit each.
   - aggregate-list group: F-3-9, F-3-10, F-3-11 (one commit, `routes/aggregate-list.js`).
   - api-spotify: F-3-12 (one commit, `routes/api/spotify.js`).
   - api-lastfm: F-3-13 (recent-tracks), F-3-14 (refresh-playcounts) — one commit. Defer F-3-15, F-3-16, F-3-17 pending HIGH-confidence answers.
3. **Tests to update**: F-3-2 removal requires dropping 5 describe blocks in `test/admin-routes.test.js:794-841`.
4. **Service-layer methods orphaned after removal** (verify in Phase 2 follow-up — NOT in Phase 3 scope):
   - `adminEventService.getPendingEvents`, `getPendingCountsByPriority` become callable only from bootstrap.js if F-3-3 + F-3-4 land — still alive, just one fewer call site.
   - `albumSummaryService.fetchAndStoreSummary` becomes callable only from internal triggers if F-3-6 lands — confirm internal new-album-trigger path still uses it.
   - `aggregateListService.getYearsWithMainLists` only called from bootstrap.js once F-3-9 + F-3-10 + F-3-11 land — still alive.
5. **Stale documentation to clean up** (cross-phase referrals):
   - `browser-extension/README.md:137-139` references `/api/proxy/musicbrainz`, `/api/proxy/deezer`, `/api/proxy/image` — but the extension only calls `/api/proxy/musicbrainz`. Phase 1/12 territory.
   - Route file header docblocks at `routes/admin/stats.js:5-9`, `routes/admin/events.js:6-11`, `routes/admin/telegram.js:5-14`, `routes/admin/album-summaries.js:5-10`, `routes/admin/duplicates.js:5-7`, `routes/admin/catalog-cleanup.js` need pruning to match whatever survives.
