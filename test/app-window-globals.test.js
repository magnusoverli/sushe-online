const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('app-window-globals module', () => {
  let registerAppWindowGlobals;

  beforeEach(async () => {
    const module = await import('../src/js/modules/app-window-globals.js');
    registerAppWindowGlobals = module.registerAppWindowGlobals;
  });

  it('registers legacy window bindings and playback wrapper', () => {
    const win = {};
    const playbackCalls = [];
    const refreshLockedYearStatus = async () => {};

    registerAppWindowGlobals({
      win,
      apiCall: () => {},
      showToast: () => {},
      showReasoningModal: () => {},
      getListData: () => {},
      setListData: () => {},
      getListMetadata: () => {},
      updateListMetadata: () => {},
      isListDataLoaded: () => {},
      saveList: () => {},
      loadLists: () => {},
      selectList: () => {},
      updateListNav: () => {},
      collapseGroupsForActiveList: () => {},
      updatePlaylist: () => {},
      toggleMainStatus: () => {},
      displayAlbums: () => {},
      getGroup: () => {},
      updateGroupsFromServer: () => {},
      getCurrentListName: () => {},
      findListByName: () => {},
      isViewingRecommendations: () => false,
      getCurrentRecommendationsYear: () => null,
      selectRecommendations: () => {},
      clearSnapshotFromStorage: () => {},
      showMobileAlbumMenu: () => {},
      showMobileMoveToListSheet: () => {},
      showMobileListMenu: () => {},
      showMobileCategoryMenu: () => {},
      showMobileEditForm: () => {},
      showMobileEditFormSafe: () => {},
      showMobileSummarySheet: () => {},
      openRenameCategoryModal: () => {},
      playAlbum: () => {},
      playTrack: () => {},
      getPlaybackModule: () => ({
        playTrackSafe(albumId) {
          playbackCalls.push(albumId);
          return `played:${albumId}`;
        },
      }),
      playSpecificTrack: () => {},
      playAlbumSafe: () => {},
      removeAlbumSafe: () => {},
      fetchTracksForAlbum: () => {},
      getTrackName: () => {},
      getTrackLength: () => {},
      formatTrackTime: () => {},
      refreshLockedYearStatus,
    });

    assert.strictEqual(typeof win.apiCall, 'function');
    assert.strictEqual(typeof win.selectList, 'function');
    assert.strictEqual(typeof win.updateListNav, 'function');
    assert.strictEqual(typeof win.playTrackSafe, 'function');
    assert.strictEqual(win.refreshLockedYearStatus, refreshLockedYearStatus);

    const playResult = win.playTrackSafe('album-1');
    assert.strictEqual(playResult, 'played:album-1');
    assert.deepStrictEqual(playbackCalls, ['album-1']);
  });

  it('no-ops safely when window object is unavailable', () => {
    assert.doesNotThrow(() => {
      registerAppWindowGlobals({ win: null });
    });
  });
});
