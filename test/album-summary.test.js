const test = require('node:test');
const assert = require('node:assert');
const {
  stripHtml,
  generateNameVariations,
  buildLastfmUrl,
  buildWikipediaSearchQuery,
  createAlbumSummaryService,
  fetchAlbumSummary,
  fetchWikipediaSummary,
  SUMMARY_SOURCES,
} = require('../utils/album-summary.js');

// =============================================================================
// stripHtml tests
// =============================================================================

test('stripHtml should remove basic HTML tags', () => {
  const result = stripHtml('<p>Hello <b>World</b></p>');
  assert.strictEqual(result, 'Hello World');
});

test('stripHtml should remove Last.fm "Read more" links', () => {
  const html =
    'Album description <a href="https://www.last.fm/music/Artist/Album">Read more on Last.fm</a>';
  const result = stripHtml(html);
  assert.strictEqual(result, 'Album description');
});

test('stripHtml should decode HTML entities', () => {
  const html = '&amp; &lt; &gt; &quot; &#39; &nbsp;';
  const result = stripHtml(html);
  assert.strictEqual(result, '& < > " \'');
});

test('stripHtml should normalize whitespace', () => {
  const html = '  Multiple   spaces   and\n\nnewlines  ';
  const result = stripHtml(html);
  assert.strictEqual(result, 'Multiple spaces and newlines');
});

test('stripHtml should handle empty string', () => {
  assert.strictEqual(stripHtml(''), '');
});

test('stripHtml should handle null/undefined', () => {
  assert.strictEqual(stripHtml(null), '');
  assert.strictEqual(stripHtml(undefined), '');
});

test('stripHtml should handle complex HTML', () => {
  const html =
    '<div class="wiki-content"><p>This is a <strong>great</strong> album.</p><a href="http://last.fm">Read more on Last.fm</a></div>';
  const result = stripHtml(html);
  assert.strictEqual(result, 'This is a great album.');
});

// =============================================================================
// generateNameVariations tests
// =============================================================================

test('generateNameVariations should return original name', () => {
  const variations = generateNameVariations('OK Computer');
  assert.ok(variations.includes('OK Computer'));
});

test('generateNameVariations should remove "The " prefix', () => {
  const variations = generateNameVariations('The Beatles');
  assert.ok(variations.includes('The Beatles'));
  assert.ok(variations.includes('Beatles'));
});

test('generateNameVariations should remove parenthetical content', () => {
  const variations = generateNameVariations('Abbey Road (Remastered)');
  assert.ok(variations.includes('Abbey Road (Remastered)'));
  assert.ok(variations.includes('Abbey Road'));
});

test('generateNameVariations should normalize smart quotes', () => {
  const variations = generateNameVariations("What's Going On");
  // Should include the original with smart quote
  assert.ok(variations.some((v) => v.includes("'")));
});

test('generateNameVariations should handle multiple variations', () => {
  const variations = generateNameVariations(
    'The Dark Side of the Moon (2011 Remaster)'
  );
  assert.ok(variations.length >= 2);
  assert.ok(variations.includes('The Dark Side of the Moon (2011 Remaster)'));
  assert.ok(variations.some((v) => !v.includes('('))); // Without parentheses
});

test('generateNameVariations should return empty array for empty input', () => {
  assert.deepStrictEqual(generateNameVariations(''), []);
  assert.deepStrictEqual(generateNameVariations(null), []);
  assert.deepStrictEqual(generateNameVariations(undefined), []);
});

test('generateNameVariations should deduplicate', () => {
  const variations = generateNameVariations('Simple Name');
  // Should not have duplicates
  const uniqueSet = new Set(variations);
  assert.strictEqual(variations.length, uniqueSet.size);
});

// =============================================================================
// buildLastfmUrl tests
// =============================================================================

test('buildLastfmUrl should build correct URL', () => {
  const url = buildLastfmUrl('Radiohead', 'OK Computer');
  assert.strictEqual(url, 'https://www.last.fm/music/Radiohead/OK+Computer');
});

test('buildLastfmUrl should encode special characters', () => {
  const url = buildLastfmUrl('AC/DC', 'Back in Black');
  assert.ok(url.includes('AC%2FDC'));
  assert.ok(url.includes('Back+in+Black'));
});

test('buildLastfmUrl should handle spaces', () => {
  const url = buildLastfmUrl('Pink Floyd', 'The Dark Side of the Moon');
  assert.strictEqual(
    url,
    'https://www.last.fm/music/Pink+Floyd/The+Dark+Side+of+the+Moon'
  );
});

test('buildLastfmUrl should handle ampersand', () => {
  const url = buildLastfmUrl('Simon & Garfunkel', 'Bridge Over Troubled Water');
  assert.ok(url.includes('Simon+%26+Garfunkel'));
});

// =============================================================================
// createAlbumSummaryService tests
// =============================================================================

// Mock logger
const createMockLogger = () => ({
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
});

// Mock pool
const createMockPool = (rows = []) => ({
  query: async () => ({ rows }),
});

test('createAlbumSummaryService should throw without pool', () => {
  assert.throws(() => {
    createAlbumSummaryService({ logger: createMockLogger() });
  }, /Database pool is required/);
});

test('createAlbumSummaryService should create service with pool', () => {
  const service = createAlbumSummaryService({
    pool: createMockPool(),
    logger: createMockLogger(),
  });

  assert.ok(service);
  assert.strictEqual(typeof service.fetchAndStoreSummary, 'function');
  assert.strictEqual(typeof service.fetchSummaryAsync, 'function');
  assert.strictEqual(typeof service.getBatchStatus, 'function');
  assert.strictEqual(typeof service.getStats, 'function');
  assert.strictEqual(typeof service.startBatchFetch, 'function');
  assert.strictEqual(typeof service.stopBatchFetch, 'function');
});

test('getBatchStatus should return null when no job running', () => {
  const service = createAlbumSummaryService({
    pool: createMockPool(),
    logger: createMockLogger(),
  });

  const status = service.getBatchStatus();
  assert.strictEqual(status, null);
});

test('getStats should return album statistics', async () => {
  const mockPool = {
    query: async () => ({
      rows: [
        {
          total_albums: '100',
          with_summary: '50',
          attempted_no_summary: '20',
          never_attempted: '30',
          from_lastfm: '35',
          from_wikipedia: '15',
        },
      ],
    }),
  };

  const service = createAlbumSummaryService({
    pool: mockPool,
    logger: createMockLogger(),
  });

  const stats = await service.getStats();

  assert.strictEqual(stats.totalAlbums, 100);
  assert.strictEqual(stats.withSummary, 50);
  assert.strictEqual(stats.attemptedNoSummary, 20);
  assert.strictEqual(stats.neverAttempted, 30);
  assert.strictEqual(stats.pending, 50); // neverAttempted + attemptedNoSummary
  assert.strictEqual(stats.fromLastfm, 35);
  assert.strictEqual(stats.fromWikipedia, 15);
});

test('stopBatchFetch should return false when no job running', () => {
  const service = createAlbumSummaryService({
    pool: createMockPool(),
    logger: createMockLogger(),
  });

  const stopped = service.stopBatchFetch();
  assert.strictEqual(stopped, false);
});

test('startBatchFetch should throw if already running', async () => {
  const mockPool = {
    query: async (query) => {
      // Return albums for the initial query (now uses JOIN with list_items)
      if (query.includes('SELECT DISTINCT a.album_id')) {
        return {
          rows: [{ album_id: 'test1', artist: 'Test', album: 'Album' }],
        };
      }
      return { rows: [] };
    },
  };

  const service = createAlbumSummaryService({
    pool: mockPool,
    logger: createMockLogger(),
  });

  // Start first batch job
  await service.startBatchFetch();

  // Try to start another - should throw
  await assert.rejects(async () => {
    await service.startBatchFetch();
  }, /Batch job already running/);

  // Clean up
  service.stopBatchFetch();
});

test('fetchAndStoreSummary should return error for missing album', async () => {
  const mockPool = {
    query: async () => ({ rows: [] }),
  };

  const service = createAlbumSummaryService({
    pool: mockPool,
    logger: createMockLogger(),
  });

  const result = await service.fetchAndStoreSummary('nonexistent');

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'Album not found');
});

// =============================================================================
// Helper function exports tests
// =============================================================================

test('module should export helper functions for testing', () => {
  const module = require('../utils/album-summary.js');

  assert.strictEqual(typeof module.stripHtml, 'function');
  assert.strictEqual(typeof module.generateNameVariations, 'function');
  assert.strictEqual(typeof module.buildLastfmUrl, 'function');
  assert.strictEqual(typeof module.buildWikipediaSearchQuery, 'function');
  assert.strictEqual(typeof module.createAlbumSummaryService, 'function');
  assert.strictEqual(typeof module.getDefaultInstance, 'function');
  assert.strictEqual(typeof module.fetchAlbumSummary, 'function');
  assert.strictEqual(typeof module.fetchWikipediaSummary, 'function');
  assert.ok(module.SUMMARY_SOURCES);
});

// =============================================================================
// SUMMARY_SOURCES constants tests
// =============================================================================

test('SUMMARY_SOURCES should have lastfm and wikipedia', () => {
  assert.strictEqual(SUMMARY_SOURCES.LASTFM, 'lastfm');
  assert.strictEqual(SUMMARY_SOURCES.WIKIPEDIA, 'wikipedia');
});

// =============================================================================
// buildWikipediaSearchQuery tests
// =============================================================================

test('buildWikipediaSearchQuery should build correct search query', () => {
  const query = buildWikipediaSearchQuery('The Beatles', 'Abbey Road');
  assert.strictEqual(query, 'Abbey Road album The Beatles');
});

test('buildWikipediaSearchQuery should include album and artist', () => {
  const query = buildWikipediaSearchQuery(
    'Daft Punk',
    'Random Access Memories'
  );
  assert.ok(query.includes('Random Access Memories'));
  assert.ok(query.includes('Daft Punk'));
  assert.ok(query.includes('album'));
});

// =============================================================================
// fetchWikipediaSummary tests (with mocked fetch)
// =============================================================================

test('fetchWikipediaSummary should return not found for empty input', async () => {
  const result = await fetchWikipediaSummary('', '', () => {});
  assert.strictEqual(result.found, false);
  assert.strictEqual(result.summary, null);
  assert.strictEqual(result.wikipediaUrl, null);
});

test('fetchWikipediaSummary should return not found for null input', async () => {
  const result = await fetchWikipediaSummary(null, null, () => {});
  assert.strictEqual(result.found, false);
});

test('fetchWikipediaSummary should handle search with no results', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({ query: { search: [] } }),
  });

  const result = await fetchWikipediaSummary(
    'Unknown Artist',
    'Unknown Album',
    mockFetch
  );
  assert.strictEqual(result.found, false);
  assert.strictEqual(result.summary, null);
});

test('fetchWikipediaSummary should handle search API failure', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 500,
  });

  const result = await fetchWikipediaSummary(
    'Test Artist',
    'Test Album',
    mockFetch
  );
  assert.strictEqual(result.found, false);
});

test('fetchWikipediaSummary should return summary for matching album', async () => {
  const mockFetch = async (url) => {
    if (url.includes('/w/api.php')) {
      // Search API
      return {
        ok: true,
        json: async () => ({
          query: {
            search: [
              {
                title: 'Abbey Road',
                snippet:
                  'Abbey Road is the eleventh studio album by the English rock band the Beatles',
              },
            ],
          },
        }),
      };
    } else if (url.includes('/api/rest_v1/page/summary')) {
      // Summary API
      return {
        ok: true,
        json: async () => ({
          title: 'Abbey Road',
          description: '1969 studio album by the Beatles',
          extract:
            'Abbey Road is the eleventh studio album by the English rock band the Beatles.',
          content_urls: {
            desktop: { page: 'https://en.wikipedia.org/wiki/Abbey_Road' },
          },
        }),
      };
    }
    return { ok: false };
  };

  const result = await fetchWikipediaSummary(
    'The Beatles',
    'Abbey Road',
    mockFetch
  );

  assert.strictEqual(result.found, true);
  assert.ok(result.summary.includes('Abbey Road'));
  assert.strictEqual(
    result.wikipediaUrl,
    'https://en.wikipedia.org/wiki/Abbey_Road'
  );
});

test('fetchWikipediaSummary should reject non-album Wikipedia pages', async () => {
  const mockFetch = async (url) => {
    if (url.includes('/w/api.php')) {
      return {
        ok: true,
        json: async () => ({
          query: {
            search: [
              {
                title: 'Abbey Road, London',
                snippet:
                  'Abbey Road is a road in London known for its recording studios',
              },
            ],
          },
        }),
      };
    } else if (url.includes('/api/rest_v1/page/summary')) {
      return {
        ok: true,
        json: async () => ({
          title: 'Abbey Road, London',
          description: 'Street in London, England',
          extract: 'Abbey Road is a road in the City of Westminster in London.',
        }),
      };
    }
    return { ok: false };
  };

  const result = await fetchWikipediaSummary(
    'The Beatles',
    'Abbey Road',
    mockFetch
  );

  // Should not match because the description says "Street" not "album"
  assert.strictEqual(result.found, false);
});

// =============================================================================
// fetchAlbumSummary tests (integrated - tries Last.fm then Wikipedia)
// =============================================================================

test('fetchAlbumSummary should return not found for empty input', async () => {
  const result = await fetchAlbumSummary('', '');
  assert.strictEqual(result.found, false);
  assert.strictEqual(result.summary, null);
  assert.strictEqual(result.source, null);
});

test('fetchAlbumSummary should include source in result', async () => {
  // This tests the structure of the result
  const result = await fetchAlbumSummary(
    'NonExistentArtist12345',
    'NonExistentAlbum12345'
  );

  assert.ok('summary' in result);
  assert.ok('lastfmUrl' in result);
  assert.ok('wikipediaUrl' in result);
  assert.ok('source' in result);
  assert.ok('found' in result);
});

// =============================================================================
// getStats should include source breakdown
// =============================================================================

test('getStats should return source breakdown', async () => {
  const mockPool = {
    query: async () => ({
      rows: [
        {
          total_albums: '100',
          with_summary: '50',
          attempted_no_summary: '20',
          never_attempted: '30',
          from_lastfm: '35',
          from_wikipedia: '15',
        },
      ],
    }),
  };

  const service = createAlbumSummaryService({
    pool: mockPool,
    logger: createMockLogger(),
  });

  const stats = await service.getStats();

  assert.strictEqual(stats.totalAlbums, 100);
  assert.strictEqual(stats.withSummary, 50);
  assert.strictEqual(stats.fromLastfm, 35);
  assert.strictEqual(stats.fromWikipedia, 15);
});
