const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { createHelpers } = require('../routes/api/_helpers');
const {
  createListItemOperations,
} = require('../services/list/item-operations');
const {
  createListWriteOperations,
} = require('../services/list/write-operations');
const { TransactionAbort } = require('../db/transaction');
const { createMockLogger } = require('./helpers');
const coverQueueModule = require('../services/cover-fetch-queue');
const trackQueueModule = require('../services/track-fetch-queue');
const nativeQueueModule = require('../services/native-name-queue');
const availabilityQueueModule = require('../services/availability-fetch-queue');

const albumId = '12345678-1234-1234-1234-123456789abc';
const preparedCover = {
  buffer: Buffer.from('explicit cover'),
  format: 'JPEG',
  thumbnailBuffer: Buffer.from('explicit thumbnail'),
  thumbnailFormat: 'JPEG',
};

function setupListWrite(t, failCommit = false) {
  const events = [];
  const queues = {};
  for (const [kind, module, getter] of [
    ['cover-fetch', coverQueueModule, 'getCoverFetchQueue'],
    ['track-fetch', trackQueueModule, 'getTrackFetchQueue'],
    ['native-name', nativeQueueModule, 'getNativeNameQueue'],
    [
      'availability-fetch',
      availabilityQueueModule,
      'getAvailabilityFetchQueue',
    ],
  ]) {
    const queue = { add: mock.fn(() => events.push('dispatch')) };
    t.mock.method(module, getter, () => queue);
    queues[kind] = queue;
  }
  const client = {
    query: mock.fn(async (sql) => {
      if (sql.startsWith('SELECT revision FROM lists'))
        return { rows: [{ revision: '1' }] };
      if (sql.includes('SET cover_image = $1')) {
        events.push('upload');
        return { rows: [{ album_id: albumId }], rowCount: 1 };
      }
      if (sql.includes('COALESCE(MAX(')) {
        return { rows: [{ max_pos: 0, next_order: 0 }] };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
  const db = {
    raw: client.query,
    withTransaction: async (fn) => {
      events.push('BEGIN');
      const result = await fn(client);
      if (failCommit) throw new Error('commit failed');
      events.push('COMMIT');
      return result;
    },
  };
  const logger = createMockLogger();
  const crypto = { randomBytes: () => Buffer.from('123456789012') };
  const fetchSummaryAsync = mock.fn(() => events.push('dispatch'));
  const helpers = createHelpers({
    db,
    logger,
    crypto,
    app: { locals: { albumSummaryService: { fetchSummaryAsync } } },
  });
  const canonicalResult = {
    albumId,
    needsCoverFetch: true,
    needsTracksFetch: false,
    needsSummaryFetch: false,
    wasInserted: false,
  };
  t.mock.method(
    helpers.albumCanonical,
    'batchUpsertCanonical',
    async (albums) => {
      events.push('upsert');
      assert.ok(albums.every((album) => !Object.hasOwn(album, 'cover_image')));
      return new Map(
        albums.map((album) => [
          `${album.artist}|${album.album}`,
          { ...canonicalResult },
        ])
      );
    }
  );
  const dispatch = mock.fn((items) => {
    assert.equal(events.at(-1), 'COMMIT');
    helpers.triggerAlbumBackgroundFetches(items);
  });
  const operations = createListWriteOperations({
    db,
    logger,
    crypto,
    TransactionAbort,
    itemOperations: createListItemOperations({ db, crypto, ...helpers }),
    managementOperations: { checkDuplicateListName: async () => {} },
    triggerAlbumBackgroundFetches: dispatch,
    findListByIdOrThrow: async () => ({
      _id: 'list-1',
      revision: '0',
      year: 2026,
      is_main: false,
    }),
    findOrCreateYearGroup: async () => ({ groupId: 1, year: 2026 }),
    findOrCreateUncategorizedGroup: async () => 1,
    acquireYearLocks: async () => {},
    validateMainListNotLocked: async () => {},
  });
  return {
    operations,
    helpers,
    queues,
    events,
    dispatch,
    fetchSummaryAsync,
    client,
    canonicalResult,
  };
}

describe('post-commit enrichment flags', () => {
  const writes = {
    create: (ops, albums) => ops.createList('user-1', { name: 'List', albums }),
    replace: (ops, albums) =>
      ops.replaceListItems('list-1', 'user-1', albums, '0'),
    incremental: (ops, albums) =>
      ops.incrementalUpdate('list-1', 'user-1', { added: albums }, {}),
  };

  for (const [name, write] of Object.entries(writes)) {
    for (const upload of [false, true]) {
      it(`${name} carries needs flags through commit${upload ? ' and preserves uploads' : ''}`, async (t) => {
        const state = setupListWrite(t);
        const album = { artist: 'Artist', album: 'Album' };
        if (upload) album.cover_image = preparedCover;
        await write(state.operations, [album]);
        assert.equal(state.dispatch.mock.calls.length, 1);
        assert.deepEqual(state.dispatch.mock.calls[0].arguments[0], [
          {
            album_id: albumId,
            artist: 'Artist',
            album: 'Album',
            needsCoverFetch: !upload,
            needsTracksFetch: false,
            needsSummaryFetch: false,
            wasInserted: false,
          },
        ]);
        assert.equal(
          state.queues['cover-fetch'].add.mock.calls.length,
          upload ? 0 : 1
        );
        assert.equal(state.queues['track-fetch'].add.mock.calls.length, 0);
        assert.equal(state.fetchSummaryAsync.mock.calls.length, 0);
        assert.equal(state.queues['native-name'].add.mock.calls.length, 0);
        assert.equal(
          state.queues['availability-fetch'].add.mock.calls.length,
          1
        );
        if (upload)
          assert.ok(
            state.events.indexOf('upload') < state.events.indexOf('COMMIT')
          );
      });
    }

    it(`${name} does not dispatch if commit fails`, async (t) => {
      const state = setupListWrite(t, true);
      await assert.rejects(
        write(state.operations, [{ artist: 'Artist', album: 'Album' }]),
        /commit failed/
      );
      assert.equal(state.dispatch.mock.calls.length, 0);
      assert.ok(!state.events.includes('dispatch'));
    });
  }

  it('suppresses cover jobs for all aliases of an explicitly covered canonical album', async (t) => {
    const state = setupListWrite(t);
    await state.operations.replaceListItems(
      'list-1',
      'user-1',
      [
        { artist: 'Artist', album: 'Alias' },
        { artist: 'Artist', album: 'Album', cover_image: preparedCover },
      ],
      '0'
    );
    assert.ok(
      state.dispatch.mock.calls[0].arguments[0].every(
        (item) => item.needsCoverFetch === false
      )
    );
    assert.equal(state.queues['cover-fetch'].add.mock.calls.length, 0);
  });

  it('dispatches missing tracks, summary and native-name work once per album', async (t) => {
    const state = setupListWrite(t);
    Object.assign(state.canonicalResult, {
      needsCoverFetch: false,
      needsTracksFetch: true,
      needsSummaryFetch: true,
      wasInserted: true,
    });
    await state.operations.incrementalUpdate(
      'list-1',
      'user-1',
      {
        added: [
          { artist: 'Artist', album: 'Album' },
          { artist: 'Artist', album: 'Album' },
        ],
      },
      {}
    );
    assert.equal(state.queues['cover-fetch'].add.mock.calls.length, 0);
    assert.equal(state.queues['track-fetch'].add.mock.calls.length, 1);
    assert.equal(state.fetchSummaryAsync.mock.calls.length, 1);
    assert.equal(state.queues['native-name'].add.mock.calls.length, 1);
  });

  it('keeps single-upsert string IDs and nontransactional enrichment compatible', async (t) => {
    const state = setupListWrite(t);
    t.mock.method(
      state.helpers.albumCanonical,
      'upsertCanonical',
      async () => ({ ...state.canonicalResult })
    );
    const album = { artist: 'Artist', album: 'Album' };
    assert.equal(
      await state.helpers.upsertAlbumRecord(album, new Date(), state.client),
      albumId
    );
    assert.equal(state.queues['cover-fetch'].add.mock.calls.length, 0);
    assert.equal(
      await state.helpers.upsertAlbumRecord(album, new Date()),
      albumId
    );
    assert.equal(state.queues['cover-fetch'].add.mock.calls.length, 1);
    const results = await state.helpers.batchUpsertAlbumRecords(
      [album],
      new Date()
    );
    assert.equal(results.get('Artist|Album').albumId, albumId);
    assert.equal(state.queues['cover-fetch'].add.mock.calls.length, 2);
    assert.equal(state.queues['track-fetch'].add.mock.calls.length, 0);
  });
});

describe('background worker preservation', () => {
  for (const [kind, field, createQueue, run] of [
    [
      'cover',
      'cover_image',
      coverQueueModule.createCoverFetchQueue,
      'fetchAndStoreCover',
    ],
    [
      'track',
      'tracks',
      trackQueueModule.createTrackFetchQueue,
      'fetchAndStoreTracks',
    ],
  ]) {
    it(`${kind} skips populated and deleted records before calling providers`, async () => {
      const raw = mock.fn(async (sql, params) => {
        assert.match(
          sql,
          new RegExp(
            `^SELECT album_id FROM albums WHERE album_id = \\$1 AND ${field} IS NULL$`
          )
        );
        assert.deepEqual(params, [albumId]);
        return { rows: [], rowCount: 0 };
      });
      const fetch = mock.fn();
      const queue = createQueue({
        db: { raw },
        fetch,
        logger: createMockLogger(),
      });
      await queue.add(albumId, 'Artist', 'Album');
      assert.equal(raw.mock.calls.length, 1);
      assert.equal(fetch.mock.calls.length, 0);
    });

    for (const race of ['explicit edit', 'duplicate workers']) {
      it(`${kind} conditional store preserves the winner of ${race}`, async () => {
        const image = await sharp({
          create: { width: 10, height: 10, channels: 3, background: '#123456' },
        })
          .jpeg()
          .toBuffer();
        let stored = null;
        let writes = 0;
        let releaseReads;
        const readsReady = new Promise((resolve) => {
          releaseReads = resolve;
        });
        let reads = 0;
        const workers = race === 'duplicate workers' ? 2 : 1;
        const raw = mock.fn(async (sql, params) => {
          if (sql.startsWith('SELECT album_id')) {
            reads++;
            if (reads === workers) releaseReads();
            await readsReady;
            return { rows: [{ album_id: albumId }], rowCount: 1 };
          }
          if (sql.startsWith('UPDATE albums')) {
            assert.match(
              sql,
              new RegExp(`WHERE album_id = \\$\\d+ AND ${field} IS NULL`)
            );
            if (stored !== null) return { rows: [], rowCount: 0 };
            stored = params[0];
            writes++;
            return { rows: [{ album_id: albumId }], rowCount: 1 };
          }
          assert.match(sql, /SELECT DISTINCT l.user_id/);
          return { rows: [{ user_id: 'user-1' }], rowCount: 1 };
        });
        const fetch = mock.fn(async (url) => {
          if (race === 'explicit edit') stored = 'explicit value';
          if (url.includes('coverartarchive.org'))
            return { ok: true, arrayBuffer: async () => image };
          if (url.includes('api.deezer.com/search'))
            return { ok: true, json: async () => ({ data: [{ id: 1 }] }) };
          if (url.includes('api.deezer.com/album'))
            return {
              ok: true,
              json: async () => ({
                tracks: { data: [{ title: 'Fetched track' }] },
              }),
            };
          return { ok: false };
        });
        const coverCache = { invalidateAlbum: mock.fn() };
        const responseCache = { invalidate: mock.fn() };
        const broadcast = { albumMetadataUpdated: mock.fn() };
        const queue = createQueue({
          db: { raw },
          fetch,
          coverCache,
          responseCache,
          broadcast,
          logger: createMockLogger(),
        });
        await Promise.all(
          Array.from({ length: workers }, () =>
            queue[run](albumId, 'Artist', 'Album')
          )
        );
        const expectedWrites = race === 'explicit edit' ? 0 : 1;
        assert.equal(writes, expectedWrites);
        if (race === 'explicit edit') assert.equal(stored, 'explicit value');
        assert.equal(
          raw.mock.calls.filter((call) =>
            call.arguments[0].startsWith('UPDATE albums')
          ).length,
          workers
        );
        assert.equal(
          broadcast.albumMetadataUpdated.mock.calls.length,
          expectedWrites
        );
        assert.equal(
          responseCache.invalidate.mock.calls.length,
          expectedWrites
        );
        if (kind === 'cover')
          assert.equal(
            coverCache.invalidateAlbum.mock.calls.length,
            expectedWrites
          );
      });
    }
  }
});
