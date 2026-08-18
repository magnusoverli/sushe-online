const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { createNativeNameQueue } = require('../services/native-name-queue');

describe('native-name-queue', () => {
  it('publishes native spelling after a successful rewrite', async () => {
    const db = {
      raw: mock.fn(async (sql) => {
        if (sql.includes('SELECT DISTINCT l.user_id')) {
          return { rows: [{ user_id: 'user-1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const responseCache = { invalidate: mock.fn() };
    const albumMetadataUpdated = mock.fn();
    const queue = createNativeNameQueue({
      db,
      responseCache,
      broadcast: { albumMetadataUpdated },
      rateLimitMs: 0,
      logger: { info: mock.fn(), warn: mock.fn() },
      resolveNativeAlbumName: mock.fn(async () => ({
        action: 'rewrite',
        artist: 'Artíst',
        album: 'Álbum',
      })),
    });

    await queue.add('12345678-1234-1234-1234-123456789abc', 'Artist', 'Album');

    assert.deepStrictEqual(responseCache.invalidate.mock.calls[0].arguments, [
      ':user-1',
    ]);
    assert.deepStrictEqual(albumMetadataUpdated.mock.calls[0].arguments, [
      'user-1',
      '12345678-1234-1234-1234-123456789abc',
      { artist: 'Artíst', album: 'Álbum' },
    ]);
  });
});
