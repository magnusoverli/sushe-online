const test = require('node:test');
const assert = require('node:assert');

const {
  mapListRowToItem,
  mapAlbumDataItemToResponse,
} = require('../services/list/item-mapper');

test('mapListRowToItem maps row fields and recommendation metadata', () => {
  const recommendationMap = new Map([
    ['album-1', { recommendedBy: 'alice', recommendedAt: '2025-01-01' }],
  ]);

  const result = mapListRowToItem(
    {
      item_id: 'item-1',
      artist: 'Artist',
      album: 'Album',
      album_id: 'album-1',
      release_date: '2024-04-09',
      country: 'NO',
      genre_1: 'Metal',
      genre_2: 'Progressive',
      primary_track: 'Track A',
      secondary_track: 'Track B',
      comments: 'Great',
      comments_2: 'Second',
      tracks: ['Track A', 'Track B'],
      cover_image: 'base64-image',
      cover_image_format: 'jpeg',
      summary: 'Summary',
      summary_source: 'claude',
    },
    recommendationMap
  );

  assert.deepStrictEqual(result, {
    _id: 'item-1',
    artist: 'Artist',
    album: 'Album',
    album_id: 'album-1',
    release_date: '2024-04-09',
    country: 'NO',
    genre_1: 'Metal',
    genre_2: 'Progressive',
    track_pick: 'Track A',
    primary_track: 'Track A',
    secondary_track: 'Track B',
    comments: 'Great',
    comments_2: 'Second',
    tracks: ['Track A', 'Track B'],
    cover_image: 'base64-image',
    cover_image_format: 'jpeg',
    summary: 'Summary',
    summary_source: 'claude',
    recommended_by: 'alice',
    recommended_at: '2025-01-01',
  });
});

test('mapAlbumDataItemToResponse maps non-export response with cover image URL', () => {
  const recommendationMap = new Map([
    ['album-2', { recommendedBy: 'bob', recommendedAt: '2025-02-01' }],
  ]);

  const result = mapAlbumDataItemToResponse(
    {
      _id: 'item-2',
      artist: 'Another Artist',
      album: 'Another Album',
      albumId: 'album-2',
      releaseDate: '2023-10-01',
      country: 'SE',
      genre1: 'Rock',
      genre2: 'Alt',
      primaryTrack: 'Song 1',
      secondaryTrack: null,
      comments: null,
      comments2: null,
      tracks: null,
      coverImageFormat: 'png',
      summary: null,
      summarySource: null,
    },
    {
      recommendationMap,
      isExport: false,
      index: 0,
      getPointsForPosition: () => 500,
    }
  );

  assert.strictEqual(result.cover_image_url, '/api/albums/album-2/cover');
  assert.strictEqual(result.track_pick, 'Song 1');
  assert.strictEqual(result.comments_2, '');
  assert.strictEqual(result.recommended_by, 'bob');
  assert.strictEqual(result.recommended_at, '2025-02-01');
  assert.strictEqual('cover_image' in result, false);
  assert.strictEqual('points' in result, false);
});

test('mapAlbumDataItemToResponse maps export payload with base64 image and points', () => {
  const coverBuffer = Buffer.from('image-data');

  const result = mapAlbumDataItemToResponse(
    {
      _id: 'item-3',
      artist: 'Export Artist',
      album: 'Export Album',
      albumId: '',
      releaseDate: '',
      country: '',
      genre1: '',
      genre2: '',
      primaryTrack: null,
      secondaryTrack: null,
      comments: '',
      comments2: '',
      tracks: null,
      coverImage: coverBuffer,
      coverImageFormat: 'jpeg',
      summary: '',
      summarySource: '',
    },
    {
      isExport: true,
      index: 2,
      getPointsForPosition: (position) => position * 10,
    }
  );

  assert.strictEqual(result.cover_image, coverBuffer.toString('base64'));
  assert.strictEqual(result.rank, 3);
  assert.strictEqual(result.points, 30);
  assert.strictEqual(result.track_pick, '');
  assert.strictEqual(result.primary_track, null);
  assert.strictEqual(result.secondary_track, null);
});
