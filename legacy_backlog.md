# Legacy Cleanup Backlog

## Goal

Continue the current refactor direction by removing legacy code, shrinking compatibility surfaces, reducing codebase footprint, and modernizing patterns without taking unnecessary regression risk.

## Current Baseline

- Platform: Node `24.14.1`, npm `11.11.0`, Express `5.1.0`, Vite `7.0.0`
- Maintainability baseline:
  - `app JS files >300 lines`: `83`
  - `app JS files >700 lines`: `20`
  - `app JS legacy markers`: `99`

## Working Rules

- Keep PRs narrow: one boundary, one contract, or one module family at a time.
- Add or update tests before deleting a compatibility path.
- Prefer tightening read paths before write paths.
- Remove one alias or one legacy shape at a time.
- Do not add new `window.*` bridges.
- After every 2-3 cleanup PRs, lower `lint:structure:baseline`.

## Modern Patterns To Use

- Express 5 async handlers that throw into error middleware.
- `?.` and `??` instead of defensive `&&` chains and `||` where falsy values are valid.
- Explicit module imports or DI instead of `window.*` access.
- `AbortController` for cancelable async UI work.
- `Map` and `Set` for dedupe and identity lookups.
- `Object.hasOwn()` instead of prototype-sensitive ownership checks.
- Structured backend logging instead of ad hoc `console.*`.
- Canonical DTOs at boundaries instead of broad normalization deep in feature code.

## PR 1: Freeze Canonical Frontend List Shape

### Goal

Require object-shaped list entries in frontend state and remove raw-array list entry support.

### Target Files

- `src/js/modules/list-data-normalization.js`
- `src/js/modules/app-state.js`
- `test/list-data-normalization.test.js`
- `test/app-state.test.js`

### Changes

- Remove `Array.isArray(entry)` fallback in `normalizeListsMap()`.
- Require list entries to arrive as canonical objects with `_data`.
- Keep `createDefaultListEntry()` only if still needed for explicitly local-only initialization.

### Tests To Run

- `node --test test/list-data-normalization.test.js`
- `node --test test/app-state.test.js`
- `npm run lint:strict`

### Risk

Medium.

### Risk Reduction

- First add tests asserting accepted list DTO shape.
- Do not change backend list payload shape in the same PR unless necessary.

### Expected Win

- One entire legacy list shape removed.
- Less hidden branching in state ingestion.

## PR 2: Retire Remaining Album Field Aliases

### Goal

Remove support for legacy album aliases and keep only canonical fields.

### Target Files

- `src/js/modules/list-data-normalization.js`
- any frontend-facing serializers still emitting aliases
- `test/list-data-normalization.test.js`
- `test/app-state.test.js`
- any affected route/service tests

### Canonical Fields

- `album_id`
- `comments`
- `genre_1`
- `primary_track`
- `secondary_track`

### Legacy Fields To Retire

- `albumId`
- `comment`
- `genre`
- `track_pick`
- `track_picks`

### Tests To Run

- `node --test test/list-data-normalization.test.js`
- `node --test test/app-state.test.js`
- targeted route/service tests for touched payload emitters
- `npm run lint:strict`

### Risk

Medium to high.

### Risk Reduction

- Grep for remaining emitters before deleting readers.
- Tighten one alias family at a time if needed.

### Expected Win

- Canonical album DTO boundary.
- Smaller normalization layer.

## PR 3: Tighten Duplicate Review Contract To Cluster-Only

### Goal

Remove legacy pair-array support from the duplicate review modal and accept only cluster-shaped payloads.

### Target Files

- `src/js/modules/duplicate-review-modal.js`
- `src/js/modules/settings-drawer/handlers/audit-handlers.js`
- duplicate route/service tests
- modal tests if present

### Changes

- Remove `Object|Array` support in `openDuplicateReviewModal()`.
- Delete legacy pair normalization in `normalizeClusters()`.
- Assert cluster response shape at the boundary.

### Tests To Run

- `node --test test/settings-audit-handlers.test.js`
- `node --test test/duplicate-service.test.js`
- any duplicate route tests
- `npm run lint:strict`

### Risk

Low to medium.

### Risk Reduction

- Add one integration-style test for the admin duplicate scan response shape before deleting the adapter.

### Expected Win

- Simpler duplicate UI state.
- Better alignment with recent cluster-merge work.

## PR 4: Remove `window.currentList` Compat Bridge

### Goal

Stop reading selected-list state through `window.currentList` and move consumers to explicit accessors or injected dependencies.

### Target Files

- `src/js/modules/app-state.js`
- `src/js/app.js`
- `src/js/musicbrainz.js`
- `src/js/modules/spotify-player.js`
- `src/js/modules/settings-drawer.js`
- any other direct `window.currentList` consumers

### Changes

- Remove `Object.defineProperty(window, 'currentList', ...)` after consumers are migrated.
- Replace reads with imported state accessors or DI.

### Tests To Run

- `node --test test/app-state.test.js`
- `node --test test/app-startup-ui.test.js`
- `node --test test/spotify-lastfm-utils.test.js`
- any `musicbrainz`-related tests
- `npm run lint:strict`

### Risk

High.

### Risk Reduction

- Migrate by global, not by module family.
- Remove `window.currentList` before `window.lists`.
- Keep changes mechanical.

### Expected Win

- Major legacy bridge reduction.
- Better testability for dependent modules.

## PR 5: Remove `window.lists` Compat Bridge

### Goal

Stop exposing entire list state through `window.lists`.

### Target Files

- `src/js/modules/app-state.js`
- `src/js/app.js`
- `src/js/musicbrainz.js`
- `src/js/modules/album-display.js`
- any other direct `window.lists` consumers

### Changes

- Replace direct global map reads with `getLists()` or narrower helpers.
- Remove `window.lists = ...` writes.

### Tests To Run

- `node --test test/app-state.test.js`
- `node --test test/album-display.test.js`
- any `musicbrainz` tests
- `npm run lint:strict`

### Risk

High.

### Risk Reduction

- Add narrow tests around modules that currently assume mutable global list state.
- Avoid combining with unrelated rendering refactors.

### Expected Win

- One of the largest remaining frontend compatibility surfaces removed.

## PR 6: Shrink `registerAppWindowGlobals`

### Goal

Retire as much of the global app API export layer as possible.

### Target Files

- `src/js/modules/app-window-globals.js`
- `src/js/app.js`
- modules currently calling `window.getListData`, `window.saveList`, `window.selectList`, `window.displayAlbums`, etc.

### Changes

- Remove readonly globals first.
- Remove mutating globals second.
- Prefer direct imports or injected capability objects.

### Tests To Run

- targeted tests for each migrated consumer module
- `node --test test/app-window-globals.test.js`
- `npm run lint:strict`

### Risk

High.

### Risk Reduction

- Split this into sub-PRs if needed.
- Remove small clusters of globals, not all at once.

### Expected Win

- `app-window-globals.js` becomes tiny or deletable.

## PR 7: Consolidate List Menu Config And Actions

### Goal

Share one canonical list-menu config/action source across desktop and mobile.

### Target Files

- `src/js/modules/context-menus.js`
- `src/js/modules/mobile-ui.js`
- `src/js/modules/list-nav.js`
- optionally a new focused shared helper module

### Changes

- Extract pure menu config builder.
- Extract shared list actions for download, toggle-main, rename, send-to-service.
- Keep desktop/mobile renderers separate if needed, but share behavior.

### Tests To Run

- `node --test test/context-menus.test.js`
- `node --test test/list-nav.test.js`
- mobile UI related tests if touched
- `npm run lint:strict`

### Risk

Medium.

### Risk Reduction

- Share config first, then share action handlers.

### Expected Win

- Less duplication across menu implementations.

## PR 8: Merge The Two Album Context Menu Systems

### Goal

Stop maintaining overlapping menu systems in `context-menus.js` and `album-context-menu.js`.

### Target Files

- `src/js/modules/context-menus.js`
- `src/js/modules/album-context-menu.js`
- `src/js/app.js`
- related tests

### Changes

- Choose one canonical action registry.
- Keep stable DOM hooks while moving internals.
- Delete duplicated submenu and cleanup logic.

### Tests To Run

- `node --test test/context-menus.test.js`
- `node --test test/album-context-menu-submenu.test.js`
- `node --test test/recommendations-context-menu.test.js`
- `npm run lint:strict`

### Risk

Medium to high.

### Risk Reduction

- First consolidate action definitions without changing UI markup.
- Only then delete the duplicate implementation.

### Expected Win

- Meaningful footprint reduction.
- Cleaner action model for later mobile/desktop cleanup.

## PR 9: Split `app.js` Into A Thin Composition Root

### Goal

Reduce `app.js` to bootstrap and module wiring only.

### Target Files

- `src/js/app.js`
- existing extracted modules
- possibly new small bootstrap helpers

### Changes

- Move startup orchestration, realtime wiring, and feature wiring out of `app.js`.
- Keep `app.js` as the assembly point only.

### Tests To Run

- `node --test test/app-startup-ui.test.js`
- `node --test test/app-shell-ui.test.js`
- `node --test test/app-discovery-import.test.js`
- `node --test test/app-state.test.js`
- `npm run lint:strict`

### Risk

Medium.

### Risk Reduction

- Move code unchanged first.
- Avoid behavior changes in the extraction PR.

### Expected Win

- Lower coordination complexity.
- Cleaner entrypoint for future changes.

## PR 10: Split `album-display.js` By Responsibility

### Goal

Break up the largest frontend module into focused pieces.

### Target Files

- `src/js/modules/album-display.js`
- `src/js/modules/album-display/*`
- related tests

### Suggested Split Order

1. Pure rendering helpers
2. Tooltip and cover-preview behavior
3. Playcount/update flows
4. Interaction wiring

### Tests To Run

- `node --test test/album-display.test.js`
- `node --test test/album-display-shared.test.js`
- `node --test test/album-display-incremental-update-detector.test.js`
- `npm run lint:strict`

### Risk

High.

### Risk Reduction

- Separate extraction PRs from behavior-change PRs.
- Avoid changing row markup unless there is a bug fix.

### Expected Win

- Largest app JS file reduced.
- Better local reasoning about display behavior.

## PR 11: Split `musicbrainz.js` And Remove Global Coupling

### Goal

Decompose `musicbrainz.js` and remove its reliance on global app APIs.

### Target Files

- `src/js/musicbrainz.js`
- any extracted helper modules
- related tests

### Suggested Split Order

1. Replace `window.*` state and action calls with explicit deps
2. Extract search and result normalization
3. Extract add-to-list flow
4. Extract cover fallback and modal-specific behavior

### Tests To Run

- targeted `musicbrainz` tests if present
- route or integration tests for dependent flows
- `npm run lint:strict`

### Risk

High.

### Risk Reduction

- Remove globals before functional splitting.
- Keep UI behavior stable while moving logic.

### Expected Win

- Major reduction of global coupling.
- One of the biggest files brought under control.

## PR 12: Break Down `mobile-ui.js`

### Goal

Keep `mobile-ui.js` as coordinator only and move implementation details into focused modules.

### Target Files

- `src/js/modules/mobile-ui.js`
- `src/js/modules/mobile-ui/*`
- related tests

### Suggested Split Order

1. List menu and list actions
2. Edit form
3. Summary sheet
4. Searchable select widgets

### Tests To Run

- `node --test test/mobile-ui-album-identity.test.js`
- any mobile UI tests affected by extracted modules
- `npm run lint:strict`

### Risk

Medium.

### Risk Reduction

- Do this after menu/action consolidation work has landed.

### Expected Win

- Smaller coordinator module.
- Better reuse of mobile-specific primitives.

## PR 13: Modernize Realtime Sync Internals

### Goal

Clean up `realtime-sync` internals using current patterns without broad behavior change.

### Target Files

- `src/js/modules/realtime-sync.js`
- `test/realtime-sync.test.js`

### Changes

- Replace noisy `console.*` calls with injected logger or debug gate.
- Keep current event contract stable.
- Simplify list event handling around canonical `listId` paths only.

### Tests To Run

- `node --test test/realtime-sync.test.js`
- `npm run lint:strict`

### Risk

Low.

### Risk Reduction

- No protocol changes in same PR.

### Expected Win

- Cleaner core infra module.
- Better production signal-to-noise.

## PR 14: Ratchet Maintainability Gates

### Goal

Convert cleanup progress into enforced structural improvement.

### Target Files

- `package.json`
- optionally `scripts/maintainability-report.js`

### Changes

- Lower baseline thresholds after each cleanup batch.

### Suggested Ratchet Cadence

- After PRs 1-3:
  - reduce `max-legacy-markers`
- After PRs 4-6:
  - reduce `max-js-files-over-300`
- After PRs 7-10:
  - reduce `max-js-files-over-700`

### Tests To Run

- `npm run report:maintainability:json`
- `npm run lint:structure:baseline`

### Risk

Low.

### Risk Reduction

- Only lower thresholds after merged cleanup, never ahead of it.

### Expected Win

- Prevents structural backsliding.

## Best Execution Order

1. PR 1: Freeze canonical frontend list shape
2. PR 2: Retire remaining album field aliases
3. PR 3: Tighten duplicate review contract to cluster-only
4. PR 4: Remove `window.currentList` compat bridge
5. PR 5: Remove `window.lists` compat bridge
6. PR 6: Shrink `registerAppWindowGlobals`
7. PR 7: Consolidate list menu config and actions
8. PR 8: Merge the two album context menu systems
9. PR 9: Split `app.js`
10. PR 10: Split `album-display.js`
11. PR 11: Split `musicbrainz.js`
12. PR 12: Break down `mobile-ui.js`
13. PR 13: Modernize realtime sync internals
14. PR 14: Ratchet maintainability gates continuously

## Suggested First Batch

If starting immediately, do these first:

1. PR 1
2. PR 2
3. PR 3

That batch has the best balance of code deletion, alignment with recent work, and manageable regression risk.
