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

export function createListMenuActions(deps = {}) {
  const {
    getListData,
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

  return {
    renameList,
    toggleMainForList,
    downloadList,
    sendToMusicService,
  };
}
