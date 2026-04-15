const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createFakeSocket() {
  const handlers = new Map();

  return {
    id: 'socket-test-1',
    io: {
      engine: {
        transport: {
          name: 'websocket',
        },
      },
    },
    emitted: [],
    on(event, handler) {
      const current = handlers.get(event) || [];
      current.push(handler);
      handlers.set(event, current);
      return this;
    },
    emit(event, payload) {
      this.emitted.push({ event, payload });
    },
    disconnect() {},
    connect() {},
    async trigger(event, payload) {
      const listeners = handlers.get(event) || [];
      for (const listener of listeners) {
        await listener(payload);
      }
    },
  };
}

describe('realtime-sync module', () => {
  let createRealtimeSync;

  beforeEach(async () => {
    const module = await import('../src/js/modules/realtime-sync.js');
    createRealtimeSync = module.createRealtimeSync;
  });

  it('refreshes current list on list:updated when listId matches', async () => {
    const fakeSocket = createFakeSocket();
    const refreshCalls = [];
    const navCalls = [];
    const toasts = [];

    const sync = createRealtimeSync({
      ioFactory: () => fakeSocket,
      getCurrentList: () => 'list-1',
      refreshListData: async (listId) => {
        refreshCalls.push(listId);
        return { wasLocalSave: false };
      },
      refreshListNav: () => navCalls.push('called'),
      showToast: (...args) => toasts.push(args),
    });

    sync.connect();
    await fakeSocket.trigger('list:updated', {
      listId: 'list-1',
      updatedAt: new Date().toISOString(),
    });

    assert.deepStrictEqual(refreshCalls, ['list-1']);
    assert.deepStrictEqual(navCalls, []);
    assert.deepStrictEqual(toasts, [
      ['List updated from another device', 'info'],
    ]);
  });

  it('refreshes sidebar for list:updated when another list changes', async () => {
    const fakeSocket = createFakeSocket();
    const refreshCalls = [];
    const navCalls = [];

    const sync = createRealtimeSync({
      ioFactory: () => fakeSocket,
      getCurrentList: () => 'list-1',
      refreshListData: async (listId) => {
        refreshCalls.push(listId);
      },
      refreshListNav: () => navCalls.push('called'),
      showToast: () => {},
    });

    sync.connect();
    await fakeSocket.trigger('list:updated', {
      listId: 'list-2',
      updatedAt: new Date().toISOString(),
    });

    assert.deepStrictEqual(refreshCalls, []);
    assert.deepStrictEqual(navCalls, ['called']);
  });

  it('ignores list:reordered payloads that do not include listId', async () => {
    const fakeSocket = createFakeSocket();
    const refreshCalls = [];

    const sync = createRealtimeSync({
      ioFactory: () => fakeSocket,
      getCurrentList: () => 'list-1',
      refreshListData: async (listId) => {
        refreshCalls.push(listId);
      },
    });

    sync.connect();
    await fakeSocket.trigger('list:reordered', {
      listName: 'list-1',
      order: ['a', 'b'],
    });

    assert.deepStrictEqual(refreshCalls, []);
  });

  it('refreshes current list on list:reordered when listId matches', async () => {
    const fakeSocket = createFakeSocket();
    const refreshCalls = [];

    const sync = createRealtimeSync({
      ioFactory: () => fakeSocket,
      getCurrentList: () => 'list-1',
      refreshListData: async (listId) => {
        refreshCalls.push(listId);
      },
    });

    sync.connect();
    await fakeSocket.trigger('list:reordered', {
      listId: 'list-1',
      order: ['a', 'b'],
      reorderedAt: new Date().toISOString(),
    });

    assert.deepStrictEqual(refreshCalls, ['list-1']);
  });

  it('rebuilds current list display on list:main-changed using listId', async () => {
    const fakeSocket = createFakeSocket();
    const displayCalls = [];
    const navCalls = [];
    const albums = [{ album_id: 'album-1' }];

    const sync = createRealtimeSync({
      ioFactory: () => fakeSocket,
      getCurrentList: () => 'list-1',
      getListData: () => albums,
      refreshListNav: () => navCalls.push('called'),
      displayAlbums: (data, options) => displayCalls.push([data, options]),
    });

    sync.connect();
    await fakeSocket.trigger('list:main-changed', {
      listId: 'list-1',
      isMain: true,
      changedAt: new Date().toISOString(),
    });

    assert.deepStrictEqual(navCalls, ['called']);
    assert.deepStrictEqual(displayCalls, [
      [albums, { forceFullRebuild: true }],
    ]);
  });

  it('ignores list:created events without canonical listId', async () => {
    const fakeSocket = createFakeSocket();
    const navCalls = [];
    const toasts = [];

    const sync = createRealtimeSync({
      ioFactory: () => fakeSocket,
      refreshListNav: () => navCalls.push('called'),
      showToast: (...args) => toasts.push(args),
      logger: { warn: () => {} },
    });

    sync.connect();
    await fakeSocket.trigger('list:created', {
      listName: 'Missing ID',
    });

    assert.deepStrictEqual(navCalls, []);
    assert.deepStrictEqual(toasts, []);
  });

  it('registers list listeners once across reconnect events', async () => {
    const fakeSocket = createFakeSocket();
    const refreshCalls = [];

    const sync = createRealtimeSync({
      ioFactory: () => fakeSocket,
      getCurrentList: () => 'list-1',
      refreshListData: async (listId) => {
        refreshCalls.push(listId);
      },
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
      debug: true,
    });

    sync.connect();
    await fakeSocket.trigger('connect');
    await fakeSocket.trigger('list:updated', {
      listId: 'list-1',
      updatedAt: new Date().toISOString(),
    });

    assert.deepStrictEqual(refreshCalls, ['list-1']);
  });
});
