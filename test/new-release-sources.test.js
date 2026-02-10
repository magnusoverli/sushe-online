const test = require('node:test');
const assert = require('node:assert');
const { mock } = require('node:test');
const { createNewReleaseSources } = require('../utils/new-release-sources.js');

// =============================================================================
// Helper: create sources with mocked deps
// =============================================================================

function createTestSources(options = {}) {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };

  const mockNormalizeAlbumKey =
    options.normalizeAlbumKey ||
    ((artist, album) =>
      `${String(artist || '')
        .toLowerCase()
        .trim()}::${String(album || '')
        .toLowerCase()
        .trim()}`);

  const sources = createNewReleaseSources({
    logger: mockLogger,
    fetch: options.fetch || mock.fn(),
    env: options.env || {},
    getClientCredentialsToken:
      options.getClientCredentialsToken || mock.fn(async () => null),
    spotifyApiRequest: options.spotifyApiRequest || mock.fn(async () => ({})),
    normalizeAlbumKey: mockNormalizeAlbumKey,
  });

  return { sources, mockLogger };
}

// =============================================================================
// fetchSpotifyNewReleases
// =============================================================================

test('fetchSpotifyNewReleases should return empty when no token available', async () => {
  const { sources, mockLogger } = createTestSources({
    getClientCredentialsToken: mock.fn(async () => null),
  });

  const result = await sources.fetchSpotifyNewReleases(
    '2025-02-03',
    '2025-02-09'
  );
  assert.deepStrictEqual(result, []);
  assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
});

test('fetchSpotifyNewReleases should fetch and filter by date range', async () => {
  const mockApiRequest = mock.fn(async (url) => {
    // Track fetch request
    if (url.includes('/v1/albums/') && url.includes('/tracks')) {
      return {
        items: [
          { name: 'Track 1', duration_ms: 240000 },
          { name: 'Track 2', duration_ms: 180000 },
        ],
      };
    }
    // New releases request
    return {
      albums: {
        items: [
          {
            name: 'In Range',
            artists: [{ name: 'Artist1' }],
            release_date: '2025-02-05',
            id: 'sp1',
            images: [
              { url: 'https://example.com/640.jpg', width: 640, height: 640 },
              { url: 'https://example.com/300.jpg', width: 300, height: 300 },
            ],
          },
          {
            name: 'Out of Range',
            artists: [{ name: 'Artist2' }],
            release_date: '2025-01-01',
            id: 'sp2',
            images: [],
          },
        ],
        next: null,
      },
    };
  });

  const { sources } = createTestSources({
    getClientCredentialsToken: mock.fn(async () => 'test-token'),
    spotifyApiRequest: mockApiRequest,
  });

  const result = await sources.fetchSpotifyNewReleases(
    '2025-02-03',
    '2025-02-09'
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].album, 'In Range');
  assert.strictEqual(result[0].artist, 'Artist1');
  assert.strictEqual(result[0].spotify_id, 'sp1');
  assert.strictEqual(result[0].cover_image_url, 'https://example.com/640.jpg');
  assert.ok(Array.isArray(result[0].tracks));
  assert.strictEqual(result[0].tracks.length, 2);
  assert.strictEqual(result[0].tracks[0].name, 'Track 1');
});

test('fetchSpotifyNewReleases should handle API errors gracefully', async () => {
  const mockApiRequest = mock.fn(async (url) => {
    if (url.includes('/tracks')) return { items: [] };
    throw new Error('API error');
  });

  const { sources, mockLogger } = createTestSources({
    getClientCredentialsToken: mock.fn(async () => 'test-token'),
    spotifyApiRequest: mockApiRequest,
  });

  const result = await sources.fetchSpotifyNewReleases(
    '2025-02-03',
    '2025-02-09'
  );
  assert.deepStrictEqual(result, []);
  assert.strictEqual(mockLogger.error.mock.calls.length, 1);
});

// =============================================================================
// fetchMusicBrainzNewReleases
// =============================================================================

test('fetchMusicBrainzNewReleases should parse release groups with genres and country', async () => {
  const mockFetch = mock.fn(async () => ({
    ok: true,
    json: async () => ({
      'release-groups': [
        {
          title: 'Test Album',
          'artist-credit': [{ artist: { name: 'Test Artist' } }],
          'first-release-date': '2025-02-05',
          id: 'mb-123',
          tags: [
            { name: 'electronic', count: 5 },
            { name: 'ambient', count: 3 },
            { name: 'experimental', count: 1 },
          ],
          releases: [
            {
              'release-events': [{ area: { name: 'United Kingdom' } }],
            },
          ],
        },
      ],
    }),
  }));

  const { sources } = createTestSources({ fetch: mockFetch });

  const result = await sources.fetchMusicBrainzNewReleases(
    '2025-02-03',
    '2025-02-09'
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].artist, 'Test Artist');
  assert.strictEqual(result[0].album, 'Test Album');
  assert.strictEqual(result[0].musicbrainz_id, 'mb-123');
  assert.strictEqual(result[0].genre_1, 'electronic');
  assert.strictEqual(result[0].genre_2, 'ambient');
  assert.strictEqual(result[0].country, 'United Kingdom');
});

test('fetchMusicBrainzNewReleases should handle API errors', async () => {
  const mockFetch = mock.fn(async () => ({
    ok: false,
    status: 503,
  }));

  const { sources, mockLogger } = createTestSources({ fetch: mockFetch });

  const result = await sources.fetchMusicBrainzNewReleases(
    '2025-02-03',
    '2025-02-09'
  );
  assert.deepStrictEqual(result, []);
  assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
});

test('fetchMusicBrainzNewReleases should handle empty results', async () => {
  const mockFetch = mock.fn(async () => ({
    ok: true,
    json: async () => ({ 'release-groups': [] }),
  }));

  const { sources } = createTestSources({ fetch: mockFetch });

  const result = await sources.fetchMusicBrainzNewReleases(
    '2025-02-03',
    '2025-02-09'
  );
  assert.deepStrictEqual(result, []);
});

test('fetchMusicBrainzNewReleases should handle network errors', async () => {
  const mockFetch = mock.fn(async () => {
    throw new Error('Network error');
  });

  const { sources, mockLogger } = createTestSources({ fetch: mockFetch });

  const result = await sources.fetchMusicBrainzNewReleases(
    '2025-02-03',
    '2025-02-09'
  );
  assert.deepStrictEqual(result, []);
  assert.strictEqual(mockLogger.error.mock.calls.length, 1);
});

// =============================================================================
// fetchClaudeSearchNewReleases
// =============================================================================

test('fetchClaudeSearchNewReleases should parse Claude response', async () => {
  const mockCallClaude = mock.fn(async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify([
          {
            artist: 'Artist1',
            album: 'Album1',
            genre_1: 'Rock',
            genre_2: 'Indie',
            country: 'United States',
            release_date: '2025-02-05',
          },
        ]),
      },
    ],
  }));
  const mockExtract = mock.fn((content) => {
    const textBlocks = content.filter((b) => b.type === 'text');
    return textBlocks
      .map((b) => b.text)
      .join(' ')
      .trim();
  });

  const { sources } = createTestSources();

  const result = await sources.fetchClaudeSearchNewReleases(
    '2025-02-03',
    '2025-02-09',
    mockCallClaude,
    mockExtract
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].artist, 'Artist1');
  assert.strictEqual(result[0].genre_1, 'Rock');
  assert.strictEqual(result[0].genre_2, 'Indie');
  assert.strictEqual(result[0].country, 'United States');
});

test('fetchClaudeSearchNewReleases should handle legacy genre field', async () => {
  const mockCallClaude = mock.fn(async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify([
          {
            artist: 'Artist1',
            album: 'Album1',
            genre: 'Rock',
            release_date: '2025-02-05',
          },
        ]),
      },
    ],
  }));
  const mockExtract = mock.fn((content) => {
    const textBlocks = content.filter((b) => b.type === 'text');
    return textBlocks
      .map((b) => b.text)
      .join(' ')
      .trim();
  });

  const { sources } = createTestSources();

  const result = await sources.fetchClaudeSearchNewReleases(
    '2025-02-03',
    '2025-02-09',
    mockCallClaude,
    mockExtract
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].genre_1, 'Rock');
  assert.strictEqual(result[0].genre_2, '');
});

test('fetchClaudeSearchNewReleases should return empty when no callClaude provided', async () => {
  const { sources } = createTestSources();

  const result = await sources.fetchClaudeSearchNewReleases(
    '2025-02-03',
    '2025-02-09',
    null,
    null
  );
  assert.deepStrictEqual(result, []);
});

test('fetchClaudeSearchNewReleases should handle parse errors', async () => {
  const mockCallClaude = mock.fn(async () => ({
    content: [{ type: 'text', text: 'Not valid JSON' }],
  }));
  const mockExtract = mock.fn(() => 'Not valid JSON');

  const { sources, mockLogger } = createTestSources();

  const result = await sources.fetchClaudeSearchNewReleases(
    '2025-02-03',
    '2025-02-09',
    mockCallClaude,
    mockExtract
  );
  assert.deepStrictEqual(result, []);
  assert.strictEqual(mockLogger.error.mock.calls.length, 1);
});

// =============================================================================
// gatherWeeklyNewReleases
// =============================================================================

test('gatherWeeklyNewReleases should combine and deduplicate from all sources', async () => {
  const mockApiRequest = mock.fn(async (url) => {
    if (url.includes('/tracks')) {
      return { items: [] };
    }
    return {
      albums: {
        items: [
          {
            name: 'Album1',
            artists: [{ name: 'Artist1' }],
            release_date: '2025-02-05',
            id: 'sp1',
            images: [],
          },
        ],
        next: null,
      },
    };
  });

  const mockFetch = mock.fn(async () => ({
    ok: true,
    json: async () => ({
      'release-groups': [
        {
          title: 'Album2',
          'artist-credit': [{ artist: { name: 'Artist2' } }],
          'first-release-date': '2025-02-06',
          id: 'mb1',
        },
        {
          // Duplicate of Spotify entry
          title: 'Album1',
          'artist-credit': [{ artist: { name: 'Artist1' } }],
          'first-release-date': '2025-02-05',
          id: 'mb2',
        },
      ],
    }),
  }));

  const mockCallClaude = mock.fn(async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify([
          {
            artist: 'Artist3',
            album: 'Album3',
            genre_1: 'Jazz',
            country: 'United States',
            release_date: '2025-02-07',
          },
        ]),
      },
    ],
  }));
  const mockExtract = mock.fn((content) => {
    const textBlocks = content.filter((b) => b.type === 'text');
    return textBlocks
      .map((b) => b.text)
      .join(' ')
      .trim();
  });

  const { sources } = createTestSources({
    getClientCredentialsToken: mock.fn(async () => 'test-token'),
    spotifyApiRequest: mockApiRequest,
    fetch: mockFetch,
  });

  const result = await sources.gatherWeeklyNewReleases(
    '2025-02-03',
    '2025-02-09',
    {
      callClaude: mockCallClaude,
      extractTextFromContent: mockExtract,
    }
  );

  // Should have 3 unique albums (Artist1/Album1 deduped)
  assert.strictEqual(result.length, 3);

  // Verify source attribution
  const sources_found = result.map((r) => r.source);
  assert.ok(sources_found.includes('spotify'));
  assert.ok(sources_found.includes('musicbrainz'));
  assert.ok(sources_found.includes('claude_search'));
});

test('gatherWeeklyNewReleases should prefer non-claude sources for duplicates', async () => {
  const mockApiRequest = mock.fn(async (url) => {
    if (url.includes('/tracks')) {
      return { items: [] };
    }
    return { albums: { items: [], next: null } };
  });

  const mockFetch = mock.fn(async () => ({
    ok: true,
    json: async () => ({ 'release-groups': [] }),
  }));

  const mockCallClaude = mock.fn(async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify([
          {
            artist: 'Artist1',
            album: 'Album1',
            genre: 'Rock',
            release_date: '2025-02-05',
          },
        ]),
      },
    ],
  }));
  const mockExtract = mock.fn((content) => {
    const textBlocks = content.filter((b) => b.type === 'text');
    return textBlocks
      .map((b) => b.text)
      .join(' ')
      .trim();
  });

  const { sources } = createTestSources({
    getClientCredentialsToken: mock.fn(async () => 'test-token'),
    spotifyApiRequest: mockApiRequest,
    fetch: mockFetch,
  });

  const result = await sources.gatherWeeklyNewReleases(
    '2025-02-03',
    '2025-02-09',
    {
      callClaude: mockCallClaude,
      extractTextFromContent: mockExtract,
    }
  );

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].source, 'claude_search');
});

test('gatherWeeklyNewReleases should work even when all sources fail', async () => {
  const { sources, mockLogger } = createTestSources({
    getClientCredentialsToken: mock.fn(async () => null),
    fetch: mock.fn(async () => {
      throw new Error('Network error');
    }),
  });

  const result = await sources.gatherWeeklyNewReleases(
    '2025-02-03',
    '2025-02-09',
    {}
  );

  assert.deepStrictEqual(result, []);
  assert.ok(mockLogger.info.mock.calls.length > 0);
});
