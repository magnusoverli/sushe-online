const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const realtimeOrigin = require('../middleware/realtime-origin');
const { getRealtimeOrigin } = require('../utils/realtime-origin');
const { createBroadcast } = require('../utils/websocket');
const {
  createListMutationPublisher,
} = require('../services/list/mutation-publisher');
const {
  withListTransaction,
  registerListMutationPublisher,
  recordListContentChange,
} = require('../services/list/transaction');

function requestOrigin(socketId, callback, method = 'POST') {
  return realtimeOrigin(
    { method, get: () => socketId },
    new EventEmitter(),
    callback
  );
}

function broadcasts() {
  const events = [];
  const io = {
    to: (room) => {
      let excluded;
      const target = {
        except: (socketId) => {
          excluded = socketId;
          return target;
        },
        emit: (event, payload) =>
          events.push({ room, excluded, event, payload }),
      };
      return target;
    },
    emit() {},
  };
  return { events, broadcast: createBroadcast(() => io, { debug() {} }) };
}

test('all list notifications share origin filtering; enrichment still reaches the origin', async () => {
  const { events, broadcast } = broadcasts();
  await requestOrigin('origin-tab', async () => {
    await Promise.resolve();
    broadcast.listUpdated('owner', 'list');
    broadcast.listReordered('owner', 'list', []);
    broadcast.listCreated('owner', 'list', 'New', 2026);
    broadcast.listRenamed('owner', 'list', 'Old', 'New');
    broadcast.listDeleted('owner', 'list');
    broadcast.listMainChanged('owner', 'list', true);
    broadcast.libraryUpdated('owner');
    broadcast.albumMetadataUpdated('owner', 'album', { country: 'Norway' });
  });
  assert.equal(events.length, 8);
  for (const event of events.slice(0, -1)) {
    assert.equal(event.room, 'user:owner');
    assert.equal(event.excluded, 'origin-tab');
  }
  assert.equal(events.at(-1).excluded, undefined);
  broadcast.listUpdated('owner', 'list');
  assert.equal(events.at(-1).excluded, undefined);
});

test('overlapping requests keep their own origin through transaction publication', async () => {
  const { events, broadcast } = broadcasts();
  const db = {
    withTransaction: async (callback) =>
      callback({ query: async () => ({ rows: [] }) }),
  };
  registerListMutationPublisher(
    db,
    createListMutationPublisher({
      responseCache: { invalidate() {} },
      aggregateList: { scheduleRecompute() {} },
      getBroadcast: () => broadcast,
      logger: {
        error: (message) => {
          throw new Error(message);
        },
      },
    })
  );
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = requestOrigin('tab-a', () =>
    withListTransaction(db, 'user-a', async (client) => {
      await gate;
      recordListContentChange(client, { _id: 'list-a', revision: '1' });
    })
  );
  await requestOrigin('tab-b', () =>
    withListTransaction(db, 'user-b', async (client) => {
      recordListContentChange(client, { _id: 'list-b', revision: '2' });
    })
  );
  release();
  await first;
  assert.deepEqual(
    events.map(({ room, excluded }) => ({ room, excluded })),
    [
      { room: 'user:user-b', excluded: 'tab-b' },
      { room: 'user:user-a', excluded: 'tab-a' },
    ]
  );
});

test('finished requests release inherited origins and invalid or read-only headers do not suppress events', async () => {
  const response = new EventEmitter();
  await realtimeOrigin(
    { method: 'PATCH', get: () => 'tab' },
    response,
    async () => {
      assert.equal(getRealtimeOrigin(), 'tab');
      response.emit('finish');
      await Promise.resolve();
      assert.equal(getRealtimeOrigin(), undefined);
    }
  );
  for (const header of [undefined, ['tab'], 'bad header', 'x'.repeat(129)]) {
    requestOrigin(header, () => assert.equal(getRealtimeOrigin(), undefined));
  }
  requestOrigin(
    'tab',
    () => assert.equal(getRealtimeOrigin(), undefined),
    'GET'
  );
});
