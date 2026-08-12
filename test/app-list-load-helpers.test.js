const { describe, it, before } = require('node:test');
const assert = require('node:assert');

describe('app-list-load-helpers module', () => {
  let fetchCoreList;

  before(async () => {
    const module = await import('../src/js/modules/app-list-load-helpers.js');
    fetchCoreList = module.fetchCoreList;
  });

  it('forwards request options to the core and fallback requests', async () => {
    const signal = new AbortController().signal;
    const options = { signal, headers: { 'X-Test': 'true' } };
    const calls = [];

    const payload = await fetchCoreList(
      async (...args) => {
        calls.push(args);
        if (calls.length === 1) throw new Error('core unavailable');
        return [{ album_id: 'full' }];
      },
      'list/1',
      options
    );

    assert.deepStrictEqual(calls, [
      ['/api/lists/list%2F1?profile=core', options],
      ['/api/lists/list%2F1', options],
    ]);
    assert.deepStrictEqual(payload, {
      items: [{ album_id: 'full' }],
      profile: 'full',
    });
  });

  it('does not turn an aborted core request into a fallback request', async () => {
    const calls = [];
    const error = new Error('aborted');
    error.name = 'AbortError';

    await assert.rejects(
      fetchCoreList(async (...args) => {
        calls.push(args);
        throw error;
      }, 'list-1'),
      { name: 'AbortError' }
    );

    assert.strictEqual(calls.length, 1);
  });
});
