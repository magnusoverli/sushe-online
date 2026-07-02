/**
 * Single source of truth for the mobile/desktop breakpoint.
 *
 * The boundary is (max-width: 1023px) for mobile / (min-width: 1024px) for
 * desktop — the same value the CSS media queries use. Prefer this over ad-hoc
 * window.innerWidth reads so the whole app agrees on the boundary and can react
 * to viewport changes instead of reading the width once at init.
 */
export const MOBILE_MAX_WIDTH_PX = 1023;
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;

export const mobileMediaQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MOBILE_MEDIA_QUERY)
    : null;

/**
 * @param {Window} [win] - window to test (defaults to the global window)
 * @returns {boolean} true when the viewport is at mobile width
 */
export function isMobileViewport(win) {
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  if (!w) return false;
  if (typeof w.matchMedia === 'function') {
    return w.matchMedia(MOBILE_MEDIA_QUERY).matches;
  }
  // When matchMedia is unavailable, read the width directly.
  if (typeof w.innerWidth === 'number') {
    return w.innerWidth <= MOBILE_MAX_WIDTH_PX;
  }
  return false;
}

/**
 * Subscribe to mobile/desktop boundary crossings.
 * @param {(isMobile: boolean) => void} cb
 * @returns {() => void} unsubscribe function
 */
export function onViewportChange(cb) {
  if (!mobileMediaQuery) return () => {};
  const handler = (e) => cb(e.matches);
  mobileMediaQuery.addEventListener('change', handler);
  return () => mobileMediaQuery.removeEventListener('change', handler);
}
