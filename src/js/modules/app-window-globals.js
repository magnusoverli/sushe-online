/**
 * Registers app-wide window globals for legacy integration points.
 */

export function registerAppWindowGlobals(deps = {}) {
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  if (!win) return;

  const {
    apiCall,
    showToast,
    showReasoningModal,
    getListData,
    setListData,
    getListMetadata,
    updateListMetadata,
    isListDataLoaded,
    saveList,
    loadLists,
    selectList,
    updateListNav,
    collapseGroupsForActiveList,
    updatePlaylist,
    toggleMainStatus,
    displayAlbums,
    getGroup,
    updateGroupsFromServer,
    getCurrentListName,
    findListByName,
    isViewingRecommendations,
    getCurrentRecommendationsYear,
    selectRecommendations,
    clearSnapshotFromStorage,
    showMobileAlbumMenu,
    showMobileMoveToListSheet,
    showMobileListMenu,
    showMobileCategoryMenu,
    showMobileEditForm,
    showMobileEditFormSafe,
    showMobileSummarySheet,
    openRenameCategoryModal,
    playAlbum,
    playTrack,
    getPlaybackModule,
    playSpecificTrack,
    playAlbumSafe,
    removeAlbumSafe,
    fetchTracksForAlbum,
    getTrackName,
    getTrackLength,
    formatTrackTime,
    refreshLockedYearStatus,
  } = deps;

  win.apiCall = apiCall;
  win.showToast = showToast;
  win.showReasoningModal = showReasoningModal;

  win.getListData = getListData;
  win.setListData = setListData;
  win.getListMetadata = getListMetadata;
  win.updateListMetadata = updateListMetadata;
  win.isListDataLoaded = isListDataLoaded;

  win.saveList = saveList;
  win.loadLists = loadLists;
  win.selectList = selectList;
  win.updateListNav = updateListNav;
  win.collapseGroupsForActiveList = collapseGroupsForActiveList;
  win.updatePlaylist = updatePlaylist;
  win.toggleMainStatus = toggleMainStatus;
  win.displayAlbums = displayAlbums;

  win.getGroup = getGroup;
  win.updateGroupsFromServer = updateGroupsFromServer;

  win.getCurrentListName = getCurrentListName;
  win.findListByName = findListByName;
  win.isViewingRecommendations = isViewingRecommendations;
  win.getCurrentRecommendationsYear = getCurrentRecommendationsYear;
  win.selectRecommendations = selectRecommendations;
  win.clearSnapshotFromStorage = clearSnapshotFromStorage;

  win.showMobileAlbumMenu = showMobileAlbumMenu;
  win.showMobileMoveToListSheet = showMobileMoveToListSheet;
  win.showMobileListMenu = showMobileListMenu;
  win.showMobileCategoryMenu = showMobileCategoryMenu;
  win.showMobileEditForm = showMobileEditForm;
  win.showMobileEditFormSafe = showMobileEditFormSafe;
  win.showMobileSummarySheet = showMobileSummarySheet;
  win.openRenameCategoryModal = openRenameCategoryModal;

  win.playAlbum = playAlbum;
  win.playTrack = playTrack;
  win.playTrackSafe = function (albumId) {
    return getPlaybackModule().playTrackSafe(albumId);
  };
  win.playSpecificTrack = playSpecificTrack;
  win.playAlbumSafe = playAlbumSafe;
  win.removeAlbumSafe = removeAlbumSafe;

  win.fetchTracksForAlbum = fetchTracksForAlbum;
  win.getTrackName = getTrackName;
  win.getTrackLength = getTrackLength;
  win.formatTrackTime = formatTrackTime;
  win.refreshLockedYearStatus = refreshLockedYearStatus;
}
