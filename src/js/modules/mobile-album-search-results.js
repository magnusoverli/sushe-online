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

export function createMobileResults(deps = {}) {
  const { doc, onSelect } = deps;
  let el = null;
  let results = [];

  function ensureEl() {
    if (el) return el;
    el = doc.createElement('div');
    el.id = 'mobileAlbumSearchResults';
    el.setAttribute('role', 'listbox');
    el.className = 'album-search-mobile-panel hidden';
    doc.body.appendChild(el);
    return el;
  }

  /**
   * Pin the panel's top to the bottom edge of the morphed header bar, and
   * (when given) cap its height to the space above the keyboard.
   */
  function position(top, height) {
    const panel = ensureEl();
    panel.style.top = `${Math.round(top)}px`;
    if (typeof height === 'number') {
      panel.style.height = `${Math.round(height)}px`;
      panel.style.bottom = 'auto';
    }
  }

  function open() {
    ensureEl().classList.remove('hidden');
  }

  function close() {
    if (el) el.classList.add('hidden');
  }

  function isOpen() {
    return !!el && !el.classList.contains('hidden');
  }

  /** The resting state before a query is typed. */
  function renderIdle() {
    results = [];
    ensureEl().innerHTML = `
      <div class="album-search-mobile-idle">
        <i class="fas fa-search" aria-hidden="true"></i>
        <p>Search albums across all your lists.</p>
      </div>`;
  }

  function render(data, query) {
    results = Array.isArray(data?.results) ? data.results : [];
    const panel = ensureEl();
    if (results.length === 0) {
      panel.innerHTML = emptyMessageHtml(query);
    } else {
      const rows = results.map((r, index) => resultRowHtml(r, index)).join('');
      const hint = data.truncated ? truncatedHintHtml(results.length) : '';
      panel.innerHTML = rows + hint;
    }
    panel.scrollTop = 0;
  }

  function renderMessage(message) {
    ensureEl().innerHTML = messageHtml(message);
    results = [];
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
  };
}
