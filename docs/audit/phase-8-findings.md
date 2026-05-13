# Phase 8 — Dead CSS / Tailwind — Findings

Scope: Tailwind `safelist` entries in `tailwind.config.js` (127 explicit class names) and custom rules/classes in `src/styles/input.css` (2,722 lines of authored CSS). Verified against Tailwind content-scan paths from Phase 0 (`./index.js`, `./views/**`, `./public/**/*.html`, `./public/**/*.js`, `./src/**`, `./templates.js`) plus `templates/**/*.js` (not in scan but referenced by templates.js facade) and `routes/**/*.js`.

The build output `public/styles/output.css` is excluded from "alive" judgement (it is the Tailwind-emitted artifact for the very classes under review). `public/styles/app.css` is an authored static stylesheet that defines its own rules but is **not** in Tailwind's content scan — references inside it cannot keep a class alive unless something in HTML/JS adds the class to an element.

Note: SortableJS auto-applies `.sortable-chosen`, `.sortable-ghost`, `.sortable-drag`, `.sortable-fallback`, `.sortable-delay` to elements when `forceFallback: true` is set (confirmed in `src/js/modules/list-nav.js:884,959` and `src/js/modules/sorting.js:114`). All five `@utility` rules with those names are alive via library behavior — **not flagged**.

---

## Summary

- Safelist entries audited: 127
- Custom classes in `input.css` audited: ~80
- Candidates identified: 9
- CERTAIN: 1
- HIGH: 6
- MEDIUM: 1
- LOW: 1

All findings are class definitions / safelist entries that emit utility CSS but have **zero applied usage** in current code. Removing any of them is a CSS-bundle-size win only; runtime behavior is unaffected by definition. Each finding is gated on the same risk: the class could be added by something I did not scan (an unmounted route handler, a future feature flag, externally embedded HTML). For that reason the high-confidence bar is only reached when the surrounding code or comments themselves declare the class as legacy / removed.

---

## Findings

### F-8-1 — Safelist entry `drag-active`

- **Location**: `tailwind.config.js:22`
- **Type**: Stale safelist entry (no consumer)
- **Confidence**: CERTAIN
- **Evidence**:
  - Grep `drag-active` across the repo (excluding `public/styles/output.css`): **1 match**, on line 22 of `tailwind.config.js` itself (the safelist entry).
  - No `classList.add('drag-active')`, no `class="...drag-active..."`, no `'drag-active'` literal in any `.js` / `.ejs` / `.html`.
  - No `drag-` prefix construction (`'drag-' + foo`) anywhere.
  - Sibling drag-related classes that ARE alive: `dragging-mobile`, `desktop-dragging`, `sidebar-dragging`, `sidebar-list-dragging`, `drop-target`-via-changelog-only. None contain `drag-active` as a substring.
  - SortableJS auto-classes are `sortable-chosen`/`sortable-ghost`/`sortable-drag`/`sortable-fallback` — none collide with `drag-active`.
- **FP-trap considered**: Could it be applied by a third-party library? SortableJS does not emit `drag-active`. No other DnD library is wired in (verified via `package.json` deps: only `sortablejs` in vendor chunk).
- **Removal impact**: Drops the `drag-active` utility from `public/styles/output.css`. No HTML/JS adds the class, so no DOM rule ever fires.
- **Recommendation**: Remove from safelist.
- **Verification step for human reviewer**: Confirm no in-progress drag-and-drop feature in flight that would imminently reintroduce the class.

---

### F-8-2 — Safelist entry `dragging`

- **Location**: `tailwind.config.js:21`
- **Type**: Stale safelist entry (superseded)
- **Confidence**: HIGH
- **Evidence**:
  - Grep `\bdragging\b` (word-bounded): all literal-string applications are `dragging-mobile`, `desktop-dragging`, `sidebar-dragging`, `sidebar-list-dragging` — never the bare token `dragging`.
  - The only `'dragging'` literal in the codebase is the safelist line itself.
  - Comment in changelog and recent commits refer to "drag and drop" generically; no class string `dragging` (alone) is added by any handler.
- **FP-trap considered**: Could `dragging` be the parent class name added by SortableJS? No — SortableJS uses `sortable-*` prefixes. Could it be added by `document.body.classList.add('dragging')`? Searched — found only `desktop-dragging` and the prefixed variants.
- **Removal impact**: None at runtime. The utility class definition is generated but no element wears it.
- **Recommendation**: Remove from safelist. Downgrade to HIGH because `dragging` is a short, common token that a future feature might use; safelist removal is reversible.
- **Verification step for human reviewer**: Confirm in `src/js/modules/sorting.js` and `list-nav.js` that the drag UX uses the `*-mobile` / `*-dragging` variants only.

---

### F-8-3 — Safelist entry `lg:grid-cols-4`

- **Location**: `tailwind.config.js:54`
- **Type**: Stale safelist entry (no consumer)
- **Confidence**: HIGH
- **Evidence**:
  - Grep `lg:grid-cols-4` across all scanned content paths: **1 match**, the safelist entry itself.
  - Codebase uses `lg:grid-cols-1`, `lg:grid-cols-2`, and `sm:grid-cols-3`, `sm:grid-cols-4` extensively — never `lg:grid-cols-4`.
  - No dynamic `grid-cols-${n}` or `'grid-cols-' + n` construction in any `.js` file.
- **FP-trap considered**: Could it be in an EJS template that the grep missed? Re-checked `views/**` and `templates/**` — none.
- **Removal impact**: Drops a single Tailwind utility from the bundle. No layout breaks because no element uses the modifier.
- **Recommendation**: Remove from safelist.
- **Verification step for human reviewer**: Confirm no planned 4-column LG layout in roadmap.

---

### F-8-4 — Safelist entry `group-hover:scale-105`

- **Location**: `tailwind.config.js:151`
- **Type**: Stale safelist entry (no consumer)
- **Confidence**: HIGH
- **Evidence**:
  - Grep `group-hover:scale-105`: 1 match — the safelist entry.
  - Other `group-hover:*` modifiers in active use: `group-hover:text-red-500` (3 occurrences in `templates/spotify-components.js`), `group-hover:text-white` (`src/js/modules/list-setup-wizard.js:133`), `group-hover:opacity-100` (4 occurrences in `src/js/modules/settings-drawer/renderers/preferences-renderer.js`). None scale.
  - The base `scale-105` safelist entry is itself used by `.btn-submit` `@apply` (`input.css:496`) — but that's the non-group-hover variant. `transform hover:scale-105` is widely used; the *group-hover* variant is not.
- **FP-trap considered**: Could it be string-built? Searched `scale-` prefix construction — none.
- **Removal impact**: Drops one utility. Hover scale on grouped children continues to work via `hover:scale-105` (the non-group version).
- **Recommendation**: Remove from safelist.
- **Verification step for human reviewer**: Confirm none of the new card components in `preferences-renderer.js` etc. are expected to grow a scale-on-group-hover effect.

---

### F-8-5 — Safelist entry `focus:border-red-600`

- **Location**: `tailwind.config.js:158`
- **Type**: Stale safelist entry (no consumer)
- **Confidence**: HIGH
- **Evidence**:
  - Grep `focus:border-red-600`: 1 match — the safelist entry.
  - Every form input in the codebase uses `focus:border-gray-500` (input.css form-input rule + 15+ literal occurrences in `templates/spotify-components.js`, `src/js/modules/list-crud.js`, `src/js/modules/editable-fields.js`). None use `focus:border-red-600`.
- **FP-trap considered**: Could a future "danger input" use it? Currently no `border-red-600` focus pattern exists; the convention is gray focus borders.
- **Removal impact**: None.
- **Recommendation**: Remove from safelist.
- **Verification step for human reviewer**: Confirm the design system does not call for a red focus border on validation-error fields.

---

### F-8-6 — `.summary-badge.wikipedia-badge i` rule (and the implied `.wikipedia-badge` class)

- **Location**: `src/styles/input.css:2726` (rule body 2725–2728)
- **Type**: Dead rule — class never applied
- **Confidence**: HIGH
- **Evidence**:
  - Grep `wikipedia-badge` across whole repo (excluding `output.css`): **1 match**, the input.css rule itself.
  - `src/js/modules/album-display.js:284,289,2418` show the badge class is hardcoded to `'claude-badge'`. No code path emits `wikipedia-badge`.
  - Migration `db/migrations/migrations/028_add_claude_summary_source.js` and `029_remove_legacy_summary_columns.js` document the transition: "Existing summaries with 'lastfm' or 'wikipedia' sources will remain until regenerated." Migration 029 dropped the `wikipedia_url` column.
  - Comment in `album-display.js:284`: `// All summaries now use Claude badge (even if originally from Last.fm/Wikipedia)`.
- **FP-trap considered**: Could a row in the DB still flag `summary_source = 'wikipedia'` and trigger this badge class? The JS hardcodes `claude-badge` regardless of source — so even rows with legacy `summary_source` values never render `wikipedia-badge`.
- **Removal impact**: Drops the orange dot color for any element that wore `.wikipedia-badge`. Nothing does.
- **Recommendation**: Remove the rule. Treat as part of the broader Last.fm/Wikipedia legacy-summary cleanup (see F-8-7).
- **Verification step for human reviewer**: Confirm Phase 4 won't restore the Wikipedia source. If the column 029 migration is fully landed in prod, the badge class is truly orphaned.

---

### F-8-7 — Legacy `.lastfm-badge` / `.lastfm-tooltip*` rules

- **Location**: `src/styles/input.css:2721` (one selector inside summary-badge cascade), plus the dedicated legacy block at **2989–3095** (9 selectors: `.lastfm-badge`, `.lastfm-badge i`, `.lastfm-badge:hover`, `.lastfm-tooltip`, `.lastfm-tooltip.visible`, `.lastfm-tooltip-header`, `.lastfm-tooltip-header i`, `.lastfm-tooltip-header span`, `.lastfm-tooltip-content`, `.lastfm-tooltip-footer`, `.lastfm-tooltip-link`, `.lastfm-tooltip-link:hover`, `.lastfm-tooltip-link i`).
- **Type**: Dead rules — comment self-identifies as legacy aliases
- **Confidence**: HIGH
- **Evidence**:
  - Comment immediately above the block (input.css:2989): `/* Legacy class aliases for backwards compatibility */` — author-declared legacy intent.
  - Grep `lastfm-badge` and `lastfm-tooltip` across whole repo (excluding `output.css`): **0 matches outside `input.css`**.
  - Same Last.fm/Wikipedia → Claude migration history as F-8-6: `badgeClass` and `tooltipClass` are hardcoded to claude variants in `album-display.js`.
- **FP-trap considered**: "Backwards compatibility" could mean external embedded HTML. But this is a server-rendered app with no public iframe surface that injects user HTML with these classes. The browser-extension renders RYM pages, not its own DOM with `lastfm-tooltip`. Verified: `lastfm-badge`/`lastfm-tooltip` strings appear in zero JS/EJS/HTML in `browser-extension/`.
- **Removal impact**: Drops ~9 rules + ~50 LOC from `input.css`. No DOM element wears these classes today.
- **Recommendation**: Remove the entire block 2989–3095. Also remove the `.summary-badge.lastfm-badge i { color: #d51007; }` selector on line 2721.
- **Verification step for human reviewer**: Confirm no internal admin/devtools panel embeds these class names. Quick grep for `lastfm` in `routes/admin/` shows only API/auth/telegram code paths — no rendering of those classes.

---

### F-8-8 — Dead `.preferences-*` rules (5 selectors)

- **Location**: `src/styles/input.css:2280–2340` (`.preferences-ranked-item`, `.preferences-ranked-item:hover`, `.preferences-rank`, `.preferences-item-name`, `.preferences-source-icons`, `.preferences-ranked-item:hover .preferences-source-icons`, `.preferences-country-progress`, `.preferences-country-progress-fill`).
- **Type**: Dead rules — superseded preferences-renderer markup
- **Confidence**: HIGH
- **Evidence**:
  - Grep across whole repo (excluding `output.css`): all six class names appear **only in `input.css`**.
  - The only `preferences-*` class that IS used is `.preferences-stat-card` (`src/js/modules/settings-drawer/renderers/core-renderers.js:342,349,356,363,370`). That one is alive — left untouched by this finding.
  - Active preferences renderer (`settings-drawer/renderers/preferences-renderer.js`) builds its own markup with `flex gap-1.5 opacity-60 group-hover:opacity-100` etc. — no `preferences-rank` / `preferences-ranked-item` / `preferences-source-icons`.
- **FP-trap considered**: Could these be injected by the server side rendering a preferences page? Searched `routes/preferences/**` and `services/preferences/**` — no class string matches.
- **Removal impact**: ~60 lines of CSS gone. No visual change because the renderer that used these classes was replaced.
- **Recommendation**: Remove the 8 dead `.preferences-*` selectors. Keep `.preferences-stat-card`.
- **Verification step for human reviewer**: Manually open the Settings drawer "Preferences" pane in a running instance and confirm the ranked-list visuals match the new renderer output (`preferences-renderer.js:140–260`), not the old `.preferences-ranked-item` markup.

---

### F-8-9 — `.settings-textarea` rule applies to non-existent class

- **Location**: `src/styles/input.css:2365` (inside the `@media (max-width: 1023px)` block at 2363–2368, alongside `.settings-input` and `.settings-select`)
- **Type**: Dead class in rule selector list
- **Confidence**: MEDIUM
- **Evidence**:
  - Grep `settings-textarea` across whole repo (excluding `output.css`): **1 match**, the input.css rule itself.
  - The sibling classes `.settings-input` and `.settings-select` ARE alive (many JS references). Only `.settings-textarea` is orphaned.
- **FP-trap considered**: Could a future settings-row pattern need it? Plausible — it's a natural extension of the settings input system. The rule is bundled into a 3-class selector list, so removing just this name (not the rule) has minimal CSS-size impact.
- **Removal impact**: Removing the class name from the selector list (`.settings-input, .settings-select, .settings-textarea`) shrinks the matching set by one class that never matches anyway.
- **Recommendation**: Investigate further before removing. The cleanup gain is tiny; the risk is that a planned settings-textarea component (multi-line comment editor?) is on the roadmap. Magnus to confirm.
- **Verification step for human reviewer**: Decide whether the design system intends to support textareas in the settings drawer (none today). If no, drop the name from the selector list.

---

### F-8-10 — `.miniplayer-progress.seeking #miniplayerProgressFill` rule never fires

- **Location**: `src/styles/input.css:1446–1448`
- **Type**: Conditional rule whose trigger class is never set
- **Confidence**: LOW
- **Evidence**:
  - Grep for `classList.(add|remove|toggle)\(['"]seeking` and `class="[^"]*seeking` across the codebase: **zero matches** (any `seeking` literal applied to an element).
  - `src/js/modules/spotify-player.js:1160` mentions seeking in a comment only.
  - `#miniplayerProgressFill` already has `transition: none;` on the base rule (input.css:1442). The `.seeking` override sets the same property to the same value.
- **FP-trap considered**: Could a future drag-the-scrubber feature add `.seeking`? Plausible — this looks like infrastructure for a half-built seek interaction. Comment at line 1396 of spotify-player.js says "Progress bar seeking (native input range)" — suggesting the seek behavior was implemented but uses the native `input[type=range]` rather than the `.seeking` class.
- **Removal impact**: None at runtime (rule is a no-op even if `.seeking` were applied, since it sets transition to the value the base rule already enforces).
- **Recommendation**: Preserve (do not remove). The rule is harmless and may be revived if seeking gets a custom drag affordance. LOW confidence in deadness — could become alive on a UI tweak.
- **Verification step for human reviewer**: None required; status-quo.

---

## Cross-cutting notes

- **No Tailwind utility safelist entry triggered a CERTAIN finding** beyond `drag-active` because every other suspicious entry has at least one plausible reason to be preserved (`group-hover:scale-105`, `lg:grid-cols-4`, `focus:border-red-600`, `dragging` are all reachable via a small JS change). Magnus's call on each.
- **`public/styles/app.css`** is not in the Tailwind content scan but defines authored rules (`.metal-title`, `.glow-red`, `.album-grid`, `.album-header`, `.recommendations-btn` etc.). These rules co-exist with `input.css` and tailwind safelist; removing a tailwind safelist entry does not affect the authored rule of the same name in `app.css`. Worth noting for Magnus when reviewing F-8-x removals.
- **`src/data/changelog.json`** contains historical commit messages mentioning removed classes (`drop-target`, etc.). These do not keep classes alive. Treat them as documentation of past removals, not current usage.
- **No `@apply` directive** in `input.css` applies a utility that I could not verify exists. The `@apply cursor-grabbing`, `@apply opacity-80`, `@apply w-full px-4 py-3 bg-gray-800 ...` directives all reference utilities Tailwind v4 emits unconditionally (no safelist needed for them).
- **The `@utility sortable-*` blocks (5 of them) are all alive via SortableJS** — false-positive trap noted explicitly in the prompt, confirmed avoided.

---

## Recommended removal order (if approved)

1. F-8-6 + F-8-7 together: legacy summary badge/tooltip block — single atomic commit removes ~60 LOC of CSS that has self-documented "legacy" comments.
2. F-8-8: dead `.preferences-*` rules — single commit, low risk because the active renderer's markup is well-isolated.
3. F-8-1 through F-8-5: safelist hygiene — one commit per entry, or all five batched (they're trivially reversible).
4. F-8-9: only after confirming no planned settings-textarea component.
5. F-8-10: no action.
