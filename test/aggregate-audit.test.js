const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  createAggregateAudit,
  selectCanonicalAlbumId,
  normalizeAlbumKey,
  basicNormalizeAlbumKey,
} = require('../utils/aggregate-audit.js');

// =============================================================================
// Helper functions
// =============================================================================

function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
}

function createMockPool(queryResults = []) {
  let callIndex = 0;
  return {
    query: mock.fn(async () => {
      const result = queryResults[callIndex] || { rows: [] };
      callIndex++;
      return result;
    }),
    connect: mock.fn(async () => ({
      query: mock.fn(async () => ({ rowCount: 1 })),
      release: mock.fn(),
    })),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('aggregate-audit', () => {
  // ===========================================================================
  // normalizeAlbumKey tests
  // ===========================================================================

  describe('normalizeAlbumKey', () => {
    it('should normalize artist and album to lowercase', () => {
      assert.strictEqual(
        normalizeAlbumKey('Radiohead', 'OK Computer'),
        'radiohead::ok computer'
      );
    });

    it('should trim whitespace', () => {
      assert.strictEqual(
        normalizeAlbumKey('  Radiohead  ', '  OK Computer  '),
        'radiohead::ok computer'
      );
    });

    it('should handle null values', () => {
      assert.strictEqual(normalizeAlbumKey(null, 'Album'), '::album');
      assert.strictEqual(normalizeAlbumKey('Artist', null), 'artist::');
      assert.strictEqual(normalizeAlbumKey(null, null), '::');
    });

    it('should handle undefined values', () => {
      assert.strictEqual(normalizeAlbumKey(undefined, 'Album'), '::album');
    });

    // New tests for sophisticated normalization
    it('should strip edition suffixes', () => {
      assert.strictEqual(
        normalizeAlbumKey('Radiohead', 'OK Computer (Deluxe Edition)'),
        'radiohead::ok computer'
      );
      assert.strictEqual(
        normalizeAlbumKey('Radiohead', 'OK Computer [Remastered]'),
        'radiohead::ok computer'
      );
    });

    it('should remove leading articles from artist', () => {
      assert.strictEqual(
        normalizeAlbumKey('The Beatles', 'Abbey Road'),
        'beatles::abbey road'
      );
    });

    it('should handle punctuation differences', () => {
      // AC/DC vs ACDC
      assert.strictEqual(
        normalizeAlbumKey('AC/DC', 'Back in Black'),
        normalizeAlbumKey('ACDC', 'Back in Black')
      );
      // Guns N' Roses vs Guns N Roses
      assert.strictEqual(
        normalizeAlbumKey("Guns N' Roses", 'Appetite for Destruction'),
        normalizeAlbumKey('Guns N Roses', 'Appetite for Destruction')
      );
    });

    it('should normalize ampersand to and', () => {
      assert.strictEqual(
        normalizeAlbumKey('Simon & Garfunkel', 'Bridge over Troubled Water'),
        normalizeAlbumKey('Simon and Garfunkel', 'Bridge over Troubled Water')
      );
    });
  });

  describe('basicNormalizeAlbumKey', () => {
    it('should only lowercase and trim (no sophisticated normalization)', () => {
      // Basic normalization should NOT strip edition suffixes
      assert.strictEqual(
        basicNormalizeAlbumKey('Radiohead', 'OK Computer (Deluxe Edition)'),
        'radiohead::ok computer (deluxe edition)'
      );
      // Basic normalization should NOT remove articles
      assert.strictEqual(
        basicNormalizeAlbumKey('The Beatles', 'Abbey Road'),
        'the beatles::abbey road'
      );
    });
  });

  // ===========================================================================
  // selectCanonicalAlbumId tests
  // ===========================================================================

  describe('selectCanonicalAlbumId', () => {
    it('should prefer Spotify IDs (22 char alphanumeric)', () => {
      const albumIds = [
        'manual-1234567890',
        '6dVIqQ8qmQ5GBnJ9shOYGE', // Spotify ID
        'internal-abc123',
      ];
      assert.strictEqual(
        selectCanonicalAlbumId(albumIds),
        '6dVIqQ8qmQ5GBnJ9shOYGE'
      );
    });

    it('should prefer MusicBrainz UUIDs', () => {
      const albumIds = [
        'manual-1234567890',
        'internal-abc123',
        'f622d648-4567-4d44-8d41-e10e64ae6897', // MB UUID
      ];
      assert.strictEqual(
        selectCanonicalAlbumId(albumIds),
        'f622d648-4567-4d44-8d41-e10e64ae6897'
      );
    });

    it('should prefer external over internal IDs', () => {
      const albumIds = [
        'internal-abc123',
        'manual-1234567890',
        'some-other-id',
      ];
      assert.strictEqual(selectCanonicalAlbumId(albumIds), 'some-other-id');
    });

    it('should prefer internal over manual IDs', () => {
      const albumIds = ['manual-1234567890', 'internal-abc123'];
      assert.strictEqual(selectCanonicalAlbumId(albumIds), 'internal-abc123');
    });

    it('should return first valid ID as fallback', () => {
      const albumIds = ['manual-1234567890', 'manual-9876543210'];
      assert.strictEqual(selectCanonicalAlbumId(albumIds), 'manual-1234567890');
    });

    it('should filter out null and empty values', () => {
      const albumIds = [null, '', 'valid-id', '  '];
      assert.strictEqual(selectCanonicalAlbumId(albumIds), 'valid-id');
    });

    it('should return null for empty array', () => {
      assert.strictEqual(selectCanonicalAlbumId([]), null);
    });

    it('should return null for array of nulls', () => {
      assert.strictEqual(selectCanonicalAlbumId([null, null]), null);
    });
  });

  // ===========================================================================
  // createAggregateAudit factory tests
  // ===========================================================================

  describe('createAggregateAudit', () => {
    it('should throw if pool is not provided', () => {
      assert.throws(
        () => createAggregateAudit({}),
        /PostgreSQL pool is required/
      );
    });

    it('should create instance with pool', () => {
      const pool = createMockPool();
      const audit = createAggregateAudit({ pool });
      assert.ok(audit);
      assert.strictEqual(typeof audit.findDuplicates, 'function');
      assert.strictEqual(typeof audit.previewFix, 'function');
      assert.strictEqual(typeof audit.executeFix, 'function');
      assert.strictEqual(typeof audit.getAuditReport, 'function');
    });
  });

  // ===========================================================================
  // findDuplicates tests
  // ===========================================================================

  describe('findDuplicates', () => {
    it('should return empty when no duplicates exist', async () => {
      const pool = createMockPool([
        {
          rows: [
            {
              album_id: 'id1',
              artist: 'Artist A',
              album: 'Album A',
              position: 1,
              user_id: 'user1',
              username: 'alice',
              list_name: 'Main',
            },
            {
              album_id: 'id2',
              artist: 'Artist B',
              album: 'Album B',
              position: 2,
              user_id: 'user1',
              username: 'alice',
              list_name: 'Main',
            },
          ],
        },
      ]);
      const logger = createMockLogger();
      const audit = createAggregateAudit({ pool, logger });

      const result = await audit.findDuplicates(2024);

      assert.strictEqual(result.duplicateGroups, 0);
      assert.strictEqual(result.duplicates.length, 0);
      assert.strictEqual(result.uniqueAlbums, 2);
    });

    it('should detect albums with same name but different album_ids', async () => {
      const pool = createMockPool([
        {
          rows: [
            // Same album from MusicBrainz (Alice)
            {
              album_id: 'mb-uuid-123',
              artist: 'Radiohead',
              album: 'OK Computer',
              position: 1,
              user_id: 'user1',
              username: 'alice',
              list_name: 'Main',
            },
            // Same album from Spotify (Bob)
            {
              album_id: 'spotify-abc123',
              artist: 'Radiohead',
              album: 'OK Computer',
              position: 2,
              user_id: 'user2',
              username: 'bob',
              list_name: 'Main',
            },
            // Different album
            {
              album_id: 'other-id',
              artist: 'Nirvana',
              album: 'Nevermind',
              position: 3,
              user_id: 'user1',
              username: 'alice',
              list_name: 'Main',
            },
          ],
        },
      ]);
      const logger = createMockLogger();
      const audit = createAggregateAudit({ pool, logger });

      const result = await audit.findDuplicates(2024);

      assert.strictEqual(result.duplicateGroups, 1);
      assert.strictEqual(result.duplicates.length, 1);

      const duplicate = result.duplicates[0];
      assert.strictEqual(duplicate.artist, 'Radiohead');
      assert.strictEqual(duplicate.album, 'OK Computer');
      assert.strictEqual(duplicate.albumIds.length, 2);
      assert.ok(duplicate.albumIds.includes('mb-uuid-123'));
      assert.ok(duplicate.albumIds.includes('spotify-abc123'));
      assert.strictEqual(duplicate.entryCount, 2);
    });

    it('should handle case-insensitive matching', async () => {
      const pool = createMockPool([
        {
          rows: [
            {
              album_id: 'id1',
              artist: 'THE BEATLES',
              album: 'Abbey Road',
              position: 1,
              user_id: 'user1',
              username: 'alice',
              list_name: 'Main',
            },
            {
              album_id: 'id2',
              artist: 'the beatles',
              album: 'ABBEY ROAD',
              position: 2,
              user_id: 'user2',
              username: 'bob',
              list_name: 'Main',
            },
          ],
        },
      ]);
      const logger = createMockLogger();
      const audit = createAggregateAudit({ pool, logger });

      const result = await audit.findDuplicates(2024);

      assert.strictEqual(result.duplicateGroups, 1);
      assert.strictEqual(result.duplicates[0].albumIds.length, 2);
    });
  });

  // ===========================================================================
  // previewFix tests
  // ===========================================================================

  describe('previewFix', () => {
    it('should return no changes when no duplicates exist', async () => {
      const pool = createMockPool([
        { rows: [] }, // findDuplicates query returns empty
      ]);
      const logger = createMockLogger();
      const audit = createAggregateAudit({ pool, logger });

      const result = await audit.previewFix(2024);

      assert.strictEqual(result.changesRequired, false);
      assert.strictEqual(result.changes.length, 0);
    });

    it('should show proposed changes for duplicates', async () => {
      // First query for findDuplicates, second query is reused
      const pool = createMockPool([
        {
          rows: [
            {
              album_id: 'manual-123',
              artist: 'Radiohead',
              album: 'OK Computer',
              position: 1,
              user_id: 'user1',
              username: 'alice',
              list_name: 'Main',
            },
            {
              album_id: '6dVIqQ8qmQ5GBnJ9shOYGE', // Spotify ID (should be canonical)
              artist: 'Radiohead',
              album: 'OK Computer',
              position: 2,
              user_id: 'user2',
              username: 'bob',
              list_name: 'Main',
            },
          ],
        },
        // Second call for previewFix -> findDuplicates again
        {
          rows: [
            {
              album_id: 'manual-123',
              artist: 'Radiohead',
              album: 'OK Computer',
              position: 1,
              user_id: 'user1',
              username: 'alice',
              list_name: 'Main',
            },
            {
              album_id: '6dVIqQ8qmQ5GBnJ9shOYGE',
              artist: 'Radiohead',
              album: 'OK Computer',
              position: 2,
              user_id: 'user2',
              username: 'bob',
              list_name: 'Main',
            },
          ],
        },
      ]);
      const logger = createMockLogger();
      const audit = createAggregateAudit({ pool, logger });

      const result = await audit.previewFix(2024);

      assert.strictEqual(result.changesRequired, true);
      assert.strictEqual(result.changes.length, 1);

      const change = result.changes[0];
      assert.strictEqual(change.artist, 'Radiohead');
      assert.strictEqual(change.album, 'OK Computer');
      assert.strictEqual(change.canonicalAlbumId, '6dVIqQ8qmQ5GBnJ9shOYGE');
      assert.strictEqual(change.affectedEntries.length, 1);
      assert.strictEqual(
        change.affectedEntries[0].currentAlbumId,
        'manual-123'
      );
    });
  });

  // ===========================================================================
  // getAuditReport tests
  // ===========================================================================

  describe('getAuditReport', () => {
    it('should return complete audit report', async () => {
      const pool = createMockPool([
        // findDuplicates query
        {
          rows: [
            {
              album_id: 'id1',
              artist: 'Artist A',
              album: 'Album A',
              position: 1,
              user_id: 'user1',
              username: 'alice',
              list_name: 'Main',
            },
          ],
        },
        // previewFix -> findDuplicates query
        {
          rows: [
            {
              album_id: 'id1',
              artist: 'Artist A',
              album: 'Album A',
              position: 1,
              user_id: 'user1',
              username: 'alice',
              list_name: 'Main',
            },
          ],
        },
      ]);
      const logger = createMockLogger();
      const audit = createAggregateAudit({ pool, logger });

      const result = await audit.getAuditReport(2024);

      assert.strictEqual(result.year, 2024);
      assert.ok(result.generatedAt);
      assert.ok(result.summary);
      assert.strictEqual(result.summary.totalAlbumsScanned, 1);
      assert.strictEqual(result.summary.uniqueAlbums, 1);
      assert.strictEqual(result.summary.albumsWithMultipleIds, 0);
    });
  });

  // ===========================================================================
  // findManualAlbumsForReconciliation tests
  // ===========================================================================

  describe('findManualAlbumsForReconciliation', () => {
    it('should return empty when no manual albums exist', async () => {
      const pool = createMockPool([
        { rows: [] }, // Manual items query
      ]);
      const logger = createMockLogger();
      const audit = createAggregateAudit({ pool, logger });

      const result = await audit.findManualAlbumsForReconciliation();

      assert.strictEqual(result.totalManual, 0);
      assert.strictEqual(result.totalWithMatches, 0);
      assert.strictEqual(result.totalIntegrityIssues, 0);
      assert.deepStrictEqual(result.manualAlbums, []);
      assert.deepStrictEqual(result.integrityIssues, []);
    });

    it('should find manual albums with potential canonical matches', async () => {
      const pool = createMockPool([
        // Query 1: Manual items
        {
          rows: [
            {
              album_id: 'manual-123',
              artist: 'Radiohead',
              album: 'OK Computer',
              has_cover: false,
            },
          ],
        },
        // Query 2: Usage info
        {
          rows: [
            {
              album_id: 'manual-123',
              list_id: 'list-1',
              list_name: 'Best of 2020',
              year: 2020,
              user_id: 'user-1',
              username: 'alice',
            },
          ],
        },
        // Query 3: Canonical albums
        {
          rows: [
            {
              album_id: 'spotify-abc123',
              artist: 'Radiohead',
              album: 'OK Computer',
              has_cover: true,
            },
          ],
        },
        // Query 4: Excluded pairs
        { rows: [] },
      ]);
      const logger = createMockLogger();
      const audit = createAggregateAudit({ pool, logger });

      const result = await audit.findManualAlbumsForReconciliation();

      assert.strictEqual(result.totalManual, 1);
      assert.strictEqual(result.totalWithMatches, 1);
      assert.strictEqual(result.manualAlbums.length, 1);

      const album = result.manualAlbums[0];
      assert.strictEqual(album.manualId, 'manual-123');
      assert.strictEqual(album.artist, 'Radiohead');
      assert.strictEqual(album.album, 'OK Computer');
      assert.ok(album.matches.length > 0);
      assert.strictEqual(album.matches[0].albumId, 'spotify-abc123');
      assert.strictEqual(result.totalIntegrityIssues, 0);
    });

    it('should exclude pairs marked as distinct', async () => {
      const pool = createMockPool([
        // Query 1: Manual items
        {
          rows: [
            {
              album_id: 'manual-123',
              artist: 'Radiohead',
              album: 'OK Computer',
              has_cover: false,
            },
          ],
        },
        // Query 2: Usage info
        { rows: [] },
        // Query 3: Canonical albums
        {
          rows: [
            {
              album_id: 'spotify-abc123',
              artist: 'Radiohead',
              album: 'OK Computer',
              has_cover: true,
            },
          ],
        },
        // Query 4: Excluded pairs - these are marked as distinct
        {
          rows: [{ album_id_1: 'manual-123', album_id_2: 'spotify-abc123' }],
        },
      ]);
      const logger = createMockLogger();
      const audit = createAggregateAudit({ pool, logger });

      const result = await audit.findManualAlbumsForReconciliation();

      assert.strictEqual(result.totalManual, 1);
      // The manual album should have no matches because it's excluded
      assert.strictEqual(result.manualAlbums[0].matches.length, 0);
      assert.strictEqual(result.totalWithMatches, 0);
    });

    it('should detect orphaned manual albums (not in albums table)', async () => {
      const pool = createMockPool([
        // Query 1: Manual items with orphaned album (NULL metadata from LEFT JOIN)
        {
          rows: [
            {
              album_id: 'manual-orphan',
              artist: null,
              album: null,
              has_cover: false,
            },
          ],
        },
        // Query 2: Usage info
        {
          rows: [
            {
              album_id: 'manual-orphan',
              list_id: 'list-1',
              list_name: 'Test List',
              year: 2023,
              user_id: 'user-1',
              username: 'testuser',
            },
          ],
        },
        // Query 3: Canonical albums
        { rows: [] },
        // Query 4: Excluded pairs
        { rows: [] },
      ]);
      const logger = createMockLogger();
      const audit = createAggregateAudit({ pool, logger });

      const result = await audit.findManualAlbumsForReconciliation();

      assert.strictEqual(result.totalManual, 1);
      assert.strictEqual(result.totalIntegrityIssues, 1);
      assert.strictEqual(result.manualAlbums.length, 0); // Orphaned albums not included in valid albums
      assert.strictEqual(result.integrityIssues[0].type, 'orphaned');
      assert.strictEqual(result.integrityIssues[0].severity, 'high');
      assert.strictEqual(
        result.integrityIssues[0].fixAction,
        'delete_references'
      );
    });

    it('should detect manual albums with missing metadata', async () => {
      const pool = createMockPool([
        // Query 1: Manual items with missing artist
        {
          rows: [
            {
              album_id: 'manual-missing',
              artist: '',
              album: 'Some Album',
              has_cover: false,
            },
          ],
        },
        // Query 2: Usage info
        { rows: [] },
        // Query 3: Canonical albums
        { rows: [] },
        // Query 4: Excluded pairs
        { rows: [] },
      ]);
      const logger = createMockLogger();
      const audit = createAggregateAudit({ pool, logger });

      const result = await audit.findManualAlbumsForReconciliation();

      assert.strictEqual(result.totalIntegrityIssues, 1);
      assert.strictEqual(result.integrityIssues[0].type, 'missing_metadata');
      assert.strictEqual(result.integrityIssues[0].severity, 'medium');
      assert.strictEqual(result.integrityIssues[0].fixAction, 'manual_review');
    });

    it('should detect duplicate manual albums with same normalized name', async () => {
      const pool = createMockPool([
        // Query 1: Manual items with duplicate normalized names
        {
          rows: [
            {
              album_id: 'manual-123',
              artist: 'Radiohead',
              album: 'OK Computer',
              has_cover: false,
            },
            {
              album_id: 'manual-456',
              artist: 'Radiohead',
              album: 'OK Computer',
              has_cover: false,
            },
          ],
        },
        // Query 2: Usage info
        { rows: [] },
        // Query 3: Canonical albums
        { rows: [] },
        // Query 4: Excluded pairs
        { rows: [] },
      ]);
      const logger = createMockLogger();
      const audit = createAggregateAudit({ pool, logger });

      const result = await audit.findManualAlbumsForReconciliation();

      assert.strictEqual(result.totalIntegrityIssues, 1);
      assert.strictEqual(result.integrityIssues[0].type, 'duplicate_manual');
      assert.strictEqual(result.integrityIssues[0].severity, 'low');
      assert.strictEqual(result.integrityIssues[0].duplicates.length, 2);
    });
  });

  // ===========================================================================
  // mergeManualAlbum tests
  // ===========================================================================

  describe('mergeManualAlbum', () => {
    it('should throw error when manual album ID is invalid', async () => {
      const pool = createMockPool([]);
      const logger = createMockLogger();
      const audit = createAggregateAudit({ pool, logger });

      await assert.rejects(
        async () => {
          await audit.mergeManualAlbum('invalid-123', 'spotify-abc123');
        },
        { message: 'Invalid manual album ID' }
      );
    });

    it('should throw error when canonical album not found', async () => {
      const pool = createMockPool([
        // Query for canonical album - returns empty
        { rows: [] },
      ]);
      const logger = createMockLogger();
      const audit = createAggregateAudit({ pool, logger });

      await assert.rejects(
        async () => {
          await audit.mergeManualAlbum('manual-123', 'spotify-nonexistent');
        },
        { message: /not found/ }
      );
    });

    it('should successfully merge manual album into canonical', async () => {
      // Create a more sophisticated mock for this test
      let queryIndex = 0;
      const queryResults = [
        // Query 1: Check manual album exists
        { rows: [{ count: '1' }] },
        // Query 2: Check canonical album exists
        { rows: [{ count: '1' }] },
        // Query 3: Get canonical album metadata
        { rows: [{ artist: 'Radiohead', album: 'OK Computer' }] },
        // Query 4: Get affected lists
        {
          rows: [
            {
              list_id: 'list-1',
              list_name: 'Best of 2020',
              year: 2020,
              user_id: 'user-1',
            },
          ],
        },
        // Query 5: Update list_items (UPDATE query)
        { rowCount: 1 },
        // Query 6: Delete manual album
        { rowCount: 1 },
        // Query 7: Insert admin event (returns the inserted event)
        {
          rows: [
            {
              id: 'event-123',
              type: 'album_merge',
              created_at: new Date().toISOString(),
            },
          ],
        },
      ];

      const pool = {
        query: mock.fn(async () => {
          const result = queryResults[queryIndex] || { rows: [] };
          queryIndex++;
          return result;
        }),
        connect: mock.fn(async () => ({
          query: mock.fn(async () => ({ rowCount: 1 })),
          release: mock.fn(),
        })),
      };

      const logger = createMockLogger();
      const audit = createAggregateAudit({ pool, logger });

      const result = await audit.mergeManualAlbum(
        'manual-123',
        'spotify-abc123',
        {
          syncMetadata: true,
          adminUserId: 'admin-1',
        }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.updatedListItems, 1);
      assert.ok(result.affectedLists.length > 0);
    });
  });
});
