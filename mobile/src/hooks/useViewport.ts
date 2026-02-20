/**
 * useViewport - Dynamic viewport height for mobile browsers.
 * Sets --vh CSS custom property to handle mobile browser chrome.
 *
 * Key iOS PWA bug solved: When a file download triggers a system share
 * sheet, iOS recalculates innerHeight/visualViewport.height as if the app
 * were in regular Safari (with address bar), giving a smaller value
 * (e.g. 812 instead of 874). This persists after the share sheet dismisses
 * — both JS APIs permanently report the wrong value until a device
 * rotation forces iOS to recalculate.
 *
 * Solution: In standalone (PWA) mode, lock the viewport height at the
 * initial measurement. Only accept new values on orientation change,
 * and always keep the largest value seen for each orientation. In regular
 * browser mode, behave normally (track dynamic changes for address bar).
 */

import { useEffect } from 'react';

const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  ('standalone' in navigator &&
    (navigator as { standalone?: boolean }).standalone === true);

/** Locked height per orientation (standalone mode only). */
let lockedHeight: number | null = null;
let lastOrientation: number = screen.orientation?.angle ?? 0;

function setVh() {
  const rawHeight = window.visualViewport?.height ?? window.innerHeight;

  if (isStandalone) {
    const currentOrientation = screen.orientation?.angle ?? 0;
    const orientationChanged = currentOrientation !== lastOrientation;
    lastOrientation = currentOrientation;

    if (lockedHeight === null || orientationChanged) {
      // First measurement or orientation changed — accept the new value
      lockedHeight = rawHeight;
    } else {
      // Same orientation — only accept if larger (share sheet bug gives
      // a smaller value that we must ignore)
      lockedHeight = Math.max(lockedHeight, rawHeight);
    }

    const vh = lockedHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  } else {
    // Regular browser — track dynamic changes (address bar collapse etc.)
    const vh = rawHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  }
}

export function useViewport(): void {
  useEffect(() => {
    setVh();

    window.addEventListener('resize', setVh);
    window.addEventListener('orientationchange', setVh);

    // visualViewport fires its own resize event independently
    const vv = window.visualViewport;
    if (vv) vv.addEventListener('resize', setVh);

    return () => {
      window.removeEventListener('resize', setVh);
      window.removeEventListener('orientationchange', setVh);
      if (vv) vv.removeEventListener('resize', setVh);
    };
  }, []);
}
