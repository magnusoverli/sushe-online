/**
 * Album-search results dropdown.
 *
 * Owns the body-mounted #albumSearchResults listbox (mounted outside the header
 * so a header re-render never destroys it), the current result set, and the
 * keyboard-active row. Selection is reported back through the onSelect callback;
 * all DOM event wiring lives in the parent controller.
 */

import {
  resultRowHtml,
  emptyMessageHtml,
  truncatedHintHtml,
  messageHtml,
} from './album-search-render.js';

const PANEL_GAP = 6;

export function createResultsPanel(deps = {}) {
  const { doc, onSelect } = deps;
  let el = null;
  let results = [];
  let activeIndex = -1;

  function getInput() {
    return doc.getElementById('albumSearchInput');
  }

  function setExpanded(expanded) {
    const input = getInput();
    if (input) input.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function setActiveDescendant(id) {
    const input = getInput();
    if (!input) return;
    if (id) input.setAttribute('aria-activedescendant', id);
    else input.removeAttribute('aria-activedescendant');
  }

  function ensureEl() {
    if (el) return el;
    el = doc.createElement('div');
    el.id = 'albumSearchResults';
    el.setAttribute('role', 'listbox');
    el.className = 'album-search-panel hidden';
    doc.body.appendChild(el);
    return el;
  }

  function position() {
    const panel = ensureEl();
    const container = doc.getElementById('albumSearchContainer');
    const anchor = container || getInput();
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    panel.style.top = `${Math.round(rect.bottom + PANEL_GAP)}px`;
    panel.style.left = `${Math.round(rect.left)}px`;
    panel.style.width = `${Math.round(rect.width)}px`;
  }

  function open() {
    const panel = ensureEl();
    panel.classList.remove('hidden');
    setExpanded(true);
    position();
  }

  function close() {
    if (el) el.classList.add('hidden');
    setExpanded(false);
    setActiveDescendant(null);
    activeIndex = -1;
  }

  function isOpen() {
    return !!el && !el.classList.contains('hidden');
  }

  function render(data, query) {
    results = Array.isArray(data?.results) ? data.results : [];
    activeIndex = -1;
    const panel = ensureEl();

    if (results.length === 0) {
      panel.innerHTML = emptyMessageHtml(query);
    } else {
      const rows = results
        .map((result, index) => resultRowHtml(result, index))
        .join('');
      const hint = data.truncated ? truncatedHintHtml(results.length) : '';
      panel.innerHTML = rows + hint;
    }

    open();
  }

  function renderMessage(message) {
    const panel = ensureEl();
    panel.innerHTML = messageHtml(message);
    open();
  }

  function highlightActive() {
    if (!el) return;
    el.querySelectorAll('.album-search-result').forEach((row, index) => {
      const isActive = index === activeIndex;
      row.classList.toggle('is-active', isActive);
      if (isActive) {
        row.scrollIntoView({ block: 'nearest' });
        setActiveDescendant(row.id);
      }
    });
    if (activeIndex < 0) setActiveDescendant(null);
  }

  function moveActive(delta) {
    if (results.length === 0) return;
    const count = results.length;
    if (activeIndex < 0) {
      activeIndex = delta > 0 ? 0 : count - 1;
    } else {
      activeIndex = (activeIndex + delta + count) % count;
    }
    highlightActive();
  }

  function selectActive() {
    const index = activeIndex >= 0 ? activeIndex : 0;
    if (results[index]) onSelect(results[index]);
  }

  // Returns true if the click was on a result row (and selection was reported).
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

  function count() {
    return results.length;
  }

  return {
    render,
    renderMessage,
    open,
    close,
    isOpen,
    moveActive,
    selectActive,
    handleClick,
    contains,
    count,
    reposition: position,
  };
}
