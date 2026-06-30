/**
 * Mobile cross-list album search.
 *
 * Tapping the header search icon MORPHS the mobile header into a full-width
 * search bar (#mobileAlbumSearchBar, which covers the header) and opens a
 * full-screen results panel below it. On selecting a result it switches to the
 * matched list and flashes/scrolls the album into view — the same outcome as
 * the desktop header search.
 *
 * It shares the search-execution core, the field store, the result-row markup,
 * and the jump-to-album flash with the desktop implementation; only the surface
 * differs. Events are delegated from `document` and the results panel is mounted
 * on <body>, so neither a header tweak nor an album-list rebuild can tear them
 * out from under us.
 */

import { createSearchRunner } from './album-search-core.js';
import { createAlbumFlash } from './album-search-flash.js';
import { createMobileResults } from './mobile-album-search-results.js';
import { createActionSheet } from './ui-factories.js';
import {
  OPTIONAL_FIELDS,
  loadFields,
  saveFields,
} from './album-search-fields.js';
import { escapeHtml } from './html-utils.js';

const SEARCH_UNAVAILABLE = 'Search is unavailable right now. Please try again.';

export function createMobileAlbumSearch(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  const storage =
    deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const logger = deps.logger || console;
  const { apiCall, selectList, getListData } = deps;

  if (!doc || !win || typeof apiCall !== 'function') {
    return { initialize() {} };
  }

  let open = false;
  let fabPrevDisplay = null;
  let repositionScheduled = false;
  let filterSheet = null;
  let selectedFields = loadFields(storage);

  const flash = createAlbumFlash({ doc, win, getListData });
  const results = createMobileResults({ doc, onSelect: selectResult });
  const runner = createSearchRunner({
    apiCall,
    getFields: () => selectedFields,
    onResults: (data, query) => results.render(data, query),
    onError: () => results.renderMessage(SEARCH_UNAVAILABLE),
    onCleared: () => results.renderIdle(),
    logger,
  });

  const bar = () => doc.getElementById('mobileAlbumSearchBar');
  const input = () => doc.getElementById('mobileAlbumSearchInput');

  function toggleClear(visible) {
    const btn = doc.getElementById('mobileAlbumSearchClear');
    if (btn) btn.classList.toggle('hidden', !visible);
  }

  // ---- FAB visibility (capture/restore exactly, like the mobile sheets) -----

  function hideFab() {
    const fab = doc.getElementById('addAlbumFAB');
    if (!fab) return;
    fabPrevDisplay = fab.style.display;
    fab.style.display = 'none';
  }

  function restoreFab() {
    const fab = doc.getElementById('addAlbumFAB');
    if (!fab) return;
    fab.style.display = fabPrevDisplay || '';
    fabPrevDisplay = null;
  }

  // ---- open / close (header morph) -----------------------------------------

  function positionResults() {
    const b = bar();
    if (!b) return;
    const top = b.getBoundingClientRect().bottom;
    // Size the panel to the VISUAL viewport so its content stays above the
    // on-screen keyboard rather than extending behind it.
    const vv = win.visualViewport;
    const visibleBottom = vv ? vv.offsetTop + vv.height : win.innerHeight;
    results.position(top, Math.max(0, visibleBottom - top));
  }

  function openSearch() {
    if (open) return;
    const b = bar();
    if (!b) return;
    open = true;

    b.classList.remove('hidden');
    b.classList.add('flex');
    doc.body.style.overflow = 'hidden';
    hideFab();
    // The search is a modal surface: keep the list behind the panel out of the
    // tab order / accessibility tree while it's open.
    doc.getElementById('albumContainer')?.setAttribute('inert', '');

    results.renderIdle();
    positionResults();
    results.open();

    const el = input();
    if (el) {
      el.value = '';
      toggleClear(false);
      // Focus synchronously, inside the tap gesture, so the mobile keyboard
      // opens immediately — a deferred focus() is ignored by iOS Safari.
      // preventScroll stops iOS from scrolling the document toward the
      // (already-visible) input.
      el.focus({ preventScroll: true });
    }
  }

  function closeSearch(restoreFocus = true) {
    if (!open) return;
    open = false;

    filterSheet?.close();
    const b = bar();
    if (b) {
      b.classList.add('hidden');
      b.classList.remove('flex');
    }
    const el = input();
    if (el) {
      el.value = '';
      el.blur();
    }
    toggleClear(false);
    runner.reset();
    results.close();
    doc.getElementById('albumContainer')?.removeAttribute('inert');
    doc.body.style.overflow = '';
    // Reset any iOS keyboard-induced document scroll — the fixed layout assumes
    // the window stays at the top (matches the mobile edit modal's close).
    win.scrollTo(0, 0);
    doc.body.scrollTop = 0;
    restoreFab();
    // Return focus to the trigger so keyboard / screen-reader users keep their
    // place; skipped when a result was chosen (the list switch takes focus).
    if (restoreFocus) doc.getElementById('mobileAlbumSearchBtn')?.focus();
  }

  function clearInput() {
    const el = input();
    if (el) {
      el.value = '';
      el.focus();
    }
    toggleClear(false);
    runner.reset();
    results.renderIdle();
  }

  // ---- selecting a result ---------------------------------------------------

  async function selectResult(result) {
    if (!result) return;
    closeSearch(false);

    if (typeof selectList === 'function') {
      try {
        await selectList(result.listId);
      } catch (error) {
        // The list never switched, so the matched row isn't on screen — don't
        // chase a row that doesn't exist.
        logger.warn('Failed to open list from mobile search:', error);
        return;
      }
    }
    // Re-pin the window after the async list switch (the keyboard may have
    // dismissed mid-flight and left the document scrolled); the flash then
    // scrolls only #albumContainer, so the header stays put.
    win.scrollTo(0, 0);
    flash.flash(result.listId, result.albumId);
  }

  // ---- field filter sheet ---------------------------------------------------

  function openFilterSheet() {
    const rows = OPTIONAL_FIELDS.map(
      (field) => `
      <label class="flex items-center justify-between gap-3 py-3 px-1 border-b border-gray-800 text-gray-200">
        <span>${escapeHtml(field.label)}</span>
        <input type="checkbox" data-mobile-search-field="${field.key}" ${
          selectedFields.includes(field.key) ? 'checked' : ''
        } class="w-5 h-5 accent-red-600" />
      </label>`
    ).join('');

    const contentHtml = `
      <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">Search in</h3>
      <div class="flex items-center gap-2 py-3 px-1 border-b border-gray-800 text-gray-400">
        <i class="fas fa-check text-red-600"></i><span>Artist &amp; album title</span>
      </div>
      ${rows}
      <button type="button" data-action="cancel" class="mt-4 w-full py-3 rounded-lg bg-gray-800 text-gray-200 font-medium touch-target">Done</button>`;

    filterSheet = createActionSheet({
      contentHtml,
      zIndex: '60',
      lgHidden: false,
      hideFAB: false,
      restoreFAB: false,
      onClose: () => {
        filterSheet = null;
      },
    });

    filterSheet.sheet.addEventListener('change', (event) => {
      const target = event.target;
      if (!target?.matches?.('input[data-mobile-search-field]')) return;
      const key = target.getAttribute('data-mobile-search-field');
      if (target.checked) {
        if (!selectedFields.includes(key)) selectedFields.push(key);
      } else {
        selectedFields = selectedFields.filter((field) => field !== key);
      }
      saveFields(storage, selectedFields);
      runner.rerun();
    });
  }

  // ---- delegated event wiring ----------------------------------------------

  function handleInput(event) {
    if (event.target?.id !== 'mobileAlbumSearchInput') return;
    const value = event.target.value || '';
    toggleClear(value.length > 0);
    runner.schedule(value);
  }

  function handleClick(event) {
    // The trigger button opens via its inline onclick (window.openMobileAlbumSearch),
    // matching the header's other buttons; everything else is delegated here and
    // only relevant while the search is open.
    if (!open) return;
    const target = event.target;
    if (target.closest?.('#mobileAlbumSearchBack')) {
      event.preventDefault();
      closeSearch();
      return;
    }
    if (target.closest?.('#mobileAlbumSearchClear')) {
      event.preventDefault();
      clearInput();
      return;
    }
    if (target.closest?.('#mobileAlbumSearchOptionsBtn')) {
      event.preventDefault();
      openFilterSheet();
      return;
    }
    results.handleClick(target);
  }

  function handleKeydown(event) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
    }
  }

  function scheduleReposition() {
    if (!open || repositionScheduled) return;
    repositionScheduled = true;
    win.requestAnimationFrame(() => {
      repositionScheduled = false;
      if (open) positionResults();
    });
  }

  function initialize() {
    // Expose the opener for the header's inline onclick (mirrors the About /
    // Settings buttons, which call window.* handlers).
    win.openMobileAlbumSearch = openSearch;

    doc.addEventListener('input', handleInput);
    doc.addEventListener('click', handleClick);
    doc.addEventListener('keydown', handleKeydown);
    win.addEventListener('resize', scheduleReposition);
    win.visualViewport?.addEventListener('resize', scheduleReposition);
  }

  return { initialize, open: openSearch, close: closeSearch };
}
