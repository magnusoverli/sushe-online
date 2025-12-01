/**
 * Tests for user_preferences migration (014_add_user_preferences.js)
 * Tests the migration up/down functions with a mock pool
 */

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  up,
  down,
} = require('../db/migrations/migrations/014_add_user_preferences.js');

describe('014_add_user_preferences migration', () => {
  let mockPool;
  let executedQueries;

  beforeEach(() => {
    executedQueries = [];
    mockPool = {
      query: mock.fn((sql) => {
        executedQueries.push(sql);
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    };
  });

  describe('up()', () => {
    it('should create user_preferences table with all required columns', async () => {
      await up(mockPool);

      const createTableQuery = executedQueries.find((q) =>
        q.includes('CREATE TABLE')
      );
      assert.ok(createTableQuery, 'Should have CREATE TABLE query');

      // Check for required columns
      assert.ok(
        createTableQuery.includes('user_id TEXT NOT NULL'),
        'Should have user_id column'
      );
      assert.ok(
        createTableQuery.includes('top_genres JSONB'),
        'Should have top_genres column'
      );
      assert.ok(
        createTableQuery.includes('top_artists JSONB'),
        'Should have top_artists column'
      );
      assert.ok(
        createTableQuery.includes('top_countries JSONB'),
        'Should have top_countries column'
      );
      assert.ok(
        createTableQuery.includes('total_albums INTEGER'),
        'Should have total_albums column'
      );

      // Check for Spotify columns
      assert.ok(
        createTableQuery.includes('spotify_top_artists JSONB'),
        'Should have spotify_top_artists column'
      );
      assert.ok(
        createTableQuery.includes('spotify_top_tracks JSONB'),
        'Should have spotify_top_tracks column'
      );
      assert.ok(
        createTableQuery.includes('spotify_saved_albums JSONB'),
        'Should have spotify_saved_albums column'
      );
      assert.ok(
        createTableQuery.includes('spotify_synced_at TIMESTAMPTZ'),
        'Should have spotify_synced_at column'
      );

      // Check for Last.fm columns
      assert.ok(
        createTableQuery.includes('lastfm_top_artists JSONB'),
        'Should have lastfm_top_artists column'
      );
      assert.ok(
        createTableQuery.includes('lastfm_top_albums JSONB'),
        'Should have lastfm_top_albums column'
      );
      assert.ok(
        createTableQuery.includes('lastfm_total_scrobbles INTEGER'),
        'Should have lastfm_total_scrobbles column'
      );
      assert.ok(
        createTableQuery.includes('lastfm_synced_at TIMESTAMPTZ'),
        'Should have lastfm_synced_at column'
      );

      // Check for computed affinity columns
      assert.ok(
        createTableQuery.includes('genre_affinity JSONB'),
        'Should have genre_affinity column'
      );
      assert.ok(
        createTableQuery.includes('artist_affinity JSONB'),
        'Should have artist_affinity column'
      );

      // Check for unique constraint
      assert.ok(
        createTableQuery.includes('UNIQUE(user_id)'),
        'Should have unique constraint on user_id'
      );

      // Check for foreign key
      assert.ok(
        createTableQuery.includes('REFERENCES users(_id)'),
        'Should have foreign key to users table'
      );
    });

    it('should create all required indexes', async () => {
      await up(mockPool);

      const indexQueries = executedQueries.filter((q) =>
        q.includes('CREATE INDEX')
      );

      // Should have 5 indexes
      assert.ok(indexQueries.length >= 5, 'Should create at least 5 indexes');

      // Check for specific indexes
      const indexNames = indexQueries.map((q) => {
        const match = q.match(/idx_user_preferences_\w+/);
        return match ? match[0] : null;
      });

      assert.ok(
        indexNames.includes('idx_user_preferences_user_id'),
        'Should create user_id index'
      );
      assert.ok(
        indexNames.includes('idx_user_preferences_spotify_stale'),
        'Should create spotify_stale index'
      );
      assert.ok(
        indexNames.includes('idx_user_preferences_lastfm_stale'),
        'Should create lastfm_stale index'
      );
      assert.ok(
        indexNames.includes('idx_user_preferences_genre_affinity'),
        'Should create genre_affinity GIN index'
      );
      assert.ok(
        indexNames.includes('idx_user_preferences_artist_affinity'),
        'Should create artist_affinity GIN index'
      );
    });

    it('should use GIN indexes for JSONB columns', async () => {
      await up(mockPool);

      const ginIndexQueries = executedQueries.filter((q) =>
        q.includes('USING GIN')
      );

      assert.strictEqual(
        ginIndexQueries.length,
        2,
        'Should create 2 GIN indexes'
      );
      assert.ok(
        ginIndexQueries.some((q) => q.includes('genre_affinity')),
        'Should have GIN index on genre_affinity'
      );
      assert.ok(
        ginIndexQueries.some((q) => q.includes('artist_affinity')),
        'Should have GIN index on artist_affinity'
      );
    });

    it('should use partial indexes for stale data queries', async () => {
      await up(mockPool);

      const partialIndexQueries = executedQueries.filter(
        (q) => q.includes('WHERE') && q.includes('IS NOT NULL')
      );

      assert.strictEqual(
        partialIndexQueries.length,
        2,
        'Should create 2 partial indexes'
      );
    });
  });

  describe('down()', () => {
    it('should drop all indexes and table', async () => {
      await down(mockPool);

      const dropIndexQueries = executedQueries.filter((q) =>
        q.includes('DROP INDEX')
      );
      const dropTableQuery = executedQueries.find((q) =>
        q.includes('DROP TABLE')
      );

      // Should drop 5 indexes
      assert.strictEqual(dropIndexQueries.length, 5, 'Should drop 5 indexes');

      // Should drop table
      assert.ok(dropTableQuery, 'Should have DROP TABLE query');
      assert.ok(
        dropTableQuery.includes('user_preferences'),
        'Should drop user_preferences table'
      );
    });

    it('should drop indexes before table', async () => {
      await down(mockPool);

      const dropTableIndex = executedQueries.findIndex((q) =>
        q.includes('DROP TABLE')
      );
      const lastDropIndexIndex = executedQueries.reduce((lastIdx, q, idx) => {
        if (q.includes('DROP INDEX')) return idx;
        return lastIdx;
      }, -1);

      assert.ok(
        lastDropIndexIndex < dropTableIndex,
        'All DROP INDEX should come before DROP TABLE'
      );
    });
  });

  describe('table schema defaults', () => {
    it('should have sensible defaults for JSONB columns', async () => {
      await up(mockPool);

      const createTableQuery = executedQueries.find((q) =>
        q.includes('CREATE TABLE')
      );

      // JSONB columns should default to empty arrays
      const jsonbDefaults = createTableQuery.match(/JSONB DEFAULT '\[\]'/g);
      assert.ok(
        jsonbDefaults && jsonbDefaults.length >= 8,
        'Should have at least 8 JSONB columns with empty array defaults'
      );

      // Integer columns should default to 0
      assert.ok(
        createTableQuery.includes('total_albums INTEGER DEFAULT 0'),
        'total_albums should default to 0'
      );
      assert.ok(
        createTableQuery.includes('lastfm_total_scrobbles INTEGER DEFAULT 0'),
        'lastfm_total_scrobbles should default to 0'
      );
    });

    it('should have ON DELETE CASCADE for user_id foreign key', async () => {
      await up(mockPool);

      const createTableQuery = executedQueries.find((q) =>
        q.includes('CREATE TABLE')
      );

      assert.ok(
        createTableQuery.includes('ON DELETE CASCADE'),
        'Should cascade delete when user is deleted'
      );
    });
  });
});
