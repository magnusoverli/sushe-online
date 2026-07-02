/**
 * Accessibility helpers for modal dialogs.
 *
 * Promotes the pattern already proven in mobile-album-search.js — record the
 * opener, move focus into the dialog, trap Tab within it, and restore focus to
 * the opener on close (with preventScroll) — into one reusable place that
 * createModal opts into. Pure and DI-friendly (pass `doc` in tests).
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * @param {Element} scopeEl
 * @returns {Element[]} focusable descendants of scopeEl
 */
export function getFocusable(scopeEl) {
  if (!scopeEl || typeof scopeEl.querySelectorAll !== 'function') return [];
  return Array.from(scopeEl.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    // Visible = has layout boxes. getClientRects correctly counts a visible
    // position:fixed element (which offsetParent reports as null) and excludes
    // display:none. In non-DOM envs (tests) getClientRects is absent, so treat
    // the element as focusable.
    (el) =>
      typeof el.getClientRects !== 'function' || el.getClientRects().length > 0
  );
}

/**
 * Create a focus manager scoped to a dialog element.
 * @param {Element} scopeEl - the dialog container to trap focus within
 * @param {object} [options]
 * @param {Element|string|null} [options.initialFocus] - element, selector,
 *   'first', or null (defaults to the first focusable element)
 * @param {Document} [options.doc]
 * @returns {{ activate: Function, deactivate: Function, handleTab: Function }}
 */
export function createFocusManager(scopeEl, options = {}) {
  const {
    initialFocus = null,
    doc = typeof document !== 'undefined' ? document : null,
  } = options;
  let opener = null;

  function resolveInitial() {
    if (initialFocus == null || initialFocus === 'first') {
      return getFocusable(scopeEl)[0] || null;
    }
    if (typeof initialFocus === 'string') {
      return scopeEl && scopeEl.querySelector
        ? scopeEl.querySelector(initialFocus)
        : null;
    }
    return initialFocus;
  }

  function activate() {
    opener = doc ? doc.activeElement : null;
    const target = resolveInitial();
    if (target && typeof target.focus === 'function') {
      target.focus({ preventScroll: true });
    }
  }

  function handleTab(e) {
    if (!e || e.key !== 'Tab') return;
    const items = getFocusable(scopeEl);
    if (items.length === 0) {
      if (e.preventDefault) e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = doc ? doc.activeElement : null;
    const within = scopeEl.contains ? scopeEl.contains(active) : true;
    if (e.shiftKey) {
      if (active === first || !within) {
        if (e.preventDefault) e.preventDefault();
        if (last.focus) last.focus({ preventScroll: true });
      }
    } else if (active === last || !within) {
      if (e.preventDefault) e.preventDefault();
      if (first.focus) first.focus({ preventScroll: true });
    }
  }

  function deactivate() {
    if (
      opener &&
      doc &&
      (!doc.contains || doc.contains(opener)) &&
      typeof opener.focus === 'function'
    ) {
      opener.focus({ preventScroll: true });
    }
    opener = null;
  }

  return { activate, deactivate, handleTab };
}

function toList(targets) {
  if (!targets) return [];
  return Array.isArray(targets) ? targets.filter(Boolean) : [targets];
}

/** Mark background elements inert so assistive tech skips them. */
export function applyInert(targets) {
  for (const el of toList(targets)) {
    if ('inert' in el) el.inert = true;
    else if (el.setAttribute) el.setAttribute('inert', '');
  }
}

/** Undo applyInert. */
export function releaseInert(targets) {
  for (const el of toList(targets)) {
    if ('inert' in el) el.inert = false;
    else if (el.removeAttribute) el.removeAttribute('inert');
  }
}
