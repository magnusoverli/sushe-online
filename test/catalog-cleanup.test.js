const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { createCatalogCleanupService } = require('../services/catalog-cleanup');

function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
}

describe('catalog cleanup service', () => {
  it('builds cleanup preview with orphan counts and samples', async () => {
    const query = mock.fn(async (sql) => {
      if (sql.includes('FROM pg_tables')) {
        return {
          rows: [
            { tablename: 'list_items' },
            { tablename: 'recommendations' },
            { tablename: 'album_service_mappings' },
            { tablename: 'artist_service_aliases' },
            { tablename: 'user_album_stats' },
            { tablename: 'album_distinct_pairs' },
          ],
        };
      }

      if (sql.includes('FROM user_album_stats uas')) {
        return { rows: [{ count: 2 }] };
      }

      if (sql.includes('FROM album_distinct_pairs adp')) {
        return { rows: [{ count: 1 }] };
      }

      if (
        sql.includes('FROM albums a') &&
        sql.includes('COUNT(*)::int AS count')
      ) {
        return { rows: [{ count: 12 }] };
      }

      if (sql.includes('SELECT a.album_id, a.artist, a.album, a.created_at')) {
        return {
          rows: [
            {
              album_id: 'internal-a',
              artist: 'Artist A',
              album: 'Album A',
              created_at: new Date('2024-01-01T00:00:00Z'),
            },
          ],
        };
      }

      return { rows: [] };
    });

    const service = createCatalogCleanupService({
      pool: { query },
      logger: createMockLogger(),
    });

    const preview = await service.getPreview({
      minAgeDays: 45,
      sampleLimit: 5,
    });

    assert.strictEqual(preview.minAgeDays, 45);
    assert.strictEqual(preview.orphanAlbums, 12);
    assert.strictEqual(preview.userAlbumStatsReferences, 2);
    assert.strictEqual(preview.distinctPairReferences, 1);
    assert.strictEqual(preview.sampleAlbums.length, 1);
    assert.strictEqual(query.mock.calls.length > 0, true);
  });

  it('aborts execute when preview count is stale', async () => {
    const query = mock.fn(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes('FROM pg_tables')) {
        return { rows: [{ tablename: 'list_items' }] };
      }

      if (sql.includes('DROP TABLE IF EXISTS cleanup_album_targets')) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes('CREATE TEMP TABLE cleanup_album_targets')) {
        return { rows: [], rowCount: 0 };
      }

      if (
        sql.includes('SELECT COUNT(*)::int AS count FROM cleanup_album_targets')
      ) {
        return { rows: [{ count: 3 }] };
      }

      return { rows: [], rowCount: 0 };
    });

    const client = {
      query,
      release: mock.fn(),
    };

    const service = createCatalogCleanupService({
      pool: {
        query,
        connect: async () => client,
      },
      logger: createMockLogger(),
    });

    await assert.rejects(
      async () => {
        await service.executeCleanup({
          minAgeDays: 30,
          expectedDeleteCount: 2,
        });
      },
      (error) => error.code === 'CATALOG_CLEANUP_STALE_PREVIEW'
    );
  });
});
