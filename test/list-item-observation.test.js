const { it, mock } = require('node:test');
const assert = require('node:assert');
const {
  createListItemOperations,
} = require('../services/list/item-operations');
const { createMockDb } = require('./helpers');

it('maps duplicate-name inputs to one canonical ID and applies both observations', async () => {
  const sourceObservationService = {
    apply: mock.fn(async (_client, albumId, _observation, options) => ({
      result: { albumId, index: options.index, status: 'applied' },
      warnings: [],
    })),
  };
  const client = {
    query: mock.fn(async (sql) => {
      if (sql.includes('COALESCE(MAX(position)')) {
        return { rows: [{ max_pos: 0 }] };
      }
      if (sql.includes('SELECT album_id, _id FROM list_items')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO list_items')) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }),
  };
  const operations = createListItemOperations({
    db: createMockDb(),
    crypto: { randomBytes: () => Buffer.from('123456789012') },
    upsertAlbumRecord: mock.fn(),
    batchUpsertAlbumRecords: mock.fn(
      async () => new Map([['Artist|Album', { albumId: 'canonical-1' }]])
    ),
    sourceObservationService,
  });

  const result = await operations.processAdditions(
    client,
    { _id: 'list-1' },
    [
      { artist: 'Artist', album: 'Album', sourceObservation: { first: true } },
      { artist: 'Artist', album: 'Album', sourceObservation: { second: true } },
    ],
    new Date()
  );

  assert.strictEqual(result.addedItems.length, 1);
  assert.strictEqual(result.duplicateAlbums.length, 1);
  assert.deepStrictEqual(
    result.sourceObservationResults.map(({ albumId, index }) => ({
      albumId,
      index,
    })),
    [
      { albumId: 'canonical-1', index: 0 },
      { albumId: 'canonical-1', index: 1 },
    ]
  );
  assert.strictEqual(sourceObservationService.apply.mock.calls.length, 2);
});
