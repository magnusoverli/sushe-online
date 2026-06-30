/**
 * Album-search field-options popover.
 *
 * Owns the body-mounted #albumSearchOptions popover and the set of optional
 * fields to search beyond artist + album. The selection is persisted to
 * localStorage and changes are reported through onChange so the parent can
 * re-run the current query.
 */

import { escapeHtml } from './html-utils.js';
import {
  OPTIONAL_FIELDS,
  loadFields,
  saveFields,
} from './album-search-fields.js';

const PANEL_GAP = 6;

export function createOptionsPopover(deps = {}) {
  const { doc, storage, onChange } = deps;
  let el = null;
  let selectedFields = loadFields(storage);

  function ensureEl() {
    if (el) return el;
    el = doc.createElement('div');
    el.id = 'albumSearchOptions';
    el.className = 'album-search-options hidden';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Search fields');
    el.innerHTML = `
      <div class="album-search-options-title">Search fields</div>
      <div class="album-search-option is-static">
        <i class="fas fa-check"></i><span>Artist &amp; album title</span>
      </div>
      ${OPTIONAL_FIELDS.map(
        (field) => `
        <label class="album-search-option">
          <input type="checkbox" data-search-field="${field.key}" />
          <span>${escapeHtml(field.label)}</span>
        </label>`
      ).join('')}
    `;
    doc.body.appendChild(el);
    return el;
  }

  function syncChecks() {
    if (!el) return;
    el.querySelectorAll('input[data-search-field]').forEach((checkbox) => {
      checkbox.checked = selectedFields.includes(
        checkbox.getAttribute('data-search-field')
      );
    });
  }

  function isOpen() {
    return !!el && !el.classList.contains('hidden');
  }

  function position() {
    const popover = ensureEl();
    const btn = doc.getElementById('albumSearchOptionsBtn');
    const container = doc.getElementById('albumSearchContainer');
    const anchor = btn || container;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    // Width is known only once the popover is shown (hidden -> measured).
    const width = popover.offsetWidth || 240;
    let left = Math.round(rect.right - width);
    if (left < 8) left = 8;
    popover.style.top = `${Math.round(rect.bottom + PANEL_GAP)}px`;
    popover.style.left = `${left}px`;
  }

  function open() {
    const popover = ensureEl();
    syncChecks();
    popover.classList.remove('hidden');
    const btn = doc.getElementById('albumSearchOptionsBtn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    position();
  }

  function close() {
    if (el) el.classList.add('hidden');
    const btn = doc.getElementById('albumSearchOptionsBtn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  // Returns true if the change was a field toggle (and was handled).
  function handleChange(target) {
    if (!target?.matches?.('input[data-search-field]')) return false;
    const key = target.getAttribute('data-search-field');
    if (!key) return true;
    if (target.checked) {
      if (!selectedFields.includes(key)) selectedFields.push(key);
    } else {
      selectedFields = selectedFields.filter((field) => field !== key);
    }
    saveFields(storage, selectedFields);
    if (typeof onChange === 'function') onChange();
    return true;
  }

  function contains(node) {
    return !!el && el.contains(node);
  }

  function getFields() {
    return selectedFields;
  }

  return {
    getFields,
    toggle,
    open,
    close,
    isOpen,
    handleChange,
    contains,
    reposition: position,
  };
}
