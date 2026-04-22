const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

describe('list-menu-shared module', () => {
  let buildListMenuConfig;
  let createListMenuActions;

  beforeEach(async () => {
    const module = await import('../src/js/modules/list-menu-shared.js');
    buildListMenuConfig = module.buildListMenuConfig;
    createListMenuActions = module.createListMenuActions;
  });

  it('builds menu config with preferred music service label', () => {
    const config = buildListMenuConfig({
      listMeta: { year: 2024, isMain: false },
      groups: [],
      currentUser: {
        spotifyAuth: true,
        tidalAuth: false,
        musicService: 'spotify',
      },
    });

    assert.strictEqual(config.hasYear, true);
    assert.strictEqual(config.mainToggleText, 'Set as Main');
    assert.strictEqual(config.musicServiceText, 'Send to Spotify');
    assert.strictEqual(config.hasSpotify, true);
    assert.strictEqual(config.hasTidal, false);
  });

  it('derives year-group and collection flags from groups', () => {
    const config = buildListMenuConfig({
      listMeta: { groupId: 'group-2020' },
      groups: [{ _id: 'group-2020', isYearGroup: true }],
      currentUser: {},
    });

    assert.strictEqual(config.hasYear, true);
    assert.strictEqual(config.isInCollection, false);
  });

  it('marks orphaned lists as movable between collections', () => {
    const config = buildListMenuConfig({
      listMeta: { groupId: null },
      groups: [],
      currentUser: {},
    });

    assert.strictEqual(config.isInCollection, true);
  });

  it('routes rename, toggle, and downloads through shared actions', async () => {
    const calls = [];
    const actions = createListMenuActions({
      getListData: () => [{ album: 'One' }],
      updatePlaylist: async (listId, listData) => {
        calls.push(['updatePlaylist', listId, listData.length]);
      },
      downloadListAsJSON: (listId) => calls.push(['json', listId]),
      downloadListAsPDF: (listId) => calls.push(['pdf', listId]),
      downloadListAsCSV: (listId) => calls.push(['csv', listId]),
      openRenameModal: (listId) => calls.push(['rename', listId]),
      toggleMainStatus: (listId) => calls.push(['toggle-main', listId]),
      logger: { error: () => {} },
    });

    actions.renameList('list-a');
    actions.toggleMainForList('list-a');
    actions.downloadList('list-a', 'json');
    actions.downloadList('list-a', 'pdf');
    actions.downloadList('list-a', 'csv');
    await actions.sendToMusicService('list-a');

    assert.deepStrictEqual(calls, [
      ['rename', 'list-a'],
      ['toggle-main', 'list-a'],
      ['json', 'list-a'],
      ['pdf', 'list-a'],
      ['csv', 'list-a'],
      ['updatePlaylist', 'list-a', 1],
    ]);
  });

  it('logs send-to-service errors without throwing', async () => {
    const logger = { error: mock.fn() };
    const actions = createListMenuActions({
      getListData: () => [],
      updatePlaylist: async () => {
        throw new Error('failed');
      },
      downloadListAsJSON: () => {},
      downloadListAsPDF: () => {},
      downloadListAsCSV: () => {},
      openRenameModal: () => {},
      toggleMainStatus: () => {},
      logger,
    });

    await assert.doesNotReject(() => actions.sendToMusicService('list-a'));
    assert.strictEqual(logger.error.mock.calls.length, 1);
  });
});
