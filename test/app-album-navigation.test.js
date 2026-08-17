const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

describe('app album navigation', () => {
  let createAppAlbumNavigation;

  beforeEach(async () => {
    const module = await import('../src/js/modules/app-album-navigation.js');
    createAppAlbumNavigation = module.createAppAlbumNavigation;
  });

  it('switches the running app to the requested list and focuses the album', async () => {
    let currentListId = 'old-list';
    const focusAlbum = mock.fn();
    const selectList = mock.fn(async (listId) => {
      currentListId = listId;
    });
    const navigation = createAppAlbumNavigation({
      getLists: () => ({ 'old-list': {}, 'main-list': {} }),
      getListData: () => [{ album_id: 'album-1' }],
      getCurrentListId: () => currentListId,
      selectList,
      focusAlbum,
    });

    const result = await navigation.openAlbum({
      listId: 'main-list',
      albumId: 'album-1',
    });

    assert.deepStrictEqual(result, { handled: true, highlighted: true });
    assert.deepStrictEqual(selectList.mock.calls[0].arguments, ['main-list']);
    assert.deepStrictEqual(focusAlbum.mock.calls[0].arguments, [
      'main-list',
      'album-1',
    ]);
  });

  it('focuses an album without reselecting an already active list', async () => {
    const selectList = mock.fn();
    const focusAlbum = mock.fn();
    const navigation = createAppAlbumNavigation({
      getLists: () => ({ 'main-list': {} }),
      getListData: () => [{ albumId: 'album-1' }],
      getCurrentListId: () => 'main-list',
      selectList,
      focusAlbum,
    });

    const result = await navigation.openAlbum({
      listId: 'main-list',
      albumId: 'album-1',
    });

    assert.deepStrictEqual(result, { handled: true, highlighted: true });
    assert.strictEqual(selectList.mock.calls.length, 0);
    assert.strictEqual(focusAlbum.mock.calls.length, 1);
  });

  it('does not acknowledge unavailable lists or albums', async () => {
    const baseDeps = {
      getLists: () => ({ 'main-list': {} }),
      getCurrentListId: () => 'main-list',
      selectList: mock.fn(),
      focusAlbum: mock.fn(),
    };
    const navigation = createAppAlbumNavigation({
      ...baseDeps,
      getListData: () => [],
    });

    assert.deepStrictEqual(
      await navigation.openAlbum({
        listId: 'missing-list',
        albumId: 'album-1',
      }),
      { handled: false, reason: 'list-not-found' }
    );
    assert.deepStrictEqual(
      await navigation.openAlbum({
        listId: 'main-list',
        albumId: 'missing-album',
      }),
      { handled: false, reason: 'album-not-found' }
    );
  });
});
