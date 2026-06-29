/**
 * Album search (desktop).
 *
 * Header search box that finds albums across ALL of the current user's lists
 * (backend: GET /api/search/albums) and, on selection, switches to the list
 * containing the match and scrolls/flashes that album into view.
 *
 * This module owns the search execution (debounce + AbortController + a
 * sequence guard) and the delegated event wiring, and composes three focused
 * pieces:
 *   - createResultsPanel   — the body-mounted results dropdown.
 *   - createOptionsPopover — the body-mounted field-options popover.
 *   - createAlbumFlash     — the rebuild-resilient jump-to-album highlight.
 *
 * Input handling is DELEGATED from document (not bound to the input element)
 * because selectList() re-renders the header; the dropdown and popover are
 * mounted on <body> so a header re-render never destroys them.
 */

import { createResultsPanel } from './album-search-results.js';
import { createOptionsPopover } from './album-search-options.js';
import { createAlbumFlash } from './album-search-flash.js';

const DEBOUNCE_MS = 220;
const MIN_CHARS = 2;
const RESULT_LIMIT = 25;

export function createAlbumSearch(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  const storage =
    deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const logger = deps.logger || console;
  const { apiCall, selectList, getListData } = deps;

  if (!doc || !win || typeof apiCall !== 'function') {
    return { initialize() {} };
  }

  let debounceTimer = null;
  let abortController = null;
  let requestSeq = 0;
  let lastQuery = '';
  let repositionScheduled = false;

  const flash = createAlbumFlash({ doc, win, getListData });
  const panel = createResultsPanel({ doc, onSelect: selectResult });
  const options = createOptionsPopover({
    doc,
    storage,
    onChange: rerunCurrentQuery,
  });

  function getInput() {
    return doc.getElementById('albumSearchInput');
  }

  function toggleClearButton(visible) {
    const clearBtn = doc.getElementById('albumSearchClear');
    if (clearBtn) clearBtn.classList.toggle('hidden', !visible);
  }

  // ---- search execution -----------------------------------------------------

  function onInputChange(value) {
    clearTimeout(debounceTimer);
    const query = value.trim();
    toggleClearButton(value.length > 0);

    if (query.length < MIN_CHARS) {
      lastQuery = '';
      cancelInflight();
      panel.close();
      return;
    }

    debounceTimer = setTimeout(() => runSearch(query), DEBOUNCE_MS);
  }

  function cancelInflight() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  async function runSearch(query) {
    lastQuery = query;
    cancelInflight();
    abortController = new AbortController();
    const seq = ++requestSeq;

    const params = new URLSearchParams({
      q: query,
      limit: String(RESULT_LIMIT),
    });
    const fields = options.getFields();
    if (fields.length > 0) {
      params.set('fields', fields.join(','));
    }

    try {
      const data = await apiCall(`/api/search/albums?${params.toString()}`, {
        signal: abortController.signal,
      });
      if (seq !== requestSeq) return; // a newer search superseded this one
      panel.render(data, query);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (seq !== requestSeq) return;
      logger.warn('Album search failed:', error);
      panel.renderMessage('Search is unavailable right now. Please try again.');
    }
  }

  function rerunCurrentQuery() {
    const input = getInput();
    const query = (input?.value || '').trim();
    if (query.length >= MIN_CHARS) runSearch(query);
  }

  function clearSearch() {
    const input = getInput();
    if (input) {
      input.value = '';
      input.focus();
    }
    toggleClearButton(false);
    lastQuery = '';
    clearTimeout(debounceTimer);
    debounceTimer = null;
    cancelInflight();
    panel.close();
  }

  // ---- selecting a result ---------------------------------------------------

  async function selectResult(result) {
    if (!result) return;

    panel.close();
    const input = getInput();
    if (input) input.blur();

    if (typeof selectList === 'function') {
      try {
        await selectList(result.listId);
      } catch (error) {
        // The list never switched, so the matched row isn't on screen — don't
        // chase a row that doesn't exist (it could even flash the wrong album
        // if the same album also sits in the still-displayed list).
        logger.warn('Failed to open list from search:', error);
        return;
      }
    }

    flash.flash(result.listId, result.albumId);
  }

  // ---- repositioning on scroll / resize ------------------------------------

  function scheduleReposition() {
    if (repositionScheduled) return;
    if (!panel.isOpen() && !options.isOpen()) return;
    repositionScheduled = true;
    win.requestAnimationFrame(() => {
      repositionScheduled = false;
      if (panel.isOpen()) panel.reposition();
      if (options.isOpen()) options.reposition();
    });
  }

  // ---- global (delegated) event wiring -------------------------------------

  function handleInput(event) {
    if (event.target?.id !== 'albumSearchInput') return;
    onInputChange(event.target.value || '');
  }

  function handleKeydown(event) {
    if (event.target?.id !== 'albumSearchInput') return;
    switch (event.key) {
      case 'ArrowDown':
        if (panel.isOpen()) {
          event.preventDefault();
          panel.moveActive(1);
        } else if (lastQuery) {
          runSearch(lastQuery);
        }
        break;
      case 'ArrowUp':
        if (panel.isOpen()) {
          event.preventDefault();
          panel.moveActive(-1);
        }
        break;
      case 'Enter':
        if (panel.isOpen() && panel.count() > 0) {
          event.preventDefault();
          panel.selectActive();
        }
        break;
      case 'Escape':
        if (panel.isOpen()) {
          event.preventDefault();
          panel.close();
        } else if (options.isOpen()) {
          event.preventDefault();
          options.close();
        }
        break;
      default:
        break;
    }
  }

  function handleClick(event) {
    const target = event.target;

    // Toggle the field-options popover.
    if (target.closest('#albumSearchOptionsBtn')) {
      event.preventDefault();
      options.toggle();
      return;
    }

    // Clear the query.
    if (target.closest('#albumSearchClear')) {
      event.preventDefault();
      clearSearch();
      return;
    }

    // Select a result row.
    if (panel.handleClick(target)) return;

    // Clicks inside the search box or its surfaces should not dismiss them.
    if (
      target.closest('#albumSearchContainer') ||
      panel.contains(target) ||
      options.contains(target)
    ) {
      return;
    }

    // Outside click: dismiss any open surface.
    if (panel.isOpen()) panel.close();
    if (options.isOpen()) options.close();
  }

  function handleChange(event) {
    options.handleChange(event.target);
  }

  function initialize() {
    doc.addEventListener('input', handleInput);
    doc.addEventListener('keydown', handleKeydown);
    doc.addEventListener('click', handleClick);
    doc.addEventListener('change', handleChange);
    win.addEventListener('resize', scheduleReposition);
    // Capture phase so scrolling in any nested container repositions the panel.
    win.addEventListener('scroll', scheduleReposition, true);
  }

  return { initialize };
}
