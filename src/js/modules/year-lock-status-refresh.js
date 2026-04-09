/**
 * Refreshes lock status UI for the currently selected list year.
 */

export function createYearLockStatusRefresh(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const win = deps.win || (typeof window !== 'undefined' ? window : null);

  const {
    invalidateLockedYearsCache,
    getListMetadata,
    getCurrentListId,
    isListLocked,
    getSortingModule,
    showYearLockUI,
    clearYearLockUI,
  } = deps;

  async function refreshLockedYearStatus(year) {
    invalidateLockedYearsCache();

    const currentMeta = getListMetadata(getCurrentListId());
    const currentYear = currentMeta?.year;
    const currentIsMain = currentMeta?.isMain || false;

    if (!currentYear || currentYear !== year || !currentIsMain) {
      return;
    }

    const locked = await isListLocked(currentYear, currentIsMain);

    const container = doc?.getElementById('albumContainer');
    if (!container) return;

    const sorting = getSortingModule();
    if (!sorting) return;

    if (locked) {
      sorting.destroySorting(container);
      showYearLockUI(container, currentYear);
      return;
    }

    const isMobile = (win?.innerWidth || 0) < 1024;
    sorting.initializeUnifiedSorting(container, isMobile);
    clearYearLockUI(container);
  }

  return {
    refreshLockedYearStatus,
  };
}
