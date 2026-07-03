/**
 * Mobile cross-list album search.
 *
 * Tapping the header search icon puts the mobile header into search mode: the
 * normal controls collapse and #mobileAlbumSearchBar takes over the row. It opens a
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

import {
  createSearchRunner,
  shouldSwitchToSearchResultList,
} from './album-search-core.js';
import { createAlbumFlash } from './album-search-flash.js';
import { createMobileResults } from './mobile-album-search-results.js';
import { createActionSheet } from './ui-factories.js';
import {
  OPTIONAL_FIELDS,
  loadFields,
  saveFields,
} from './album-search-fields.js';
import { createMobileSearchLifecycle } from './mobile-album-search-lifecycle.js';
import { escapeHtml } from './html-utils.js';

const SEARCH_UNAVAILABLE = 'Search is unavailable right now. Please try again.';

export function createMobileAlbumSearch(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  const storage =
    deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const logger = deps.logger || console;
  const { apiCall, selectList, getCurrentListId, getListData } = deps;

  if (!doc || !win || typeof apiCall !== 'function') {
    return { initialize() {} };
  }

  let repositionScheduled = false;
  let filterSheet = null;
  let selectedFields = loadFields(storage);
  let preservedQuery = '';

  const lifecycle = createMobileSearchLifecycle({ doc, win });
  const flash = createAlbumFlash({ doc, win, getListData });
  const results = createMobileResults({
    doc,
    win,
    onSelect: selectResult,
    onUserScroll: () => lifecycle.hideKeyboardForResultScroll(results),
  });
  const runner = createSearchRunner({
    apiCall,
    getFields: () => selectedFields,
    onResults: (data, query) => results.render(data, query),
    onError: () => results.renderMessage(SEARCH_UNAVAILABLE),
    onCleared: () => results.renderIdle(),
    logger,
  });

  const input = () => lifecycle.input();

  function showCurrentQueryResults() {
    const el = input();
    const query = (el?.value || '').trim();
    lifecycle.toggleClear(query.length > 0);
    if (query.length < runner.minChars) {
      runner.reset();
      results.renderIdle();
      return;
    }
    if (results.hasRenderedQuery(query)) results.open();
    else {
      runner.run(query);
    }
  }

  function openSearch() {
    lifecycle.open({
      getPreservedQuery: () => preservedQuery,
      positionResults: () => lifecycle.positionResults(results),
      showCurrentQueryResults,
    });
  }

  function closeSearch(restoreFocus = true, options = {}) {
    const preserveQuery = options.preserveQuery === true;
    filterSheet?.close();
    return lifecycle.close({
      closeResults: (closeOptions) => results.close(closeOptions),
      clearVisuals: () => {
        const currentInput = input();
        if (currentInput) currentInput.value = '';
        lifecycle.toggleClear(false);
      },
      immediate: options.immediate,
      onClearQuery: () => {
        preservedQuery = '';
      },
      onPreserveQuery: (value) => {
        preservedQuery = value || preservedQuery;
      },
      preserveQuery,
      resetSearch: () => runner.reset(),
      restoreFocus,
    });
  }

  function clearInput() {
    const el = input();
    if (el) {
      el.value = '';
      preservedQuery = '';
      el.focus();
    }
    lifecycle.toggleClear(false);
    runner.reset();
    results.renderIdle();
  }

  // ---- selecting a result ---------------------------------------------------

  async function selectResult(result) {
    if (!result) return;
    await closeSearch(false, { preserveQuery: true });

    if (
      typeof selectList === 'function' &&
      shouldSwitchToSearchResultList(result, getCurrentListId)
    ) {
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
    // Land focus on the (freshly re-rendered) trigger — the close above ran
    // with restoreFocus=false because selectList rebuilds the header, so
    // without this AT focus would be stranded on <body>.
    doc.getElementById('mobileAlbumSearchBtn')?.focus({ preventScroll: true });
  }

  // ---- field filter sheet ---------------------------------------------------

  function openFilterSheet() {
    const rows = OPTIONAL_FIELDS.map(
      (field) => `
      <label class="flex items-center justify-between gap-3 py-3 px-1 border-b border-gray-800 text-gray-200">
        <span>${escapeHtml(field.label)}</span>
        <input type="checkbox" data-mobile-search-field="${field.key}" ${
          selectedFields.includes(field.key) ? 'checked' : ''
        } class="app-checkbox album-search-mobile-field-checkbox" />
      </label>`
    ).join('');

    const contentHtml = `
      <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">Search in</h3>
      <div class="flex items-center gap-2 py-3 px-1 border-b border-gray-800 text-gray-400">
        <i class="fas fa-check album-search-required-icon"></i><span>Artist &amp; album title</span>
      </div>
      ${rows}
      <button type="button" data-action="cancel" class="mt-4 w-full py-3 rounded-lg bg-gray-800 text-gray-200 font-medium touch-target">Done</button>`;

    filterSheet = createActionSheet({
      contentHtml,
      zIndex: '60',
      lgHidden: false,
      hideFAB: false,
      restoreFAB: false,
      // Matches the trigger's aria-haspopup="dialog" promise: role/aria-modal,
      // focus trap, and focus restore come from createModal's a11y path.
      label: 'Choose which fields to search',
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
    preservedQuery = value;
    lifecycle.toggleClear(value.length > 0);
    runner.schedule(value);
  }

  function handleClick(event) {
    // The trigger button opens via its inline onclick (window.openMobileAlbumSearch),
    // matching the header's other buttons; everything else is delegated here and
    // only relevant while the search is open.
    if (!lifecycle.isOpen()) return;
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
    if (target.closest?.('#mobileAlbumSearchInput')) {
      showCurrentQueryResults();
      return;
    }
    results.handleClick(target);
  }

  function handleKeydown(event) {
    if (!lifecycle.isOpen()) return;
    if (event.key === 'Escape') {
      // The field-options sheet is the top layer; its own controller (which
      // runs after this handler) closes just the sheet, not the whole search.
      if (filterSheet) return;
      event.preventDefault();
      closeSearch();
    }
  }

  function scheduleReposition() {
    if (!lifecycle.isOpen() || repositionScheduled) return;
    repositionScheduled = true;
    lifecycle.afterFrame(() => {
      repositionScheduled = false;
      if (lifecycle.isOpen()) lifecycle.positionResults(results);
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
    // The desktop layout hides the bar and its back button, so crossing the
    // breakpoint while open must tear search mode down — otherwise the page
    // stays scroll-locked and inert with no visible way out.
    win
      .matchMedia?.('(min-width: 1024px)')
      ?.addEventListener?.('change', (event) => {
        if (event.matches && lifecycle.isOpen()) {
          closeSearch(false, { immediate: true });
        }
      });
  }

  return { initialize, open: openSearch, close: closeSearch };
}
