const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('list-reorder module', () => {
  let createListReorder;

  beforeEach(async () => {
    const module = await import('../src/js/modules/list-reorder.js');
    createListReorder = module.createListReorder;
  });

  it('skips api call when list data is missing', async () => {
    const apiCalls = [];
    const logs = [];
    const logger = {
      log: (...args) => logs.push(['log', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    };

    const { saveReorder } = createListReorder({
      apiCall: async (...args) => {
        apiCalls.push(args);
      },
      logger,
    });

    await saveReorder('list-1', null);

    assert.strictEqual(apiCalls.length, 0);
    assert.deepStrictEqual(logs[0], [
      'error',
      'List data not found:',
      'list-1',
    ]);
  });

  it('maps canonical ids and posts reorder payload', async () => {
    const apiCalls = [];
    const logs = [];

    const { saveReorder } = createListReorder({
      apiCall: async (...args) => {
        apiCalls.push(args);
      },
      logger: {
        log: (...args) => logs.push(['log', ...args]),
        error: (...args) => logs.push(['error', ...args]),
      },
    });

    await saveReorder('My List/2024', [
      { album_id: 'mbid-1' },
      { album_id: 'spotify-2' },
      { album_id: 'mbid-3' },
      { name: 'No ID' },
    ]);

    assert.deepStrictEqual(apiCalls[0], [
      '/api/lists/My%20List%2F2024/reorder',
      {
        method: 'POST',
        body: JSON.stringify({
          order: ['mbid-1', 'spotify-2', 'mbid-3', null],
        }),
      },
    ]);
    assert.deepStrictEqual(logs[0], [
      'log',
      'List reordered successfully:',
      'My List/2024',
    ]);
  });

  it('rethrows api errors after logging', async () => {
    const logs = [];
    const expectedError = new Error('request failed');

    const { saveReorder } = createListReorder({
      apiCall: async () => {
        throw expectedError;
      },
      logger: {
        log: () => {},
        error: (...args) => logs.push(args),
      },
    });

    await assert.rejects(() => saveReorder('list-2', [{ album_id: 'a1' }]), {
      message: 'request failed',
    });
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0][0], 'Error reordering list:');
    assert.strictEqual(logs[0][1], expectedError);
  });
});
