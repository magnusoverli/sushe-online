/**
 * Test suite for list fetch optimization (JOIN query)
 * Verifies that the new findWithAlbumData method works correctly
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { PgDatastore } = require('../db/postgres');

// Use test database or skip if not configured
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.log('Skipping database tests - no DATABASE_URL configured');
  process.exit(0);
}

describe('List Fetch Optimization', () => {
  let pool;
  let listItems;
  let testListId;
  let testUserId;

  before(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });

    // Create test user and list
    testUserId = `test-user-${Date.now()}`;
    testListId = `test-list-${Date.now()}`;

    await pool.query(
      `INSERT INTO users (_id, username, email, hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (_id) DO NOTHING`,
      [testUserId, testUserId, `test-${Date.now()}@example.com`, 'fake-hash']
    );

    // Create a list group (required FK for lists.group_id)
    const groupResult = await pool.query(
      `INSERT INTO list_groups (_id, user_id, name, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, 0, NOW(), NOW())
       RETURNING id`,
      [`group-${Date.now()}`, testUserId, 'Test Group']
    );
    const groupId = groupResult.rows[0].id;

    await pool.query(
      `INSERT INTO lists (_id, user_id, name, group_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [testListId, testUserId, 'Test List', groupId]
    );

    // Initialize PgDatastore with actual list_items columns
    const listItemsMap = {
      _id: '_id',
      listId: 'list_id',
      albumId: 'album_id',
      position: 'position',
      comments: 'comments',
      primaryTrack: 'primary_track',
      secondaryTrack: 'secondary_track',
      tracks: 'tracks',
      trackPick: 'track_pick',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    };

    listItems = new PgDatastore(pool, 'list_items', listItemsMap);
  });

  after(async () => {
    // Cleanup test data in FK-safe order
    if (pool) {
      // Get album_ids from test list items before deleting them
      const albumIds = await pool.query(
        'SELECT DISTINCT album_id FROM list_items WHERE list_id = $1 AND album_id IS NOT NULL',
        [testListId]
      );
      await pool.query('DELETE FROM list_items WHERE list_id = $1', [
        testListId,
      ]);
      await pool.query('DELETE FROM lists WHERE _id = $1', [testListId]);
      await pool.query('DELETE FROM list_groups WHERE user_id = $1', [
        testUserId,
      ]);
      await pool.query('DELETE FROM users WHERE _id = $1', [testUserId]);
      // Clean up test albums
      for (const row of albumIds.rows) {
        await pool.query('DELETE FROM albums WHERE album_id = $1', [
          row.album_id,
        ]);
      }
      await pool.end();
    }
  });

  it('should handle empty list', async () => {
    const result = await listItems.findWithAlbumData(testListId);
    assert.strictEqual(Array.isArray(result), true);
    assert.strictEqual(result.length, 0);
  });

  it('should handle list items without album data (NULL JOIN)', async () => {
    // Insert item without album_id (LEFT JOIN returns NULLs for album fields)
    await pool.query(
      `INSERT INTO list_items (_id, list_id, position, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [`item-${Date.now()}-1`, testListId, 1]
    );

    const result = await listItems.findWithAlbumData(testListId);
    assert.strictEqual(result.length, 1);
    // Without album_id, all album fields should be empty strings (from || '' fallback)
    assert.strictEqual(result[0].artist, '');
    assert.strictEqual(result[0].album, '');
    assert.strictEqual(result[0].releaseDate, '');
    assert.strictEqual(result[0].position, 1);
  });

  it('should handle list items with album data (successful JOIN)', async () => {
    const albumId = `test-album-${Date.now()}`;

    // Insert album data
    await pool.query(
      `INSERT INTO albums (album_id, artist, album, release_date, country, genre_1, genre_2, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (album_id) DO NOTHING`,
      [
        albumId,
        'Album Artist',
        'Album Name',
        '2023',
        'US',
        'Rock',
        'Alternative',
      ]
    );

    // Insert list item with album_id (will join with albums table)
    await pool.query(
      `INSERT INTO list_items (_id, list_id, position, album_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [`item-${Date.now()}-2`, testListId, 2, albumId]
    );

    const result = await listItems.findWithAlbumData(testListId);
    const joinedItem = result.find((item) => item.position === 2);

    assert.ok(joinedItem);
    assert.strictEqual(joinedItem.artist, 'Album Artist');
    assert.strictEqual(joinedItem.album, 'Album Name');
    assert.strictEqual(joinedItem.releaseDate, '2023');
    assert.strictEqual(joinedItem.country, 'US');
    assert.strictEqual(joinedItem.genre1, 'Rock');
    assert.strictEqual(joinedItem.genre2, 'Alternative');
  });

  it('should use albums table data for album metadata via JOIN', async () => {
    const albumId = `test-album-coalesce-${Date.now()}`;

    // Insert album with metadata
    await pool.query(
      `INSERT INTO albums (album_id, artist, album, country, genre_1, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (album_id) DO NOTHING`,
      [albumId, 'Joined Artist', 'Joined Album', 'UK', 'Indie']
    );

    // Insert list item referencing the album
    await pool.query(
      `INSERT INTO list_items (_id, list_id, position, album_id, comments, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [`item-${Date.now()}-3`, testListId, 3, albumId, 'Great album']
    );

    const result = await listItems.findWithAlbumData(testListId);
    const joinedItem = result.find((item) => item.position === 3);

    assert.ok(joinedItem);
    // Album metadata comes from albums table
    assert.strictEqual(joinedItem.artist, 'Joined Artist');
    assert.strictEqual(joinedItem.album, 'Joined Album');
    assert.strictEqual(joinedItem.country, 'UK');
    assert.strictEqual(joinedItem.genre1, 'Indie');
    // Comments come from list_items table
    assert.strictEqual(joinedItem.comments, 'Great album');
  });

  it('should return items sorted by position', async () => {
    const result = await listItems.findWithAlbumData(testListId);
    assert.ok(result.length >= 3);

    // Verify positions are in order
    for (let i = 0; i < result.length - 1; i++) {
      assert.ok(result[i].position <= result[i + 1].position);
    }
  });

  it('should handle JSONB tracks field correctly', async () => {
    const albumId = `test-album-tracks-${Date.now()}`;
    const tracks = [
      { title: 'Track 1', duration: '3:45' },
      { title: 'Track 2', duration: '4:20' },
    ];

    // Insert album with tracks in the albums table (tracks come from JOIN)
    await pool.query(
      `INSERT INTO albums (album_id, artist, album, tracks, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (album_id) DO NOTHING`,
      [albumId, 'Track Artist', 'Track Album', JSON.stringify(tracks)]
    );

    await pool.query(
      `INSERT INTO list_items (_id, list_id, position, album_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [`item-${Date.now()}-4`, testListId, 4, albumId]
    );

    const result = await listItems.findWithAlbumData(testListId);
    const itemWithTracks = result.find((item) => item.position === 4);

    assert.ok(itemWithTracks);
    assert.ok(Array.isArray(itemWithTracks.tracks));
    assert.strictEqual(itemWithTracks.tracks.length, 2);
    assert.strictEqual(itemWithTracks.tracks[0].title, 'Track 1');
  });

  it('should only work for list_items table', async () => {
    const wrongDatastore = new PgDatastore(pool, 'albums', {});

    await assert.rejects(
      async () => {
        await wrongDatastore.findWithAlbumData('fake-id');
      },
      {
        message: 'findWithAlbumData only available for list_items table',
      }
    );
  });
});
