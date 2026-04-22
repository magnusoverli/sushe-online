const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

describe('app-main-status module', () => {
  let createMainStatusToggler;

  beforeEach(async () => {
    const module = await import('../src/js/modules/app-main-status.js');
    createMainStatusToggler = module.createMainStatusToggler;
  });

  it('shows validation error when list is not in a year context', async () => {
    const showToast = mock.fn();
    const toggleMainStatus = createMainStatusToggler({
      getListMetadata: () => ({ _id: 'list-1', name: 'List 1', groupId: null }),
      getSortedGroups: () => [],
      showToast,
      apiCall: async () => ({}),
      updateListMetadata: () => {},
      updateListNav: () => {},
      getCurrentListId: () => 'list-1',
      getListData: () => [],
      displayAlbums: () => {},
      logger: { error: () => {} },
    });

    await toggleMainStatus('list-1');

    assert.strictEqual(showToast.mock.calls.length, 1);
    assert.deepStrictEqual(showToast.mock.calls[0].arguments, [
      'List must be in a year category to be marked as main',
      'error',
    ]);
  });

  it('updates metadata and rerenders current list on success', async () => {
    const updateListMetadata = mock.fn();
    const updateListNav = mock.fn();
    const displayAlbums = mock.fn();
    const showToast = mock.fn();

    const toggleMainStatus = createMainStatusToggler({
      getListMetadata: (listId) => ({
        _id: listId,
        name: 'List 1',
        year: 2024,
        isMain: false,
        groupId: 'year-group',
      }),
      getSortedGroups: () => [{ _id: 'year-group', isYearGroup: true }],
      showToast,
      apiCall: async () => ({
        previousMainListId: 'list-old',
        previousMainList: 'Old Main',
      }),
      updateListMetadata,
      updateListNav,
      getCurrentListId: () => 'list-1',
      getListData: () => [{ album: 'A' }],
      displayAlbums,
      logger: { error: () => {} },
    });

    await toggleMainStatus('list-1');

    assert.strictEqual(updateListMetadata.mock.calls.length, 2);
    assert.deepStrictEqual(updateListMetadata.mock.calls[0].arguments, [
      'list-1',
      { isMain: true },
    ]);
    assert.deepStrictEqual(updateListMetadata.mock.calls[1].arguments, [
      'list-old',
      { isMain: false },
    ]);
    assert.strictEqual(updateListNav.mock.calls.length, 1);
    assert.strictEqual(displayAlbums.mock.calls.length, 1);
    assert.strictEqual(showToast.mock.calls.length, 1);
  });

  it('shows error toast when API update fails', async () => {
    const showToast = mock.fn();
    const logger = { error: mock.fn() };

    const toggleMainStatus = createMainStatusToggler({
      getListMetadata: () => ({
        _id: 'list-1',
        name: 'List 1',
        year: 2024,
        isMain: false,
      }),
      getSortedGroups: () => [],
      showToast,
      apiCall: async () => {
        throw new Error('failed');
      },
      updateListMetadata: () => {},
      updateListNav: () => {},
      getCurrentListId: () => 'list-1',
      getListData: () => [],
      displayAlbums: () => {},
      logger,
    });

    await toggleMainStatus('list-1');

    assert.strictEqual(logger.error.mock.calls.length, 1);
    assert.deepStrictEqual(showToast.mock.calls[0].arguments, [
      'Error updating main status',
      'error',
    ]);
  });
});
