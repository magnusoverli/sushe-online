/**
 * List main-status toggle flow for app composition.
 */
export function createMainStatusToggler(deps = {}) {
  const {
    getListMetadata,
    getSortedGroups,
    showToast,
    apiCall,
    updateListMetadata,
    updateListNav,
    getCurrentListId,
    getListData,
    displayAlbums,
    logger = console,
  } = deps;

  return async function toggleMainStatus(listId) {
    const meta = getListMetadata(listId);
    if (!meta) return;

    const listName = meta.name || listId;

    let isInYearGroup = false;
    if (meta.groupId) {
      const sortedGroups = getSortedGroups();
      const group = sortedGroups.find(
        (candidate) => candidate._id === meta.groupId
      );
      isInYearGroup = group?.isYearGroup || false;
    }

    if (!meta.year && !isInYearGroup) {
      showToast(
        'List must be in a year category to be marked as main',
        'error'
      );
      return;
    }

    const newMainStatus = !meta.isMain;

    try {
      const response = await apiCall(
        `/api/lists/${encodeURIComponent(listId)}/main`,
        {
          method: 'POST',
          body: JSON.stringify({ isMain: newMainStatus }),
        }
      );

      updateListMetadata(listId, { isMain: newMainStatus });

      if (response.previousMainListId) {
        updateListMetadata(response.previousMainListId, { isMain: false });
      }

      updateListNav();

      if (listId === getCurrentListId()) {
        const albums = getListData(getCurrentListId());
        if (albums) {
          displayAlbums(albums, { forceFullRebuild: true });
        }
      }

      if (newMainStatus) {
        if (response.previousMainList) {
          showToast(
            `"${listName}" is now your main ${meta.year} list (replaced "${response.previousMainList}")`
          );
        } else {
          showToast(`"${listName}" is now your main ${meta.year} list`);
        }
      } else {
        showToast(`"${listName}" is no longer marked as main`);
      }
    } catch (error) {
      logger.error('Error toggling main status:', error);
      showToast('Error updating main status', 'error');
    }
  };
}
