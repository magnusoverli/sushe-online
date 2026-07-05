import { afterFrame as runAfterFrame } from './dom-timing.js';
import { applyInert, releaseInert } from './modal-a11y.js';
import {
  MOBILE_ALBUM_SEARCH_PHASE,
  MOBILE_ALBUM_SEARCH_TIMING,
} from './mobile-album-search-constants.js';

export function createMobileSearchLifecycle(deps = {}) {
  const { doc, win } = deps;
  let open = false;
  let fabPrevDisplay = null;
  let closeTimer = null;
  let openTimer = null;
  let resultsOpenTimer = null;
  let fabTimer = null;
  let fabTransitionToken = 0;
  let closeResolve = null;
  let finishPendingClose = null;

  const bar = () => doc.getElementById('mobileAlbumSearchBar');
  const input = () => doc.getElementById('mobileAlbumSearchInput');
  const isOpen = () => open;

  function header() {
    return bar()?.closest?.('header') || null;
  }

  function headerChromeElements() {
    const h = header();
    return [
      h?.querySelector?.('.mobile-header-left'),
      h?.querySelector?.('#mobileCurrentListName'),
      h?.querySelector?.('.mobile-header-actions'),
    ].filter(Boolean);
  }

  function setA11yHidden(el, hidden) {
    if (!el) return;
    if (hidden) {
      el.setAttribute?.('aria-hidden', 'true');
      applyInert(el);
      return;
    }
    el.removeAttribute?.('aria-hidden');
    releaseInert(el);
  }

  // The morph CSS is transition:none under reduced motion, so the close must
  // tear down (inert, scroll lock, FAB, focus) immediately too — otherwise the
  // header looks restored while the list stays dead for the timer's 370ms.
  function prefersReducedMotion() {
    return (
      win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
    );
  }

  function setSearchPhase(nextPhase) {
    const searchBar = bar();
    const h = header();
    const isActive =
      nextPhase === MOBILE_ALBUM_SEARCH_PHASE.OPENING ||
      nextPhase === MOBILE_ALBUM_SEARCH_PHASE.OPEN;
    h?.classList.toggle('mobile-search-active', isActive);
    h?.classList.toggle(
      'mobile-search-opening',
      nextPhase === MOBILE_ALBUM_SEARCH_PHASE.OPENING
    );
    h?.classList.toggle(
      'mobile-search-open',
      nextPhase === MOBILE_ALBUM_SEARCH_PHASE.OPEN
    );
    h?.classList.toggle(
      'mobile-search-closing',
      nextPhase === MOBILE_ALBUM_SEARCH_PHASE.CLOSING
    );
    setA11yHidden(searchBar, !isActive);
    headerChromeElements().forEach((el) => setA11yHidden(el, isActive));
    doc
      .getElementById('mobileAlbumSearchBtn')
      ?.setAttribute('aria-expanded', isActive ? 'true' : 'false');
  }

  function toggleClear(visible) {
    doc
      .getElementById('mobileAlbumSearchClear')
      ?.classList.toggle('hidden', !visible);
  }

  function afterFrame(callback) {
    runAfterFrame(win, callback);
  }

  function clearCloseTimer(options = {}) {
    if (closeTimer) {
      (win.clearTimeout || clearTimeout)(closeTimer);
      closeTimer = null;
    }
    if (options.finish === true && finishPendingClose) {
      finishPendingClose();
      return;
    }
    closeResolve?.();
    closeResolve = null;
    finishPendingClose = null;
  }

  function clearOpenTimer() {
    if (!openTimer) return;
    (win.clearTimeout || clearTimeout)(openTimer);
    openTimer = null;
  }

  function clearResultsOpenTimer() {
    if (!resultsOpenTimer) return;
    (win.clearTimeout || clearTimeout)(resultsOpenTimer);
    resultsOpenTimer = null;
  }

  function clearFabTimer() {
    if (!fabTimer) return;
    (win.clearTimeout || clearTimeout)(fabTimer);
    fabTimer = null;
  }

  function keyboardInset() {
    const el = input();
    const vv = win.visualViewport;
    if (!vv || doc.activeElement !== el) return 0;
    return Math.max(0, win.innerHeight - (vv.offsetTop + vv.height));
  }

  function positionResults(results) {
    const searchBar = bar();
    if (!searchBar) return;
    results.position(searchBar.getBoundingClientRect().bottom, keyboardInset());
  }

  function hideKeyboardForResultScroll(results) {
    const el = input();
    if (doc.activeElement !== el) return;
    el.blur();
    afterFrame(() => positionResults(results));
  }

  function hideFab() {
    const fab = doc.getElementById('addAlbumFAB');
    if (!fab) return;
    const token = ++fabTransitionToken;
    if (fabPrevDisplay === null) fabPrevDisplay = fab.style.display;
    clearFabTimer();
    fab.classList.add('search-mode-hidden');
    setA11yHidden(fab, true);
    fabTimer = (win.setTimeout || setTimeout)(() => {
      if (token !== fabTransitionToken) {
        fabTimer = null;
        return;
      }
      fab.style.display = 'none';
      fabTimer = null;
    }, MOBILE_ALBUM_SEARCH_TIMING.fabTransitionMs);
  }

  function restoreFab() {
    const fab = doc.getElementById('addAlbumFAB');
    if (!fab) return;
    const token = ++fabTransitionToken;
    clearFabTimer();
    fab.style.display = fabPrevDisplay === null ? '' : fabPrevDisplay;
    fabPrevDisplay = null;
    setA11yHidden(fab, false);
    afterFrame(() => {
      if (token !== fabTransitionToken) return;
      fab.classList.remove('search-mode-hidden');
    });
  }

  function openSearch(options = {}) {
    if (open) return false;
    if (!bar()) return false;
    clearCloseTimer({ finish: true });
    open = true;
    clearOpenTimer();
    clearResultsOpenTimer();
    setSearchPhase(MOBILE_ALBUM_SEARCH_PHASE.OPENING);
    doc.body.style.overflow = 'hidden';
    hideFab();
    applyInert(doc.getElementById('albumContainer'));

    const el = input();
    const preservedQuery = options.getPreservedQuery?.() || '';
    if (el && !el.value && preservedQuery) el.value = preservedQuery;
    options.positionResults?.();
    el?.focus({ preventScroll: true });

    const showResults = () => {
      resultsOpenTimer = null;
      if (open) options.showCurrentQueryResults?.();
    };

    if (prefersReducedMotion()) {
      setSearchPhase(MOBILE_ALBUM_SEARCH_PHASE.OPEN);
      showResults();
      return true;
    }

    resultsOpenTimer = (win.setTimeout || setTimeout)(
      showResults,
      MOBILE_ALBUM_SEARCH_TIMING.resultsOpenDelayMs
    );

    openTimer = (win.setTimeout || setTimeout)(() => {
      if (!open) return;
      setSearchPhase(MOBILE_ALBUM_SEARCH_PHASE.OPEN);
      openTimer = null;
    }, MOBILE_ALBUM_SEARCH_TIMING.headerTransitionMs);
    return true;
  }

  function closeSearch(options = {}) {
    if (!open) return Promise.resolve();
    open = false;
    const restoreFocus = options.restoreFocus !== false;
    const preserveQuery = options.preserveQuery === true;
    const animate = options.immediate !== true && !prefersReducedMotion();
    clearOpenTimer();
    clearResultsOpenTimer();

    // Hand focus to the trigger BEFORE the bar goes inert below — inert on the
    // focused input's ancestor would otherwise drop focus onto <body> for the
    // whole close animation. finishClose re-asserts the same target.
    if (restoreFocus) {
      const active = doc.activeElement;
      if (active && bar()?.contains?.(active)) {
        doc
          .getElementById('mobileAlbumSearchBtn')
          ?.focus({ preventScroll: true });
      }
    }

    setSearchPhase(
      animate
        ? MOBILE_ALBUM_SEARCH_PHASE.CLOSING
        : MOBILE_ALBUM_SEARCH_PHASE.CLOSED
    );
    const el = input();
    if (el) {
      if (preserveQuery) options.onPreserveQuery?.(el.value);
      else options.onClearQuery?.();
      const blurInput = () => {
        if (!open && doc.activeElement === el) el.blur();
      };
      if (animate) afterFrame(blurInput);
      else blurInput();
    }
    if (preserveQuery) toggleClear((el?.value || '').length > 0);
    else options.resetSearch?.();
    options.closeResults?.({ immediate: !animate });

    clearCloseTimer();
    return new Promise((resolve) => {
      closeResolve = resolve;
      const finishClose = () => {
        if (open) return;
        closeTimer = null;
        closeResolve = null;
        finishPendingClose = null;
        setSearchPhase(MOBILE_ALBUM_SEARCH_PHASE.CLOSED);
        if (!preserveQuery) options.clearVisuals?.();
        releaseInert(doc.getElementById('albumContainer'));
        doc.body.style.overflow = '';
        win.scrollTo(0, 0);
        doc.body.scrollTop = 0;
        restoreFab();
        if (restoreFocus) doc.getElementById('mobileAlbumSearchBtn')?.focus();
        resolve();
      };
      finishPendingClose = finishClose;

      if (animate) {
        closeTimer = (win.setTimeout || setTimeout)(
          finishClose,
          Math.max(
            MOBILE_ALBUM_SEARCH_TIMING.headerTransitionMs,
            MOBILE_ALBUM_SEARCH_TIMING.resultsTransitionMs
          )
        );
        return;
      }
      finishClose();
    });
  }

  return {
    afterFrame,
    close: closeSearch,
    hideKeyboardForResultScroll,
    input,
    isOpen,
    open: openSearch,
    positionResults,
    toggleClear,
  };
}
