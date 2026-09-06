/**
 * Shared list menu config and action helpers.
 */

function getMusicServiceText(currentUser = {}) {
  const hasSpotify = !!currentUser.spotifyAuth;
  const hasTidal = !!currentUser.tidalAuth;
  const musicService = currentUser.musicService;

  let musicServiceText = 'Send to Music Service';
  if (musicService === 'spotify' && hasSpotify) {
    musicServiceText = 'Send to Spotify';
  } else if (musicService === 'tidal' && hasTidal) {
    musicServiceText = 'Send to Tidal';
  } else if (hasSpotify && !hasTidal) {
    musicServiceText = 'Send to Spotify';
  } else if (hasTidal && !hasSpotify) {
    musicServiceText = 'Send to Tidal';
  }

  return { hasSpotify, hasTidal, musicServiceText };
}

export function buildListMenuConfig({
  listMeta,
  groups = [],
  currentUser = {},
} = {}) {
  const meta = listMeta || {};
  const groupId = meta.groupId;

  let isInCollection = false;
  let isInYearGroup = false;

  if (!groupId) {
    isInCollection = true;
  } else {
    const group = groups.find((candidate) => candidate._id === groupId);
    if (group) {
      isInCollection = !group.isYearGroup;
      isInYearGroup = !!group.isYearGroup;
    }
  }

  const hasYear = !!meta.year || isInYearGroup;
  const { hasSpotify, hasTidal, musicServiceText } =
    getMusicServiceText(currentUser);

  return {
    hasYear,
    isMain: !!meta.isMain,
    mainToggleText: meta.isMain ? 'Remove Main Status' : 'Set as Main',
    mainIconClass: 'fa-star',
    musicServiceText,
    hasSpotify,
    hasTidal,
    isInCollection,
  };
}

const EMPTY_LIST_STATE_HTML = `
  <div class="text-center text-gray-500 mt-20">
    <p class="text-xl mb-2">No list selected</p>
    <p class="text-sm">Create or import a list to get started</p>
  </div>
`;

export function createListMenuActions(deps = {}) {
  const {
    doc = typeof document !== 'undefined' ? document : null,
    getListData,
    getLists,
    getListMetadata,
    getCurrentList,
    setCurrentList,
    selectList,
    apiCall,
    showConfirmation,
    showToast,
    refreshGroupsAndLists,
    updateListNav,
    clearSnapshotFromStorage,
    updatePlaylist,
    downloadListAsJSON,
    downloadListAsPDF,
    downloadListAsCSV,
    openRenameModal,
    toggleMainStatus,
    logger = console,
  } = deps;

  function renameList(listId) {
    if (!listId) return;
    openRenameModal(listId);
  }

  function toggleMainForList(listId) {
    if (!listId) return;
    toggleMainStatus(listId);
  }

  function downloadList(listId, format) {
    if (!listId) return;
    if (format === 'json') {
      downloadListAsJSON(listId);
      return;
    }
    if (format === 'pdf') {
      downloadListAsPDF(listId);
      return;
    }
    if (format === 'csv') {
      downloadListAsCSV(listId);
    }
  }

  async function sendToMusicService(listId) {
    if (!listId) return;

    try {
      const listData = getListData(listId) || [];
      await updatePlaylist(listId, listData);
    } catch (error) {
      logger.error('Update playlist failed', error);
    }
  }

  /** Nothing left to show: drop the selection and say so. */
  function showEmptyListState() {
    setCurrentList?.(null);

    const albumContainer = doc?.getElementById('albumContainer');
    if (albumContainer) {
      albumContainer.innerHTML = EMPTY_LIST_STATE_HTML;
    }
  }

  /**
   * Confirm, delete, and move the selection somewhere valid.
   *
   * Shared by the desktop context menu and the mobile action sheet, which
   * carried near-identical copies of this. The copies had drifted: only the
   * desktop one cleared the list's localStorage snapshot, and only the desktop
   * one cleared the current-list state when the last list went.
   *
   * @param {string} listId
   * @returns {Promise<boolean>} true when the list was deleted
   */
  async function deleteList(listId) {
    if (!listId) return false;

    const listName = getListMetadata?.(listId)?.name || listId;

    const confirmed = await showConfirmation(
      'Delete List',
      `Are you sure you want to delete the list "${listName}"?`,
      'This action cannot be undone.',
      'Delete'
    );
    if (!confirmed) return false;

    try {
      await apiCall(`/api/lists/${encodeURIComponent(listId)}`, {
        method: 'DELETE',
      });
    } catch (error) {
      logger.error('Delete list failed', error);
      showToast('Error deleting list', 'error');
      return false;
    }

    clearSnapshotFromStorage?.(listId);

    // Read the map here rather than capturing it: setLists() replaces the
    // object on every refresh, so a reference taken once at init time stops
    // tracking state after the first one and goes on answering with the
    // lists that existed at startup.
    const lists = getLists?.() || {};
    delete lists[listId];

    // Move the selection before refreshing: refreshGroupsAndLists() clears a
    // selection it cannot find, which would blank the view on the way to the
    // replacement list.
    if (getCurrentList?.() === listId) {
      const [nextListId] = Object.keys(lists);
      if (nextListId) {
        await selectList(nextListId);
      } else {
        showEmptyListState();
      }
    }

    if (refreshGroupsAndLists) {
      await refreshGroupsAndLists();
    } else {
      updateListNav?.();
    }

    showToast(`List "${listName}" deleted`);
    return true;
  }

  return {
    renameList,
    toggleMainForList,
    downloadList,
    sendToMusicService,
    deleteList,
  };
}
