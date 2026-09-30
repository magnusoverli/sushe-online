// These are authentication-boundary checks. Authenticated payload, ownership,
// persistence and revision contracts run in test/integration/api-contracts.test.js.
const { test, expect } = require('@playwright/test');

const endpoints = [
  ['post', '/api/lists', { name: 'Anonymous', data: [] }],
  ['post', '/api/groups', { name: 'Anonymous' }],
  ['post', '/api/groups/reorder', { order: [] }],
  [
    'post',
    '/api/track-picks/test-item',
    { trackIdentifier: 'Track', priority: 1 },
  ],
  ['delete', '/api/track-picks/test-item', { trackIdentifier: 'Track' }],
  [
    'put',
    '/api/albums/test-album/summary',
    { summary: 'Test', summary_source: 'manual' },
  ],
  [
    'post',
    '/api/albums/check-similar',
    { artist: 'Test', album: 'Test', album_id: 'test' },
  ],
  [
    'post',
    '/api/albums/mark-distinct',
    { album_id_1: 'one', album_id_2: 'two' },
  ],
  ['put', '/api/spotify/play', { albumId: 'test', deviceId: 'test' }],
  ['put', '/api/spotify/transfer', { device_id: 'test', play: true }],
  ['put', '/api/spotify/seek', { position_ms: 30000 }],
  ['put', '/api/spotify/volume', { volume_percent: 50 }],
  [
    'post',
    '/api/lastfm/scrobble',
    { artist: 'Test', track: 'Test', timestamp: 1 },
  ],
  ['post', '/api/lastfm/now-playing', { artist: 'Test', track: 'Test' }],
  ['post', '/api/playlists/Test', { action: 'check' }],
];

test.describe('Unauthenticated API rejection', () => {
  for (const [method, url, data] of endpoints) {
    test(`${method.toUpperCase()} ${url} rejects unauthenticated requests`, async ({
      request,
    }) => {
      const response = await request[method](url, { data });
      expect(response.status()).toBe(401);
    });
  }
});
