const { describe, it } = require('node:test');
const assert = require('node:assert');

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add: (...items) => items.forEach((item) => classes.add(item)),
    remove: (...items) => items.forEach((item) => classes.delete(item)),
    contains: (item) => classes.has(item),
  };
}

function createElement(rect = { top: 0, right: 0 }) {
  return {
    classList: createClassList(['hidden']),
    style: {},
    innerHTML: '',
    dataset: {},
    getBoundingClientRect: () => rect,
    querySelectorAll: () => [],
    addEventListener: () => {},
    contains: () => false,
  };
}

describe('playback submenu', async () => {
  const { createPlayback } = await import('../src/js/modules/playback.js');

  it('shows recommendation play submenu with same options', async () => {
    const submenu = createElement();
    const playOption = createElement({ top: 120, right: 0 });
    const contextMenu = createElement({ top: 0, right: 420 });

    const elements = {
      playAlbumSubmenu: submenu,
      playRecommendationOption: playOption,
      recommendationContextMenu: contextMenu,
    };

    globalThis.window = {
      currentUser: {
        spotifyAuth: true,
        tidalAuth: false,
        musicService: 'spotify',
      },
    };

    globalThis.document = {
      getElementById: (id) => elements[id] || null,
    };

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        devices: [
          {
            id: 'device-1',
            name: 'Kitchen Speaker',
            type: 'Speaker',
            is_active: false,
          },
        ],
      }),
    });

    const playback = createPlayback({
      getListData: () => null,
      getCurrentListId: () => '',
      getContextAlbum: () => ({ index: null, albumId: null }),
      findAlbumByIdentity: () => null,
      playAlbumSafe: () => {},
      showServicePicker: () => Promise.resolve('spotify'),
      getDeviceIcon: () => 'fas fa-speaker',
    });

    await playback.showPlayAlbumSubmenuForAlbum(
      { artist: 'Burial', album: 'Untrue' },
      {
        playOptionId: 'playRecommendationOption',
        contextMenuId: 'recommendationContextMenu',
      }
    );

    assert.ok(submenu.innerHTML.includes('Open in Spotify'));
    assert.ok(submenu.innerHTML.includes('Spotify Connect'));
    assert.ok(submenu.innerHTML.includes('Kitchen Speaker'));
    assert.strictEqual(submenu.style.left, '420px');
    assert.strictEqual(submenu.style.top, '120px');
  });
});
