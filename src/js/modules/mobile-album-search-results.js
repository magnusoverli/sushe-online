/**
 * Mobile album-search results surface.
 *
 * A body-mounted, full-width panel that fills the screen BELOW the morphed
 * header search bar. It reuses the shared `.album-search-result` row markup so
 * results look identical to the desktop dropdown; only the container differs
 * (full-width sheet vs. an input-anchored popover). Selection is reported back
 * through onSelect; the controller owns all event wiring.
 */

import {
  resultRowHtml,
  emptyMessageHtml,
  truncatedHintHtml,
  messageHtml,
} from './album-search-render.js';
import { afterFrame } from './dom-timing.js';
import {
  MOBILE_ALBUM_SEARCH_RESULT_ID_PREFIX,
  MOBILE_ALBUM_SEARCH_TIMING,
} from './mobile-album-search-constants.js';

export function createMobileResults(deps = {}) {
  const { doc, win, onSelect, onUserScroll } = deps;
  let el = null;
  let results = [];
  let renderedQuery = '';
  let closeTimer = null;
  let transitionSequence = 0;

  function clearCloseTimer() {
    if (!closeTimer) return;
    (win?.clearTimeout || clearTimeout)(closeTimer);
    closeTimer = null;
  }

  // Keep the combobox input's popup state truthful (mirrors the desktop
  // dropdown's setExpanded).
  function setExpanded(expanded) {
    doc
      .getElementById('mobileAlbumSearchInput')
      ?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function ensureEl() {
    if (el) return el;
    el = doc.createElement('div');
    el.id = 'mobileAlbumSearchResults';
    el.setAttribute('role', 'listbox');
    el.className = 'album-search-mobile-panel hidden';
    if (typeof onUserScroll === 'function') {
      el.addEventListener('touchmove', onUserScroll, { passive: true });
      el.addEventListener('wheel', onUserScroll, { passive: true });
    }
    doc.body.appendChild(el);
    return el;
  }

  /**
   * Pin the panel from the bottom edge of the morphed header bar to the bottom
   * of the screen. Keyboard avoidance is padding inside the sheet, not a shorter
   * sheet, so the album list never shines through below the search surface.
   */
  function position(top, keyboardInset = 0) {
    const panel = ensureEl();
    panel.style.top = `${Math.round(top)}px`;
    panel.style.bottom = '0';
    panel.style.height = '';
    panel.style.setProperty(
      '--album-search-mobile-keyboard-inset',
      `${Math.round(Math.max(0, keyboardInset))}px`
    );
  }

  function open() {
    const panel = ensureEl();
    const sequence = ++transitionSequence;
    clearCloseTimer();
    panel.classList.remove('hidden');
    setExpanded(true);
    afterFrame(win, () => {
      if (sequence !== transitionSequence) return;
      panel.classList.add('is-open');
    });
  }

  function close(options = {}) {
    if (!el) return;
    const sequence = ++transitionSequence;
    clearCloseTimer();
    setExpanded(false);
    el.classList.remove('is-open');
    if (options.immediate === true) {
      el.classList.add('hidden');
      return;
    }
    closeTimer = (win?.setTimeout || setTimeout)(() => {
      if (
        sequence === transitionSequence &&
        !el?.classList.contains('is-open')
      ) {
        el?.classList.add('hidden');
      }
      closeTimer = null;
    }, MOBILE_ALBUM_SEARCH_TIMING.resultsTransitionMs);
  }

  function isOpen() {
    return !!el && !el.classList.contains('hidden');
  }

  /** The resting state before a query is typed. */
  function renderIdle() {
    results = [];
    renderedQuery = '';
    ensureEl().innerHTML = `
      <div class="album-search-mobile-idle">
        <i class="fas fa-search" aria-hidden="true"></i>
        <p>Search albums across all your lists.</p>
      </div>`;
    open();
  }

  function render(data, query) {
    results = Array.isArray(data?.results) ? data.results : [];
    renderedQuery = String(query || '').trim();
    const panel = ensureEl();
    if (results.length === 0) {
      panel.innerHTML = emptyMessageHtml(query);
    } else {
      const rows = results
        .map((result, index) =>
          resultRowHtml(result, index, {
            idPrefix: MOBILE_ALBUM_SEARCH_RESULT_ID_PREFIX,
          })
        )
        .join('');
      const hint = data.truncated ? truncatedHintHtml(results.length) : '';
      panel.innerHTML = rows + hint;
    }
    panel.scrollTop = 0;
    open();
  }

  function renderMessage(message) {
    renderedQuery = '';
    ensureEl().innerHTML = messageHtml(message);
    results = [];
    open();
  }

  // Returns true if the tap hit a result row (and selection was reported).
  function handleClick(target) {
    const row = target.closest?.('.album-search-result');
    if (row && el?.contains(row)) {
      const index = Number.parseInt(row.getAttribute('data-result-index'), 10);
      if (Number.isInteger(index) && results[index]) onSelect(results[index]);
      return true;
    }
    return false;
  }

  function contains(node) {
    return !!el && el.contains(node);
  }

  function hasRenderedQuery(query) {
    return !!el && renderedQuery === String(query || '').trim();
  }

  return {
    render,
    renderIdle,
    renderMessage,
    open,
    close,
    isOpen,
    position,
    handleClick,
    contains,
    hasRenderedQuery,
  };
}
