const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('app-window-globals module', () => {
  let registerAppWindowGlobals;

  beforeEach(async () => {
    const module = await import('../src/js/modules/app-window-globals.js');
    registerAppWindowGlobals = module.registerAppWindowGlobals;
  });

  it('registers legacy bindings and the extension navigation API', () => {
    const existingNavigation = () => {};
    const win = {
      SuSheAppNavigation: { existingNavigation },
    };
    const selectList = () => {};
    const updateListNav = () => {};
    const collapseGroupsForActiveList = () => {};
    const displayAlbums = () => {};
    const openAlbum = () => {};

    registerAppWindowGlobals({
      win,
      selectList,
      updateListNav,
      collapseGroupsForActiveList,
      displayAlbums,
      openAlbum,
    });

    assert.strictEqual(win.selectList, selectList);
    assert.strictEqual(win.updateListNav, updateListNav);
    assert.strictEqual(
      win.collapseGroupsForActiveList,
      collapseGroupsForActiveList
    );
    assert.strictEqual(win.displayAlbums, displayAlbums);
    assert.strictEqual(win.SuSheAppNavigation.openAlbum, openAlbum);
    assert.strictEqual(
      win.SuSheAppNavigation.existingNavigation,
      existingNavigation
    );

    assert.strictEqual(win.apiCall, undefined);
    assert.strictEqual(win.saveList, undefined);
    assert.strictEqual(win.playTrackSafe, undefined);
    assert.strictEqual(win.showMobileListMenu, undefined);
    assert.strictEqual(win.selectRecommendations, undefined);
  });

  it('no-ops safely when window object is unavailable', () => {
    assert.doesNotThrow(() => {
      registerAppWindowGlobals({ win: null });
    });
  });
});
