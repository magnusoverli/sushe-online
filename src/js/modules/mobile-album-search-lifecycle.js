const SEARCH_HEADER_TRANSITION_MS = 370;
const SEARCH_RESULTS_TRANSITION_MS = 260;
const SEARCH_FAB_TRANSITION_MS = 220;

export function createMobileSearchLifecycle(deps = {}) {
  const { doc, win } = deps;
  let open = false;
  let fabPrevDisplay = null;
  let closeTimer = null;
  let openTimer = null;
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

  function setSearchPhase(nextPhase) {
    const searchBar = bar();
    const h = header();
    const isActive = nextPhase === 'opening' || nextPhase === 'open';
    h?.classList.toggle('mobile-search-active', isActive);
    h?.classList.toggle('mobile-search-opening', nextPhase === 'opening');
    h?.classList.toggle('mobile-search-open', nextPhase === 'open');
    h?.classList.toggle('mobile-search-closing', nextPhase === 'closing');
    searchBar?.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    if (isActive) searchBar?.removeAttribute('inert');
    else searchBar?.setAttribute('inert', '');
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
    if (typeof win.requestAnimationFrame === 'function') {
      win.requestAnimationFrame(callback);
      return;
    }
    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(callback);
      return;
    }
    setTimeout(callback, 0);
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
    fab.setAttribute('aria-hidden', 'true');
    fab.setAttribute('inert', '');
    fabTimer = (win.setTimeout || setTimeout)(() => {
      if (token !== fabTransitionToken) {
        fabTimer = null;
        return;
      }
      fab.style.display = 'none';
      fabTimer = null;
    }, SEARCH_FAB_TRANSITION_MS);
  }

  function restoreFab() {
    const fab = doc.getElementById('addAlbumFAB');
    if (!fab) return;
    const token = ++fabTransitionToken;
    clearFabTimer();
    fab.style.display = fabPrevDisplay === null ? '' : fabPrevDisplay;
    fabPrevDisplay = null;
    fab.removeAttribute('aria-hidden');
    fab.removeAttribute('inert');
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
    setSearchPhase('opening');
    doc.body.style.overflow = 'hidden';
    hideFab();
    doc.getElementById('albumContainer')?.setAttribute('inert', '');

    const el = input();
    const preservedQuery = options.getPreservedQuery?.() || '';
    if (el && !el.value && preservedQuery) el.value = preservedQuery;
    options.positionResults?.();
    options.showCurrentQueryResults?.();
    el?.focus({ preventScroll: true });

    openTimer = (win.setTimeout || setTimeout)(() => {
      if (!open) return;
      setSearchPhase('open');
      openTimer = null;
    }, SEARCH_HEADER_TRANSITION_MS);
    return true;
  }

  function closeSearch(options = {}) {
    if (!open) return Promise.resolve();
    open = false;
    const restoreFocus = options.restoreFocus !== false;
    const preserveQuery = options.preserveQuery === true;
    const animate = options.immediate !== true;
    clearOpenTimer();

    setSearchPhase(animate ? 'closing' : 'closed');
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
        setSearchPhase('closed');
        if (!preserveQuery) options.clearVisuals?.();
        doc.getElementById('albumContainer')?.removeAttribute('inert');
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
          Math.max(SEARCH_HEADER_TRANSITION_MS, SEARCH_RESULTS_TRANSITION_MS)
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
