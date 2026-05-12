# Phase 1 — Findings

**Run:** 2026-05-12  |  **Phase:** 1 — Orphan files & dead leftovers

## Summary

- **Total Phase-1 candidates:** 9 (CERTAIN: **2**, HIGH: **1**, MEDIUM: **2**, LOW: **0**, needs-info: **4**)
- **Reachability sweeps performed:**
  - **1c** (Vite import graph from `src/js/main.js`): 107 / 107 files reachable — **zero orphans**.
  - **1d** (CommonJS require graph from `index.js` + `templates.js` + `scripts/*.js` + `test/**/*.test.js` + all 64 migration files + `db/migrations/index.js`): 227 / 227 files in `services/ utils/ middleware/ config/ db/ routes/` reachable — **zero orphans**.
  - **1e** (views/templates): all 5 EJS views and all 5 `templates/*.js` reachable — **zero orphans**.
- **Significant landmines avoided / cleared:**
  - Vite `manualChunks` substrings (`music-services`, `import-export`, `musicbrainz`, `sortablejs`) — none of the candidates here touch any of those modules.
  - `commonjsOptions.include` allowlist at [vite.config.js:18](../../vite.config.js#L18) for `utils/normalization.js` — not affected (file is reachable and not renamed).
  - Tailwind `safelist` — not in scope this phase.
  - Migration auto-loader (`fs.readdirSync` in [db/migrations/index.js:38-54](../../db/migrations/index.js#L38)) — all 64 migration files seeded as entry points.
  - `deps`-object destructuring landmine — graph follows `require()` so services consumed via `deps.X` are still reachable through `index.js`. Spot-checked `aggregate-audit` (facade): correctly reached.
  - Recently-merged DB modernization stream (commits `54828c9..8143c88`, PRs `#353..#356`) — no `db/` / `services/` / repository file is flagged in this phase.
- **Scope handoffs (deliberately NOT flagged here):**
  - **1a — root-level leftovers** (`nul`, `.restart-trigger`, `DB_LAYER_UNIFICATION_PLAN.md`, `DB_MODERNIZATION_PLAN.tmp.txt`, `skills-lock.json`, `DESIGN.md`): already covered exhaustively in [`docs/audit/phase-12-findings.md`](phase-12-findings.md) as F-12-1..F-12-6. To avoid conflicting findings, this phase **defers to Phase 12**. The audit plan itself routes these to Phase 12 (plan line 37 — "User confirms before any removal"). Quick state recap: `nul` is gone from the working tree; `.restart-trigger` and `DESIGN.md` are gitignored local-only files; `DB_LAYER_UNIFICATION_PLAN.md`, `DB_MODERNIZATION_PLAN.tmp.txt`, `skills-lock.json` are tracked and awaiting Phase-12 user verdict.
  - **Unwired one-off scripts** (`scripts/deduplicate-list-items.js`, `scripts/resize-existing-images.js`): covered in [`docs/audit/phase-11-findings.md`](phase-11-findings.md). Per user instructions and the audit plan, Phase 11 owns these.

---

## Findings

### F-1-1 — [`public/countries.txt`](../../public/countries.txt)

- **Confidence:** **CERTAIN**
- **Type:** Duplicate static asset / legacy file
- **Sub-phase:** 1f
- **Evidence:**
  - File exists at [`public/countries.txt`](../../public/countries.txt) (1,943 bytes) AND identical file exists at [`src/data/countries.txt`](../../src/data/countries.txt) (1,943 bytes). SHA-256 of both: `6DF446E1068D98A1020B0442383BA1270F61CEC4CFD823F89140894A0DC117AD` — byte-identical.
  - The **bundled copy** (`src/data/countries.txt`) is the active source: imported via Vite `?raw` at [`src/js/app.js:3`](../../src/js/app.js#L3) (`import countriesText from '../data/countries.txt?raw'`) and consumed at [`src/js/app.js:129`](../../src/js/app.js#L129) (`setAvailableCountries(parseStaticList(countriesText))`).
  - Reference grep for `countries.txt` returns only `src/js/app.js`, `src/data/changelog.json` (historic note), and the audit plan itself. **No code anywhere fetches `/countries.txt` over HTTP.** Grep for `fetch.*countries`: zero hits.
  - The build flips the bundle to inline this text — so even if a path `/countries.txt` were requested, the running app does not need the public copy.
  - Direct precedent for removal: commit `4b64bc6` ("Bundle genres and countries at build time for instant availability") moved both files to `src/data/`, and a later commit (referenced in `src/data/changelog.json:1453`) removed `public/genres.txt` for exactly the same reason: *"The active genres file is src/data/genres.txt which is imported via Vite. The public/genres.txt file was a legacy duplicate and not used by the application."* The lone surviving sibling `public/countries.txt` was missed during that cleanup.
  - Last touched: `2ed94ba` "Adding countries to the album conext" (the original add). Never updated since.
- **Removal impact:** None. The file is served by `express.static('public', ...)` in [`index.js:147`](../../index.js#L147), but nothing in the app or browser-extension code requests `/countries.txt`. The bundled copy at `src/data/countries.txt` is unaffected.
- **Recommendation:** **Remove** — direct exact-precedent twin of the already-removed `public/genres.txt`.
- **Verification steps for human reviewer:**
  - `git grep "countries.txt"` after removal should match nothing in code; `src/data/countries.txt` must remain.
  - Optional: confirm no operational dashboards or external scrapers hit `/countries.txt` (extremely unlikely — there is no documented public API for it).

---

### F-1-2 — [`mobile/`](../../mobile) directory contents

- **Confidence:** **CERTAIN** (with caveats below)
- **Type:** Orphaned build artifacts from removed mobile SPA
- **Sub-phase:** 1b
- **User pre-approval:** Per F-0-13.8 / decision recorded 2026-05-12 — user has approved removal **pending zero references**. Verification below confirms that condition.
- **Evidence:**
  - Working tree contains only 3 entries under `mobile/`:
    - `mobile/dist/` (built mobile SPA: index.html, manifest.json, assets/*.js, assets/*.css)
    - `mobile/node_modules/` (development deps for the mobile build)
    - `mobile/tsconfig.tsbuildinfo`
  - **Git tracking:** `git ls-files mobile/` returns **zero tracked files**. All three on-disk entries are gitignored:
    - `mobile/dist` — matched by `.gitignore:92` (`dist`)
    - `mobile/node_modules` — matched by `.gitignore:44` (`node_modules/`)
    - `mobile/tsconfig.tsbuildinfo` — matched by `.gitignore:51` (`*.tsbuildinfo`)
  - **Was-it-ever-a-thing check:** The mobile SPA was an actual feature at one point but has been removed:
    - [`test/e2e/basic.spec.js:177-185`](../../test/e2e/basic.spec.js#L177) explicitly asserts `/mobile` and `/mobile/login` now return **404** (test description: "should return 404 for removed /mobile SPA entry").
    - [`test/mobile-routing.test.js:163`](../../test/mobile-routing.test.js#L163) describe block: *"auth routes no longer redirect to /mobile"*.
    - `index.js` has zero references to anything `mobile/*` route or static.
    - The substring "mobile" still appears in code, but every appearance refers to **mobile-UI runtime behavior** in `src/js/modules/mobile-ui*` (responsive helpers for the main bundle) — NOT the standalone `mobile/` SPA directory.
  - **References to `mobile/` (the directory) found in the repo:**
    - `.dockerignore:3-4` — `mobile/node_modules`, `mobile/dist` (defensive ignores; harmless if directory is gone).
    - [`eslint.config.mjs:52`](../../eslint.config.mjs#L52) — `'mobile/**'` in `ignores` (orphans if directory gone; trivial to remove).
    - [`utils/maintainability-metrics.js:25`](../../utils/maintainability-metrics.js#L25) — `'mobile/'` in `DEFAULT_IGNORED_PREFIXES` (orphans if directory gone; trivial to remove).
    - `DB_MODERNIZATION_PLAN.tmp.txt:47` — historical note in a Phase-12 candidate doc.
    - Audit plan / phase docs (also part of the audit).
- **Removal impact:**
  - Deleting the on-disk `mobile/` directory deletes only gitignored build artifacts — **no git change is produced** by this step alone.
  - Hygiene follow-ups (each is a separate, trivial code change the user can sign off on independently):
    1. Remove the `'mobile/**'` ignore from [`eslint.config.mjs:52`](../../eslint.config.mjs#L52).
    2. Remove the `'mobile/'` entry from `DEFAULT_IGNORED_PREFIXES` in [`utils/maintainability-metrics.js:25`](../../utils/maintainability-metrics.js#L25).
    3. Optionally remove the `mobile/node_modules` and `mobile/dist` lines from `.dockerignore:3-4` (harmless to leave).
  - **`mobile/node_modules/` is large.** Deletion is non-trivial on Windows due to long-path issues — recommended command: `Remove-Item -LiteralPath 'C:\Users\me513\sushe-online\mobile' -Recurse -Force` after closing any IDE that may have files open. If long-path errors occur, prefer `cmd /c "rmdir /s /q mobile"`.
- **Recommendation:** **Remove** the on-disk directory and follow up with the three small hygiene edits in a separate atomic commit.
- **Verification steps for human reviewer:**
  - Confirm `git status` is unchanged after `rm -rf mobile/` (it should be — everything inside is gitignored).
  - Run `npm run lint` after the optional `eslint.config.mjs` edit to ensure no other rule complains about the missing ignore.
  - Run `npm test` — the e2e specs asserting `/mobile` returns 404 must still pass.
- **Last touched:** No git activity on `mobile/` itself — the directory contents are all gitignored. Most recent disk mtime: working-tree only.

---

### F-1-3 — [`public/service-worker.js`](../../public/service-worker.js)

- **Confidence:** **HIGH** (leaning remove, but a deploy-cycle consideration warrants user judgment)
- **Type:** Functionally orphaned static asset; live unregister-shim exists in client
- **Sub-phase:** 1c-adjacent (referenced from `views/layout.ejs`, not from Vite graph) — flagged here per F-0-13.6.
- **Evidence:**
  - File present and tracked: `public/service-worker.js` (2,907 bytes). Last commit: `8f2c5fb` "Bump SW cache to v6, add Vite base path config for correct chunk loading".
  - Registration in client is **commented out**: [`views/layout.ejs:97-107`](../../views/layout.ejs#L97) — the `navigator.serviceWorker.register('/service-worker.js')` call is wrapped in `/* ... */` with the comment "Temporarily disable service worker to debug CSRF issues".
  - Immediately after (`views/layout.ejs:110-117`), there is an **active** loop that **unregisters** any existing service workers (`getRegistrations().then(...).unregister()`). The team chose to keep the file deployed while clients unregister themselves on next page load.
  - The only other repo reference is an ESLint stanza for SW globals at [`eslint.config.mjs:168-182`](../../eslint.config.mjs#L168) — orphans if file removed.
  - No `routes/*.js` references the path; the file is served only via the `express.static('public', ...)` blanket.
- **Why HIGH, not CERTAIN:**
  - Browser SW spec: a previously-registered worker keeps running its install/fetch handlers from the **cached worker script** in the user agent. The unregister loop runs *every* page load, so existing clients self-clean — but a user who never returns will still have the SW in their browser. Removing the file makes a future re-registration attempt 404 (harmless), but the unregister flow itself does not require the file to exist on the server (it operates on the already-installed worker code).
  - The team **kept** the file through cache-version bumps (last bump was `v6` in `8f2c5fb`). Whether that was a deliberate "keep it alive for stale-client compatibility" decision or just inertia is a judgment call.
- **Removal impact:**
  - If removed: clients still get cleaned by `getRegistrations()...unregister()` in `layout.ejs:110`; the dead `/service-worker.js` URL would 404 (no consequence — nothing fetches it from active code).
  - Coordinated cleanup would also drop the ESLint stanza at `eslint.config.mjs:168-182`. Trivial.
- **Recommendation:** **Investigate further** before removing — defer to user. If kept, document the "stale-client compat" intent inline; if removed, do it as one commit that also drops the ESLint stanza.
- **Verification questions for user:**
  1. Are you ready to drop the service worker file, or do you want to keep it around until the next major deploy as a defensive measure for stale clients? (The unregister loop in `layout.ejs:110-117` makes the file functionally unreachable from any new client load.)
  2. If removed: also drop the ESLint config block at `eslint.config.mjs:168-182`. Confirm?

---

### F-1-4 — [`browser-extension/screenshot-1-context-menu.png`](../../browser-extension/screenshot-1-context-menu.png)

- **Confidence:** **MEDIUM** (signals point to "yes, remove", but no machine-verifiable confirmation that the `-final` is the canonical one)
- **Type:** Superseded iteration of a Chrome Web Store submission screenshot
- **Sub-phase:** 1h
- **Evidence:**
  - Tracked file (316,403 bytes). Last commit: `65c3987` "Add Chrome extension for RateYourMusic integration" — the original add. Never updated since.
  - All three screenshot-1 variants were added in the same initial commit `65c3987` and never touched again:
    - `screenshot-1-context-menu.png` (316,403 bytes) — distinct image
    - `screenshot-1-context-menu-fixed.png` (289,624 bytes) — distinct image (the "fixed" iteration)
    - `screenshot-1-final.png` (285,124 bytes) — distinct image
  - SHA-256 hashes confirm all three are distinct content, not literal duplicates — they are three iterations of the same shot.
  - Filename suffix convention (`-fixed`, then `-final`) is unambiguous artist's progress through editorial review.
  - **Zero references anywhere** in the codebase:
    - [`browser-extension/package-for-store.sh:36-47`](../../browser-extension/package-for-store.sh#L36) lists exactly the files zipped for store submission — screenshots are NOT included (they go up via the Chrome Web Store dashboard form, not in the extension zip).
    - `browser-extension/README.md` does not reference screenshots.
    - No HTML, JS, CSS, or manifest file references the filename.
    - Grep `screenshot-1` returns no matches outside the file itself.
- **Why MEDIUM (not CERTAIN):**
  - Per the audit's caution policy: even with `-final` naming convention being a strong signal, only the user can confirm which iteration is the canonical submitted asset and whether the others are kept as backup/changelog reference for a future store-listing update.
  - These files are not consumed by code, so removal is purely a cleanup of submission collateral; no runtime risk.
- **Removal impact:** None to the running app or extension. Pure repo-size cleanup (~316 KB).
- **Recommendation:** **Investigate further** — confirm with user that `-final` is canonical.
- **Verification questions for user:**
  - Is `screenshot-1-final.png` the canonical Chrome Web Store screenshot for asset #1? If yes, `screenshot-1-context-menu.png` and `screenshot-1-context-menu-fixed.png` can be removed.
- **Last touched:** `65c3987` (initial extension commit).

---

### F-1-5 — [`browser-extension/screenshot-1-context-menu-fixed.png`](../../browser-extension/screenshot-1-context-menu-fixed.png)

- **Confidence:** **MEDIUM**
- **Type:** Superseded iteration of a Chrome Web Store submission screenshot
- **Sub-phase:** 1h
- **Evidence:** Same investigation as F-1-4. Tracked file (289,624 bytes). Added in `65c3987`. Filename's `-fixed` suffix is the canonical "we iterated and then iterated again" pattern; the third file has `-final` suffix. Zero code references.
- **Why MEDIUM:** Same as F-1-4 — needs user to confirm which iteration is canonical.
- **Removal impact:** None to runtime; ~290 KB cleanup.
- **Recommendation:** **Investigate further** — bundled into the same user question as F-1-4 / F-1-6.

---

### F-1-6 — [`browser-extension/screenshot-2-options.png`](../../browser-extension/screenshot-2-options.png)

- **Confidence:** **MEDIUM**
- **Type:** Superseded iteration of a Chrome Web Store submission screenshot
- **Sub-phase:** 1h
- **Evidence:** Tracked file (68,949 bytes). Added in `65c3987`. Three variants of screenshot 2 exist:
  - `screenshot-2-options.png` (68,949 bytes)
  - `screenshot-2-options-fixed.png` (65,022 bytes)
  - `screenshot-2-final.png` (86,997 bytes)
  - SHA-256 hashes confirm all three are distinct images.
  - Zero references in any code, HTML, README, or package-for-store.sh.
- **Why MEDIUM:** Same as F-1-4.
- **Recommendation:** **Investigate further** — pair with F-1-4 / F-1-5 / F-1-7 in the same user question.

---

### F-1-7 — [`browser-extension/screenshot-2-options-fixed.png`](../../browser-extension/screenshot-2-options-fixed.png)

- **Confidence:** **MEDIUM**
- **Type:** Superseded iteration of a Chrome Web Store submission screenshot
- **Sub-phase:** 1h
- **Evidence:** Tracked file (65,022 bytes). Added in `65c3987`. `-fixed` naming, paired with `screenshot-2-final.png` which is presumably canonical. Zero code references.
- **Why MEDIUM:** Same as F-1-4.
- **Recommendation:** **Investigate further** — pair with F-1-4 / F-1-5 / F-1-6 in the same user question.

---

### Consolidated user question for F-1-4 through F-1-7

The browser-extension directory has 4 superseded screenshot iterations (2 for context-menu, 2 for options), totaling roughly **740 KB**. The `-final.png` versions of each are presumably the canonical Chrome Web Store assets.

- **Q-1-A:** Confirm `screenshot-1-final.png` and `screenshot-2-final.png` are the canonical store submissions. If yes, the 4 superseded files (F-1-4 through F-1-7) are safe to remove in a single commit. If you want to keep any as historical reference, say which. Removal has no runtime impact (`browser-extension/package-for-store.sh` zips only the runtime extension files — screenshots are uploaded separately to the Chrome Web Store dashboard).

---

### F-1-8 — Underused PWA icon set under [`public/icons/`](../../public/icons)

- **Confidence:** **MEDIUM**
- **Type:** Possible orphaned static assets
- **Sub-phase:** 1g
- **Evidence:**
  - 33 PNG files total under `public/icons/` (6 Android, 26 iOS, plus `icons.json`).
  - **Explicitly referenced** in repo source:
    - `public/manifest.json` — only 4 paths: `/og-image.png`, `/icons/android/android-launchericon-192-192.png`, `/icons/android/android-launchericon-512-512.png`, `/icons/ios/180.png`.
    - `views/layout.ejs:15` — `<link rel="apple-touch-icon" href="/icons/ios/180.png">`.
    - Icon shim redirects in [`index.js:305-327`](../../index.js#L305) — `/favicon.ico` → `/icons/ios/32.png`, `/apple-touch-icon.png` → `/icons/ios/180.png`, `/apple-touch-icon-precomposed.png` → `/icons/ios/180.png`, `/apple-touch-icon-120x120.png` → `/icons/ios/120.png`, `/apple-touch-icon-152x152.png` → `/icons/ios/152.png`, `/apple-touch-icon-180x180.png` → `/icons/ios/180.png`.
    - [`public/icons/icons.json`](../../public/icons/icons.json) — declares 32 icons by relative path (full catalog).
  - **Total explicitly-referenced sizes:** iOS: 32, 120, 152, 180. Android: 192-192, 512-512. That's **6 of 33** files.
  - **Not explicitly referenced:**
    - iOS: 16, 20, 29, 40, 50, 57, 58, 60, 64, 72, 76, 80, 87, 100, 114, 128, 144, 167, 192, 256, 512, 1024 (22 files).
    - Android: 48-48, 72-72, 96-96, 144-144 (4 files).
    - `public/icons/icons.json` itself: zero code references in the repo (grep `icons.json` → zero matches in `.js`, `.ejs`, `.json` aside from being a directory entry).
  - The script [`scripts/optimize-icons.sh`](../../scripts/optimize-icons.sh) **explicitly prunes** non-essential icons (keeping only iOS 180/192/512 and Android 192/512). The script's last commit is recent enough to suggest it was *intended* to be run — and its existence is a tacit admission that most of the iOS icon zoo is unnecessary. The fact that the 33 icons are still present means the script has not been run.
- **Why MEDIUM (not HIGH/CERTAIN):**
  - PWA / browser auto-discovery: some user agents (Apple Safari notably) probe specific `apple-touch-icon-NNxNN.png` URLs even without manifest references. The icon shim redirects already cover the common ones (`/apple-touch-icon-120x120.png` etc.), so a 404 on a non-shimmed size *should* fall back to the manifest — but I can't rule out external probing of e.g. `/icons/ios/76.png` directly.
  - `icons.json` could be consumed by an external tool the audit can't see (CI step that lints icon presence, an external monitor, a script invoked manually).
  - The `optimize-icons.sh` script is wired (`npm run optimize:icons`) but does not appear to have been run in any commit history.
- **Removal impact:** If `optimize-icons.sh`'s intent is the truth, removing the unreferenced iOS / Android sizes is safe — but the script also generates `.webp` versions and renames things, so simply deleting files manually is a different operation.
- **Recommendation:** **Investigate further** — this is a coordinated cleanup, not a one-off file delete. Defer to the user.
- **Verification questions for user:**
  1. Is `public/icons/icons.json` consumed by anything external (a CI step, a deploy script, manual ops tool)? If no, it's an orphan as well.
  2. Is the intent of `scripts/optimize-icons.sh` (keep only iOS 180/192/512 + Android 192/512, plus the `/favicon.ico` → 32 and the apple-touch shims at 120/152/180) still your intended icon policy?
  3. If yes, would you like a recommended list of safe-to-delete iOS / Android sizes? (At minimum: iOS 16, 20, 29, 40, 50, 57, 58, 60, 64, 72, 76, 80, 87, 100, 114, 128, 144, 167, 256, 512, 1024; Android 48-48, 72-72, 96-96, 144-144.)
- **Last touched:** initial PWA-icons commit; not re-touched in recent history.

---

### F-1-9 — [`browser-extension/STORE_LISTING.md`](../../browser-extension/STORE_LISTING.md) — dangling reference

- **Confidence:** **needs-info** (not a removal candidate — file doesn't exist; this is a dead documentation reference)
- **Type:** Dangling documentation reference
- **Sub-phase:** 1a-adjacent (not in original scope, surfaced incidentally)
- **Evidence:**
  - `browser-extension/README.md:11` references `STORE_LISTING.md` (`**[STORE_LISTING.md](STORE_LISTING.md)** - Store description & marketing copy`).
  - `browser-extension/package-for-store.sh:68` instructs the user to "Fill out the store listing (see STORE_LISTING.md)".
  - The file `browser-extension/STORE_LISTING.md` **does not exist** on disk and is not tracked in git (`git ls-files browser-extension/` confirms absence).
  - Not a Phase-1 removal candidate (the file isn't here to remove). It's a doc-rot finding: two places reference a file that was either never written or was removed.
- **Recommendation:** **Investigate further** — user decides:
  - (a) author `STORE_LISTING.md` (treat the README/script as authoritative TODO),
  - (b) drop the two references (the README line and the script's echo line).
- **Verification question for user:** Was `STORE_LISTING.md` ever created? If no, prefer option (b) — delete the two dangling refs in a follow-up commit.

---

## Cross-cutting observations

1. **The repo is exceptionally well-maintained at the import/require-graph level.** Reachability sweeps for both the Vite frontend (107 files) and the CommonJS server (227 files in scope) produced **zero orphans**. The "Phase 1 candidate" surface is concentrated entirely in static assets and tracking documents — exactly the categories the import graph can't see.
2. **Verbal contract with Phase 12:** Root-level leftovers (`nul`, `.restart-trigger`, `DB_LAYER_UNIFICATION_PLAN.md`, `DB_MODERNIZATION_PLAN.tmp.txt`, `skills-lock.json`, `DESIGN.md`) are owned by Phase 12, which has already produced findings. Phase 1 deliberately did not re-litigate them.
3. **`data/` directory** (gitignored runtime dir, F-0-13 plan note): empty in this working tree. Created lazily by `db/index.js` if `DATA_DIR` env says so. Not a Phase-1 candidate — it's an active runtime artifact path.
4. **`mobile/` directory** (F-1-2): the on-disk artifacts are all gitignored; removing the directory produces no git change. The follow-up hygiene edits (ESLint ignore, maintainability ignore) belong to Phase 9 or a coordinated commit alongside removal.
5. **`public/service-worker.js`** is technically reachable via the static-file server but is functionally dead from a runtime perspective — the only registration call is commented out and an active unregister loop runs on every page load. Listed as F-1-3 HIGH; user judgment needed on deploy-cycle hygiene.
6. **PWA icon set**: a long tail of unreferenced iOS / Android sizes is present. The `optimize-icons.sh` script that would clean these up is wired via `npm run optimize:icons` but apparently has never been run. Listed as F-1-8 MEDIUM.
7. **No orphaned route / template / view files** — the require graph confirmed every server-side file and every EJS view is referenced from an entry point.

## Open questions (consolidated)

| ID | Topic | What we need from the user |
|----|-------|----------------------------|
| Q-1-A | F-1-4..F-1-7 (4 superseded extension screenshots) | Confirm `-final` is canonical for both context-menu and options shots. Then remove the 4 superseded files in one commit. |
| Q-1-B | F-1-3 (`public/service-worker.js`) | Ready to drop the file now, or keep one more deploy cycle for stale-client safety? |
| Q-1-C | F-1-8 (PWA icon long tail + `icons.json`) | Confirm `optimize-icons.sh`'s pruning policy is still desired. If yes, do the icon prune now. Also confirm `icons.json` is not consumed externally. |
| Q-1-D | F-1-9 (`STORE_LISTING.md` dangling refs) | Was this doc ever authored? If not, drop the two references. |

## Suggested commit sequencing (if user approves removals)

To respect the user's "each removal is its own atomic change" preference, the natural ordering is:

1. **F-1-1 — `public/countries.txt`** (single-file removal, CERTAIN, exact precedent).
2. **F-1-2 — `mobile/` directory contents** (on-disk delete only — no git change). Optionally followed by a small commit dropping the `'mobile/**'` ESLint ignore and the `'mobile/'` entry in `utils/maintainability-metrics.js`.
3. **F-1-4..F-1-7 — 4 superseded screenshots** (single commit pending Q-1-A).
4. **F-1-3 — `public/service-worker.js`** (pending Q-1-B; if approved, same commit also drops the ESLint stanza for the SW globals).
5. **F-1-8 — icon prune** (separate scope; possibly run `npm run optimize:icons` as a single commit).
6. **F-1-9 — `STORE_LISTING.md` references** (small README/script edit, pending Q-1-D).

All other Phase-1 sub-phases (1c, 1d, 1e) produced no candidates and require no action.
