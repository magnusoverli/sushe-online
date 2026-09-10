const { test } = require('node:test');
const assert = require('node:assert/strict');

test('library updates await new metadata before rebuilding main-list layout', async () => {
  const { createRealtimeSync } =
    await import('../src/js/modules/realtime-sync.js');
  const handlers = {};
  const events = [];
  let release;
  const metadata = new Promise((resolve) => {
    release = resolve;
  });
  const socket = {
    on: (event, handler) => {
      handlers[event] = handler;
    },
    disconnect() {},
  };
  const sync = createRealtimeSync({
    ioFactory: () => socket,
    getCurrentList: () => 'list',
    refreshListNav: async () => {
      events.push('metadata-start');
      await metadata;
      events.push('metadata-ready');
      return true;
    },
    refreshListDataSilent: async (id) => events.push(`layout:${id}`),
    refreshListData: async () => events.push('incremental'),
  });
  sync.connect();
  const updating = handlers['library:updated']();
  assert.deepEqual(events, ['metadata-start']);
  release();
  await updating;
  assert.deepEqual(events, ['metadata-start', 'metadata-ready', 'layout:list']);
  sync.disconnect();
});
