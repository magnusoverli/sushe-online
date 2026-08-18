const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  publishAlbumMetadataUpdate,
} = require('../services/album-metadata-publisher');

describe('album-metadata-publisher', () => {
  it('invalidates affected users and broadcasts an incremental patch', async () => {
    const db = {
      raw: mock.fn(async () => ({
        rows: [
          {
            user_id: 'user-1',
            album_id: 'album-1',
            country: 'Sweden',
            metadata_version: '42',
          },
          {
            user_id: 'user-2',
            album_id: 'album-1',
            country: 'Sweden',
            metadata_version: '42',
          },
        ],
      })),
    };
    const responseCache = { invalidate: mock.fn() };
    const albumMetadataUpdated = mock.fn();
    const patch = { country: 'Norway' };

    const count = await publishAlbumMetadataUpdate({
      db,
      responseCache,
      broadcast: { albumMetadataUpdated },
      logger: { warn: mock.fn() },
      albumId: 'album-1',
      patch,
      operation: 'test',
    });

    assert.strictEqual(count, 2);
    assert.deepStrictEqual(
      responseCache.invalidate.mock.calls.map((call) => call.arguments[0]),
      [':user-1', ':user-2']
    );
    assert.deepStrictEqual(albumMetadataUpdated.mock.calls[0].arguments, [
      'user-1',
      'album-1',
      { country: 'Sweden' },
      '42',
    ]);
    assert.match(db.raw.mock.calls[0].arguments[0], /FOR UPDATE/);
    assert.match(
      db.raw.mock.calls[0].arguments[0],
      /album_metadata_event_version_seq/
    );
  });

  it('contains lookup failures so enrichment queues can continue', async () => {
    const warn = mock.fn();
    const count = await publishAlbumMetadataUpdate({
      db: { raw: mock.fn(async () => Promise.reject(new Error('db down'))) },
      logger: { warn },
      albumId: 'album-1',
      patch: { country: 'Norway' },
      operation: 'test',
    });

    assert.strictEqual(count, 0);
    assert.strictEqual(warn.mock.calls.length, 1);
  });
});
