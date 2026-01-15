const test = require('node:test');
const assert = require('node:assert');
const { createLastfmAuth } = require('../utils/lastfm-auth.js');

// Mock logger
const createMockLogger = () => ({
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
});

// Mock crypto with real MD5 for signature tests
const createMockCrypto = () => require('crypto');

// =============================================================================
// generateSignature tests
// =============================================================================

test('generateSignature should generate a valid MD5 hash', () => {
  const { generateSignature } = createLastfmAuth({
    logger: createMockLogger(),
    crypto: createMockCrypto(),
  });

  const params = {
    api_key: 'testkey',
    method: 'auth.getSession',
    token: 'testtoken',
  };
  const sig = generateSignature(params, 'testsecret');

  assert.strictEqual(typeof sig, 'string');
  assert.strictEqual(sig.length, 32); // MD5 hex is always 32 chars
});

test('generateSignature should sort params alphabetically', () => {
  const { generateSignature } = createLastfmAuth({
    logger: createMockLogger(),
    crypto: createMockCrypto(),
  });

  const params1 = { z: '1', a: '2', m: '3' };
  const params2 = { a: '2', m: '3', z: '1' };
  const sig1 = generateSignature(params1, 'secret');
  const sig2 = generateSignature(params2, 'secret');

  assert.strictEqual(
    sig1,
    sig2,
    'Signatures should match regardless of param order'
  );
});

test('generateSignature should produce different hashes for different secrets', () => {
  const { generateSignature } = createLastfmAuth({
    logger: createMockLogger(),
    crypto: createMockCrypto(),
  });

  const params = { api_key: 'test', method: 'test' };
  const sig1 = generateSignature(params, 'secret1');
  const sig2 = generateSignature(params, 'secret2');

  assert.notStrictEqual(
    sig1,
    sig2,
    'Different secrets should produce different signatures'
  );
});

// =============================================================================
// isSessionValid tests
// =============================================================================

test('isSessionValid should return true for valid session', () => {
  const { isSessionValid } = createLastfmAuth({ logger: createMockLogger() });

  assert.strictEqual(
    isSessionValid({ session_key: 'abc123', username: 'testuser' }),
    true
  );
});

test('isSessionValid should return false for missing session_key', () => {
  const { isSessionValid } = createLastfmAuth({ logger: createMockLogger() });

  assert.strictEqual(isSessionValid({ username: 'testuser' }), false);
});

test('isSessionValid should return false for missing username', () => {
  const { isSessionValid } = createLastfmAuth({ logger: createMockLogger() });

  assert.strictEqual(isSessionValid({ session_key: 'abc123' }), false);
});

test('isSessionValid should return false for null', () => {
  const { isSessionValid } = createLastfmAuth({ logger: createMockLogger() });

  assert.strictEqual(isSessionValid(null), false);
});

test('isSessionValid should return false for undefined', () => {
  const { isSessionValid } = createLastfmAuth({ logger: createMockLogger() });

  assert.strictEqual(isSessionValid(undefined), false);
});

test('isSessionValid should return false for empty object', () => {
  const { isSessionValid } = createLastfmAuth({ logger: createMockLogger() });

  assert.strictEqual(isSessionValid({}), false);
});

// =============================================================================
// getSession tests
// =============================================================================

test('getSession should exchange token for session key', async () => {
  const mockResponse = {
    session: {
      key: 'session_key_123',
      name: 'testuser',
    },
  };

  const mockFetch = async () => ({
    json: async () => mockResponse,
  });

  const { getSession } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
    crypto: createMockCrypto(),
  });

  const result = await getSession('test_token', 'api_key', 'secret');

  assert.strictEqual(result.session_key, 'session_key_123');
  assert.strictEqual(result.username, 'testuser');
});

test('getSession should throw error on API error', async () => {
  const mockResponse = {
    error: 4,
    message: 'Invalid authentication token',
  };

  const mockFetch = async () => ({
    json: async () => mockResponse,
  });

  const { getSession } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
    crypto: createMockCrypto(),
  });

  await assert.rejects(
    async () => await getSession('invalid_token', 'api_key', 'secret'),
    /Invalid authentication token/
  );
});

// =============================================================================
// getTopAlbums tests
// =============================================================================

test('getTopAlbums should fetch and return albums', async () => {
  const mockResponse = {
    topalbums: {
      album: [
        {
          name: 'Album 1',
          artist: { name: 'Artist 1' },
          playcount: '100',
          mbid: 'mbid-1',
          image: [
            { size: 'extralarge', '#text': 'http://example.com/img1.jpg' },
          ],
        },
        {
          name: 'Album 2',
          artist: { name: 'Artist 2' },
          playcount: '50',
          mbid: 'mbid-2',
          image: [
            { size: 'extralarge', '#text': 'http://example.com/img2.jpg' },
          ],
        },
      ],
    },
  };

  const mockFetch = async (url) => {
    assert.ok(
      url.includes('user.getTopAlbums'),
      'Should call getTopAlbums method'
    );
    assert.ok(url.includes('user=testuser'), 'Should include username');
    return { json: async () => mockResponse };
  };

  const { getTopAlbums } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const albums = await getTopAlbums('testuser', 'overall', 50, 'apikey');

  assert.strictEqual(albums.length, 2);
  assert.strictEqual(albums[0].name, 'Album 1');
  assert.strictEqual(albums[0].artist.name, 'Artist 1');
  assert.strictEqual(albums[0].playcount, '100');
});

test('getTopAlbums should return empty array when no albums', async () => {
  const mockResponse = { topalbums: { album: [] } };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { getTopAlbums } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const albums = await getTopAlbums('testuser', 'overall', 50, 'apikey');
  assert.deepStrictEqual(albums, []);
});

// =============================================================================
// getAlbumInfo tests
// =============================================================================

test('getAlbumInfo should fetch album with user playcount', async () => {
  // Mock responses for the two-step lookup (artist.getTopAlbums then album.getInfo)
  const topAlbumsResponse = {
    topalbums: {
      album: [{ name: 'Test Album', artist: { name: 'Test Artist' } }],
      '@attr': { artist: 'Test Artist' },
    },
  };
  const albumInfoResponse = {
    album: {
      name: 'Test Album',
      artist: 'Test Artist',
      userplaycount: '42',
      playcount: '10000',
      listeners: '5000',
    },
  };

  const mockFetch = async (url) => {
    if (url.includes('artist.getTopAlbums')) {
      return { json: async () => topAlbumsResponse };
    }
    assert.ok(
      url.includes('album.getInfo'),
      'Should call album.getInfo method'
    );
    assert.ok(
      url.includes('username=testuser'),
      'Should include username for playcount'
    );
    return { json: async () => albumInfoResponse };
  };

  const { getAlbumInfo } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const info = await getAlbumInfo(
    'Test Artist',
    'Test Album',
    'testuser',
    'apikey'
  );

  assert.strictEqual(info.userplaycount, '42');
  assert.strictEqual(info.playcount, '10000');
  assert.strictEqual(info.listeners, '5000');
});

test('getAlbumInfo should return zeros for album not found', async () => {
  const mockResponse = {
    error: 6,
    message: 'Album not found',
  };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { getAlbumInfo } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const info = await getAlbumInfo('Unknown', 'Unknown', 'testuser', 'apikey');

  assert.strictEqual(info.userplaycount, '0');
  assert.strictEqual(info.playcount, '0');
});

test('getAlbumInfo should return zeros when artist.getTopAlbums fails and album.getInfo also fails', async () => {
  // With the new variant-detection logic, getAlbumInfo now first tries artist.getTopAlbums,
  // then falls back to album.getInfo. If both fail, it returns zeros (doesn't throw).
  const mockResponse = {
    error: 8,
    message: 'Operation failed',
  };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { getAlbumInfo } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  // Should return zeros (not found) when all lookups fail
  const info = await getAlbumInfo('Artist', 'Album', 'testuser', 'apikey');
  assert.strictEqual(info.userplaycount, '0');
  assert.strictEqual(info.playcount, '0');
  assert.strictEqual(info.notFound, true);
});

// =============================================================================
// getRecentTracks tests
// =============================================================================

test('getRecentTracks should fetch recent listening history', async () => {
  const mockResponse = {
    recenttracks: {
      track: [
        {
          name: 'Track 1',
          artist: { '#text': 'Artist 1' },
          album: { '#text': 'Album 1' },
          date: { uts: '1699999999' },
        },
        {
          name: 'Track 2',
          artist: { '#text': 'Artist 2' },
          album: { '#text': 'Album 2' },
          '@attr': { nowplaying: 'true' },
        },
      ],
    },
  };

  const mockFetch = async (url) => {
    assert.ok(
      url.includes('user.getRecentTracks'),
      'Should call getRecentTracks'
    );
    return { json: async () => mockResponse };
  };

  const { getRecentTracks } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const tracks = await getRecentTracks('testuser', 50, 'apikey');

  assert.strictEqual(tracks.length, 2);
  assert.strictEqual(tracks[0].name, 'Track 1');
  assert.strictEqual(tracks[1]['@attr'].nowplaying, 'true');
});

// =============================================================================
// scrobble tests
// =============================================================================

test('scrobble should POST to Last.fm API with correct parameters', async () => {
  const mockResponse = {
    scrobbles: {
      '@attr': { accepted: 1, ignored: 0 },
    },
  };

  let capturedBody;
  const mockFetch = async (url, options) => {
    assert.strictEqual(options.method, 'POST');
    assert.ok(
      options.headers['Content-Type'].includes(
        'application/x-www-form-urlencoded'
      )
    );
    capturedBody = options.body.toString();
    return { json: async () => mockResponse };
  };

  const { scrobble } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
    crypto: createMockCrypto(),
  });

  const result = await scrobble(
    {
      artist: 'Test Artist',
      track: 'Test Track',
      album: 'Test Album',
      duration: 180000,
    },
    'session_key',
    'api_key',
    'secret'
  );

  assert.ok(capturedBody.includes('artist=Test+Artist'));
  assert.ok(capturedBody.includes('track=Test+Track'));
  assert.ok(capturedBody.includes('album=Test+Album'));
  assert.ok(capturedBody.includes('method=track.scrobble'));
  assert.strictEqual(result.scrobbles['@attr'].accepted, 1);
});

test('scrobble should include timestamp', async () => {
  const mockResponse = { scrobbles: { '@attr': { accepted: 1 } } };

  let capturedBody;
  const mockFetch = async (url, options) => {
    capturedBody = options.body.toString();
    return { json: async () => mockResponse };
  };

  const { scrobble } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
    crypto: createMockCrypto(),
  });

  const customTimestamp = 1699999999;
  await scrobble(
    { artist: 'Test', track: 'Test', timestamp: customTimestamp },
    'session_key',
    'api_key',
    'secret'
  );

  assert.ok(capturedBody.includes(`timestamp=${customTimestamp}`));
});

// =============================================================================
// updateNowPlaying tests
// =============================================================================

test('updateNowPlaying should POST to Last.fm API', async () => {
  const mockResponse = {
    nowplaying: {
      artist: { '#text': 'Test Artist' },
      track: { '#text': 'Test Track' },
    },
  };

  let capturedBody;
  const mockFetch = async (url, options) => {
    assert.strictEqual(options.method, 'POST');
    capturedBody = options.body.toString();
    return { json: async () => mockResponse };
  };

  const { updateNowPlaying } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
    crypto: createMockCrypto(),
  });

  const result = await updateNowPlaying(
    { artist: 'Test Artist', track: 'Test Track', album: 'Test Album' },
    'session_key',
    'api_key',
    'secret'
  );

  assert.ok(capturedBody.includes('method=track.updateNowPlaying'));
  assert.ok(capturedBody.includes('artist=Test+Artist'));
  assert.ok(result.nowplaying);
});

// =============================================================================
// getSimilarArtists tests
// =============================================================================

test('getSimilarArtists should fetch similar artists with match scores', async () => {
  const mockResponse = {
    similarartists: {
      artist: [
        {
          name: 'Similar Artist 1',
          match: '0.95',
          url: 'http://lastfm.com/artist1',
        },
        {
          name: 'Similar Artist 2',
          match: '0.85',
          url: 'http://lastfm.com/artist2',
        },
      ],
    },
  };

  const mockFetch = async (url) => {
    assert.ok(url.includes('artist.getSimilar'));
    assert.ok(url.includes('artist=Test+Artist'));
    return { json: async () => mockResponse };
  };

  const { getSimilarArtists } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const artists = await getSimilarArtists('Test Artist', 10, 'apikey');

  assert.strictEqual(artists.length, 2);
  assert.strictEqual(artists[0].name, 'Similar Artist 1');
  assert.strictEqual(artists[0].match, '0.95');
});

// =============================================================================
// getTagTopArtists tests
// =============================================================================

test('getTagTopArtists should fetch top artists for a tag/genre', async () => {
  const mockResponse = {
    topartists: {
      artist: [
        {
          name: 'Black Metal Artist 1',
          count: '100000',
          mbid: 'artist-mbid-1',
        },
        {
          name: 'Black Metal Artist 2',
          count: '80000',
          mbid: 'artist-mbid-2',
        },
      ],
    },
  };

  const mockFetch = async (url) => {
    assert.ok(url.includes('tag.getTopArtists'));
    assert.ok(url.includes('tag=black+metal'));
    return { json: async () => mockResponse };
  };

  const { getTagTopArtists } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const artists = await getTagTopArtists('black metal', 10, 'apikey');

  assert.strictEqual(artists.length, 2);
  assert.strictEqual(artists[0].name, 'Black Metal Artist 1');
  assert.strictEqual(artists[0].count, '100000');
});

test('getTagTopArtists should return empty array for unknown tag', async () => {
  const mockResponse = {
    error: 6,
    message: 'Tag not found',
  };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { getTagTopArtists } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const artists = await getTagTopArtists('nonexistent-genre-xyz', 10, 'apikey');

  assert.strictEqual(artists.length, 0);
});

// =============================================================================
// getArtistTopAlbums tests
// =============================================================================

test('getArtistTopAlbums should fetch artist top albums', async () => {
  const mockResponse = {
    topalbums: {
      album: [
        {
          name: 'Top Album 1',
          playcount: '50000',
          artist: { name: 'Test Artist' },
        },
        {
          name: 'Top Album 2',
          playcount: '30000',
          artist: { name: 'Test Artist' },
        },
      ],
    },
  };

  const mockFetch = async (url) => {
    assert.ok(url.includes('artist.getTopAlbums'));
    return { json: async () => mockResponse };
  };

  const { getArtistTopAlbums } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const albums = await getArtistTopAlbums('Test Artist', 10, 'apikey');

  assert.strictEqual(albums.length, 2);
  assert.strictEqual(albums[0].name, 'Top Album 1');
  assert.strictEqual(albums[0].playcount, '50000');
});

// =============================================================================
// Error handling tests
// =============================================================================

test('getTopAlbums should throw on API errors', async () => {
  const mockResponse = {
    error: 8,
    message: 'Operation failed',
  };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { getTopAlbums } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  await assert.rejects(
    async () => await getTopAlbums('testuser', 'overall', 50, 'apikey'),
    /Operation failed/
  );
});

test('getRecentTracks should throw on API errors', async () => {
  const mockResponse = {
    error: 17,
    message: 'User not found',
  };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { getRecentTracks } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  await assert.rejects(
    async () => await getRecentTracks('unknownuser', 50, 'apikey'),
    /User not found/
  );
});

test('getSimilarArtists should return empty array for unknown artist (error 6)', async () => {
  const mockResponse = {
    error: 6,
    message: 'Artist not found',
  };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { getSimilarArtists } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const result = await getSimilarArtists('Unknown Artist', 10, 'apikey');
  assert.deepStrictEqual(result, []);
});

test('getSimilarArtists should throw on non-404 API errors', async () => {
  const mockResponse = {
    error: 8,
    message: 'Operation failed',
  };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { getSimilarArtists } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  await assert.rejects(
    async () => await getSimilarArtists('Test Artist', 10, 'apikey'),
    /Operation failed/
  );
});

test('getArtistTopAlbums should return empty array for unknown artist (error 6)', async () => {
  const mockResponse = {
    error: 6,
    message: 'Artist not found',
  };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { getArtistTopAlbums } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const result = await getArtistTopAlbums('Unknown Artist', 10, 'apikey');
  assert.deepStrictEqual(result, []);
});

test('getArtistTopAlbums should throw on non-404 API errors', async () => {
  const mockResponse = {
    error: 8,
    message: 'Operation failed',
  };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { getArtistTopAlbums } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  await assert.rejects(
    async () => await getArtistTopAlbums('Test Artist', 10, 'apikey'),
    /Operation failed/
  );
});

test('scrobble should throw on API errors', async () => {
  const mockResponse = {
    error: 9,
    message: 'Invalid session key',
  };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { scrobble } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
    crypto: createMockCrypto(),
  });

  await assert.rejects(
    async () =>
      await scrobble(
        { artist: 'Test', track: 'Test' },
        'invalid_session',
        'api_key',
        'secret'
      ),
    /Invalid session key/
  );
});

test('updateNowPlaying should throw on API errors', async () => {
  const mockResponse = {
    error: 9,
    message: 'Invalid session key',
  };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { updateNowPlaying } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
    crypto: createMockCrypto(),
  });

  await assert.rejects(
    async () =>
      await updateNowPlaying(
        { artist: 'Test', track: 'Test' },
        'invalid_session',
        'api_key',
        'secret'
      ),
    /Invalid session key/
  );
});

// =============================================================================
// getTopArtists tests
// =============================================================================

test('getTopArtists should fetch and transform artist data', async () => {
  const mockResponse = {
    topartists: {
      artist: [
        {
          name: 'Artist 1',
          playcount: '500',
          mbid: 'mbid-1',
          url: 'http://lastfm.com/artist1',
          '@attr': { rank: '1' },
        },
        {
          name: 'Artist 2',
          playcount: '300',
          mbid: 'mbid-2',
          url: 'http://lastfm.com/artist2',
          '@attr': { rank: '2' },
        },
      ],
      '@attr': { total: '100' },
    },
  };

  const mockFetch = async (url) => {
    assert.ok(url.includes('user.getTopArtists'));
    assert.ok(url.includes('user=testuser'));
    assert.ok(url.includes('period=overall'));
    return { json: async () => mockResponse };
  };

  const { getTopArtists } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const result = await getTopArtists('testuser', 'overall', 50, 'apikey');

  assert.strictEqual(result.artists.length, 2);
  assert.strictEqual(result.artists[0].name, 'Artist 1');
  assert.strictEqual(result.artists[0].playcount, 500);
  assert.strictEqual(result.artists[0].rank, 1);
  assert.strictEqual(result.total, 100);
  assert.strictEqual(result.period, 'overall');
});

test('getTopArtists should handle missing optional fields', async () => {
  const mockResponse = {
    topartists: {
      artist: [{ name: 'Artist 1', playcount: '100' }],
    },
  };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { getTopArtists } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const result = await getTopArtists('testuser', '7day', 50, 'apikey');

  assert.strictEqual(result.artists[0].mbid, null);
  assert.strictEqual(result.artists[0].rank, 0);
});

test('getTopArtists should throw on API errors', async () => {
  const mockResponse = { error: 17, message: 'User not found' };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { getTopArtists } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  await assert.rejects(
    async () => await getTopArtists('unknown', 'overall', 50, 'apikey'),
    /User not found/
  );
});

// =============================================================================
// getTopTags tests
// =============================================================================

test('getTopTags should fetch user top tags', async () => {
  const mockResponse = {
    toptags: {
      tag: [
        {
          name: 'black metal',
          count: '150',
          url: 'http://lastfm.com/tag/black+metal',
        },
        {
          name: 'post-rock',
          count: '100',
          url: 'http://lastfm.com/tag/post-rock',
        },
      ],
    },
  };

  const mockFetch = async (url) => {
    assert.ok(url.includes('user.getTopTags'));
    assert.ok(url.includes('user=testuser'));
    return { json: async () => mockResponse };
  };

  const { getTopTags } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const result = await getTopTags('testuser', 50, 'apikey');

  assert.strictEqual(result.tags.length, 2);
  assert.strictEqual(result.tags[0].name, 'black metal');
  assert.strictEqual(result.tags[0].count, 150);
});

test('getTopTags should throw on API errors', async () => {
  const mockResponse = { error: 17, message: 'User not found' };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { getTopTags } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  await assert.rejects(
    async () => await getTopTags('unknown', 50, 'apikey'),
    /User not found/
  );
});

// =============================================================================
// getUserInfo tests
// =============================================================================

test('getUserInfo should fetch user profile data', async () => {
  const mockResponse = {
    user: {
      name: 'testuser',
      realname: 'Test User',
      playcount: '50000',
      artist_count: '500',
      album_count: '1000',
      track_count: '5000',
      registered: { unixtime: '1500000000' },
      country: 'Norway',
      url: 'http://lastfm.com/user/testuser',
      image: [{ size: 'large', '#text': 'http://img.com/user.jpg' }],
    },
  };

  const mockFetch = async (url) => {
    assert.ok(url.includes('user.getInfo'));
    assert.ok(url.includes('user=testuser'));
    return { json: async () => mockResponse };
  };

  const { getUserInfo } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const result = await getUserInfo('testuser', 'apikey');

  assert.strictEqual(result.username, 'testuser');
  assert.strictEqual(result.realname, 'Test User');
  assert.strictEqual(result.playcount, 50000);
  assert.strictEqual(result.artist_count, 500);
  assert.strictEqual(result.album_count, 1000);
  assert.strictEqual(result.track_count, 5000);
  assert.strictEqual(result.country, 'Norway');
  assert.ok(result.registered instanceof Date);
});

test('getUserInfo should handle missing optional fields', async () => {
  const mockResponse = {
    user: {
      name: 'testuser',
      playcount: '100',
    },
  };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { getUserInfo } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const result = await getUserInfo('testuser', 'apikey');

  assert.strictEqual(result.realname, null);
  assert.strictEqual(result.country, null);
  assert.strictEqual(result.registered, null);
});

test('getUserInfo should throw on API errors', async () => {
  const mockResponse = { error: 17, message: 'User not found' };

  const mockFetch = async () => ({ json: async () => mockResponse });

  const { getUserInfo } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  await assert.rejects(
    async () => await getUserInfo('unknown', 'apikey'),
    /User not found/
  );
});

// =============================================================================
// getAllTopArtists tests
// =============================================================================

test('getAllTopArtists should fetch all time periods in parallel', async () => {
  const fetchCalls = [];

  const mockFetch = async (url) => {
    fetchCalls.push(url);
    const period = url.match(/period=([^&]+)/)?.[1] || 'overall';
    return {
      json: async () => ({
        topartists: {
          artist: [{ name: `Artist_${period}`, playcount: '100' }],
          '@attr': { total: '1' },
        },
      }),
    };
  };

  const { getAllTopArtists } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const result = await getAllTopArtists('testuser', 50, 'apikey');

  assert.strictEqual(fetchCalls.length, 6);
  assert.ok(result['7day']);
  assert.ok(result['1month']);
  assert.ok(result['3month']);
  assert.ok(result['6month']);
  assert.ok(result['12month']);
  assert.ok(result['overall']);
  assert.strictEqual(result['7day'][0].name, 'Artist_7day');
  assert.strictEqual(result['overall'][0].name, 'Artist_overall');
});

// =============================================================================
// getAllTopAlbums tests
// =============================================================================

test('getAllTopAlbums should fetch all time periods and transform data', async () => {
  const mockFetch = async (url) => {
    const period = url.match(/period=([^&]+)/)?.[1] || 'overall';
    return {
      json: async () => ({
        topalbums: {
          album: [
            {
              name: `Album_${period}`,
              artist: { name: 'Test Artist' },
              playcount: '50',
              mbid: 'mbid-1',
              url: 'http://lastfm.com/album',
              '@attr': { rank: '1' },
            },
          ],
        },
      }),
    };
  };

  const { getAllTopAlbums } = createLastfmAuth({
    logger: createMockLogger(),
    fetch: mockFetch,
  });

  const result = await getAllTopAlbums('testuser', 50, 'apikey');

  assert.ok(result['7day']);
  assert.ok(result['overall']);
  assert.strictEqual(result['7day'][0].name, 'Album_7day');
  assert.strictEqual(result['7day'][0].artist, 'Test Artist');
  assert.strictEqual(result['7day'][0].playcount, 50);
  assert.strictEqual(result['7day'][0].rank, 1);
});
