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
  // eslint-disable-next-line no-console
  console.log('Skipping database tests - no DATABASE_URL configured');
  process.exit(0);
}

describe('List Fetch Optimization', () => {
  let pool;
  let listItems;
  let testListId;
  let testUserId;

  before(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    // Create test user and list
    testUserId = `test-user-${Date.now()}`;
    testListId = `test-list-${Date.now()}`;

    await pool.query(
      `INSERT INTO users (_id, email, hash, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (_id) DO NOTHING`,
      [testUserId, `test-${Date.now()}@example.com`, 'fake-hash']
    );

    await pool.query(
      `INSERT INTO lists (_id, user_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [testListId, testUserId, 'Test List']
    );

    // Initialize PgDatastore
    const listItemsMap = {
      _id: '_id',
      listId: 'list_id',
      position: 'position',
      artist: 'artist',
      album: 'album',
      albumId: 'album_id',
      releaseDate: 'release_date',
      country: 'country',
      genre1: 'genre_1',
      genre2: 'genre_2',
      comments: 'comments',
      tracks: 'tracks',
      trackPick: 'track_pick',
      coverImage: 'cover_image',
      coverImageFormat: 'cover_image_format',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    };

    listItems = new PgDatastore(pool, 'list_items', listItemsMap);
  });

  after(async () => {
    // Cleanup test data
    if (pool) {
      await pool.query('DELETE FROM list_items WHERE list_id = $1', [
        testListId,
      ]);
      await pool.query('DELETE FROM lists WHERE _id = $1', [testListId]);
      await pool.query('DELETE FROM users WHERE _id = $1', [testUserId]);
      await pool.end();
    }
  });

  it('should handle empty list', async () => {
    const result = await listItems.findWithAlbumData(testListId);
    assert.strictEqual(Array.isArray(result), true);
    assert.strictEqual(result.length, 0);
  });

  it('should handle list items without album data (NULL JOIN)', async () => {
    // Insert item without album_id (no join will occur)
    await pool.query(
      `INSERT INTO list_items (_id, list_id, position, artist, album, release_date, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [
        `item-${Date.now()}-1`,
        testListId,
        1,
        'Test Artist',
        'Test Album',
        '2024',
      ]
    );

    const result = await listItems.findWithAlbumData(testListId);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Test Artist');
    assert.strictEqual(result[0].album, 'Test Album');
    assert.strictEqual(result[0].releaseDate, '2024');
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

  it('should prefer list_items data over albums data (COALESCE)', async () => {
    const albumId = `test-album-${Date.now()}`;

    // Insert album data
    await pool.query(
      `INSERT INTO albums (album_id, artist, album, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (album_id) DO NOTHING`,
      [albumId, 'Album Artist Fallback', 'Album Name Fallback']
    );

    // Insert list item with album_id AND override data
    await pool.query(
      `INSERT INTO list_items (_id, list_id, position, album_id, artist, album, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [
        `item-${Date.now()}-3`,
        testListId,
        3,
        albumId,
        'Override Artist',
        'Override Album',
      ]
    );

    const result = await listItems.findWithAlbumData(testListId);
    const overrideItem = result.find((item) => item.position === 3);

    assert.ok(overrideItem);
    // Should use list_items data, not albums data
    assert.strictEqual(overrideItem.artist, 'Override Artist');
    assert.strictEqual(overrideItem.album, 'Override Album');
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
    const tracks = [
      { title: 'Track 1', duration: '3:45' },
      { title: 'Track 2', duration: '4:20' },
    ];

    await pool.query(
      `INSERT INTO list_items (_id, list_id, position, artist, album, tracks, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [
        `item-${Date.now()}-4`,
        testListId,
        4,
        'Artist',
        'Album',
        JSON.stringify(tracks),
      ]
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
