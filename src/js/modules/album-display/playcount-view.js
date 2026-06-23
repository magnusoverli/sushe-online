/**
 * Playcount view — single source of truth for how a Last.fm playcount renders.
 *
 * Shared by the initial album render (album-display.js) and the in-place live
 * updater (playcount-sync.js). The sync module deliberately mutates the existing
 * element instead of re-rendering the whole list, but it should not *define* the
 * visuals — that lives here, so the two paths can never drift apart.
 *
 * @module album-display/playcount-view
 */

const MOBILE_BASE = 'ml-2 shrink-0 text-[13px]';
const DESKTOP_BASE = 'text-xs shrink-0';

const NOT_FOUND_TITLE = 'Album not found on Last.fm';
const NOT_FOUND_ICON = '<i class="fas fa-times text-[10px]"></i>';

/**
 * Visual atoms (class string, inner HTML, title) for a resolved mobile status.
 * @param {'success'|'not_found'} status
 * @param {string} display - Pre-formatted playcount (e.g. "1.3K"); unused for not_found
 * @returns {{ className: string, html: string, title: string }}
 */
function mobileAtoms(status, display) {
  if (status === 'not_found') {
    return {
      className: `text-red-500 ${MOBILE_BASE}`,
      html: NOT_FOUND_ICON,
      title: NOT_FOUND_TITLE,
    };
  }
  return {
    className: `text-gray-400 ${MOBILE_BASE}`,
    html: `<i class="fas fa-headphones text-[10px]"></i> ${display}`,
    title: '',
  };
}

/**
 * Visual atoms for a resolved desktop status.
 * @param {'success'|'not_found'} status
 * @param {string} display - Pre-formatted playcount; unused for not_found
 * @param {number|string} playcount - Raw play count, for the success tooltip
 * @returns {{ className: string, html: string, title: string }}
 */
function desktopAtoms(status, display, playcount) {
  if (status === 'not_found') {
    return {
      className: `text-red-500 ${DESKTOP_BASE}`,
      html: NOT_FOUND_ICON,
      title: NOT_FOUND_TITLE,
    };
  }
  return {
    className: `text-gray-500 ${DESKTOP_BASE}`,
    html: `<i class="fas fa-headphones text-[10px] mr-1"></i>${display}`,
    title: `${playcount} plays on Last.fm`,
  };
}

// ---- Initial render: build the full <span> ----

/**
 * Build the mobile playcount span for the initial card render.
 * @param {string} itemId - List item id (drives the data attribute)
 * @param {{ isEmpty: boolean, isNotFound: boolean, html: string }} playcountDisplay
 * @returns {string} span HTML
 */
export function mobilePlaycountSpan(itemId, playcountDisplay) {
  if (playcountDisplay.isEmpty) {
    return `<span class="text-gray-400 ${MOBILE_BASE} hidden" data-playcount-mobile="${itemId}"></span>`;
  }
  const status = playcountDisplay.isNotFound ? 'not_found' : 'success';
  const { className, html, title } = mobileAtoms(status, playcountDisplay.html);
  const titleAttr = title ? ` title="${title}"` : '';
  return `<span class="${className}" data-playcount-mobile="${itemId}" data-status="${status}"${titleAttr}>${html}</span>`;
}

/**
 * Build the desktop playcount span for the initial row render.
 * @param {string} itemId
 * @param {{ isEmpty: boolean, isNotFound: boolean, html: string }} playcountDisplay
 * @param {number|string} playcount - Raw play count, for the success tooltip
 * @returns {string} span HTML
 */
export function desktopPlaycountSpan(itemId, playcountDisplay, playcount) {
  if (playcountDisplay.isEmpty) {
    return `<span class="text-gray-500 ${DESKTOP_BASE} hidden" data-playcount="${itemId}"></span>`;
  }
  const status = playcountDisplay.isNotFound ? 'not_found' : 'success';
  const { className, html, title } = desktopAtoms(
    status,
    playcountDisplay.html,
    playcount
  );
  return `<span class="${className}" data-playcount="${itemId}" data-status="${status}" title="${title}">${html}</span>`;
}

// ---- Live update: paint into an existing element in place ----

/**
 * Apply a freshly fetched playcount to an existing mobile badge element.
 * @param {Element} el
 * @param {'success'|'not_found'} status
 * @param {string} [display] - Pre-formatted playcount (success only)
 */
export function applyMobilePlaycount(el, status, display) {
  const { className, html, title } = mobileAtoms(status, display);
  el.className = className;
  el.innerHTML = html;
  if (title) el.title = title;
  el.dataset.status = status;
  el.classList.remove('hidden');
}

/**
 * Apply a freshly fetched playcount to an existing desktop badge element.
 * @param {Element} el
 * @param {'success'|'not_found'} status
 * @param {string} [display] - Pre-formatted playcount (success only)
 * @param {number|string} [playcount] - Raw play count, for the success tooltip
 */
export function applyDesktopPlaycount(el, status, display, playcount) {
  const { className, html, title } = desktopAtoms(status, display, playcount);
  el.className = className;
  el.innerHTML = html;
  el.title = title;
  el.dataset.status = status;
  el.classList.remove('hidden');
}
