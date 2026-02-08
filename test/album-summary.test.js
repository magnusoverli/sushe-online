const test = require('node:test');
const assert = require('node:assert');
const {
  stripHtml,
  generateNameVariations,
  createAlbumSummaryService,
  fetchAlbumSummary,
  SUMMARY_SOURCES,
} = require('../services/album-summary.js');

// =============================================================================
// stripHtml tests
// =============================================================================

test('stripHtml should remove basic HTML tags', () => {
  const result = stripHtml('<p>Hello <b>World</b></p>');
  assert.strictEqual(result, 'Hello World');
});

test('stripHtml should remove anchor tags but keep text', () => {
  // Note: stripHtml removes HTML tags but keeps the text content
  // Last.fm-specific "Read more" stripping was removed when switching to Claude
  const html =
    'Album description <a href="https://www.last.fm/music/Artist/Album">Read more on Last.fm</a>';
  const result = stripHtml(html);
  assert.strictEqual(result, 'Album description Read more on Last.fm');
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
  // stripHtml removes tags but preserves all text content
  const html =
    '<div class="wiki-content"><p>This is a <strong>great</strong> album.</p><a href="http://last.fm">Read more on Last.fm</a></div>';
  const result = stripHtml(html);
  assert.strictEqual(result, 'This is a great album.Read more on Last.fm');
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
          from_claude: '50',
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
  assert.strictEqual(stats.fromClaude, 50);
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
  let pageCalls = 0;
  const mockPool = {
    query: async (query) => {
      if (query.includes('COUNT(DISTINCT a.album_id)')) {
        return {
          rows: [{ total: '1' }],
        };
      }
      // Return albums for the paged query (now uses JOIN with list_items)
      if (query.includes('SELECT DISTINCT a.album_id')) {
        return {
          rows:
            pageCalls++ === 0
              ? [{ album_id: 'test1', artist: 'Test', album: 'Album' }]
              : [],
        };
      }
      if (query.includes('SELECT album_id, artist, album FROM albums')) {
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

test('fetchAndStoreSummary should skip fetch for empty artist', async () => {
  const mockPool = {
    query: async (query, _params) => {
      if (query.includes('SELECT album_id, artist, album')) {
        return {
          rows: [{ album_id: 'test1', artist: '', album: 'Test Album' }],
        };
      }
      if (query.includes('UPDATE albums SET summary_fetched_at')) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    },
  };

  const service = createAlbumSummaryService({
    pool: mockPool,
    logger: createMockLogger(),
  });

  const result = await service.fetchAndStoreSummary('test1');

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.hasSummary, false);
  assert.strictEqual(result.skipped, true);
});

test('fetchAndStoreSummary should skip fetch for empty album', async () => {
  const mockPool = {
    query: async (query, _params) => {
      if (query.includes('SELECT album_id, artist, album')) {
        return {
          rows: [{ album_id: 'test2', artist: 'Test Artist', album: '' }],
        };
      }
      if (query.includes('UPDATE albums SET summary_fetched_at')) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    },
  };

  const service = createAlbumSummaryService({
    pool: mockPool,
    logger: createMockLogger(),
  });

  const result = await service.fetchAndStoreSummary('test2');

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.hasSummary, false);
  assert.strictEqual(result.skipped, true);
});

test('fetchAndStoreSummary should skip fetch for whitespace-only artist', async () => {
  const mockPool = {
    query: async (query, _params) => {
      if (query.includes('SELECT album_id, artist, album')) {
        return {
          rows: [{ album_id: 'test3', artist: '   ', album: 'Test Album' }],
        };
      }
      if (query.includes('UPDATE albums SET summary_fetched_at')) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    },
  };

  const service = createAlbumSummaryService({
    pool: mockPool,
    logger: createMockLogger(),
  });

  const result = await service.fetchAndStoreSummary('test3');

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.hasSummary, false);
  assert.strictEqual(result.skipped, true);
});

// =============================================================================
// Helper function exports tests
// =============================================================================

test('module should export helper functions for testing', () => {
  const module = require('../services/album-summary.js');

  assert.strictEqual(typeof module.stripHtml, 'function');
  assert.strictEqual(typeof module.generateNameVariations, 'function');
  assert.strictEqual(typeof module.createAlbumSummaryService, 'function');
  assert.strictEqual(typeof module.getDefaultInstance, 'function');
  assert.strictEqual(typeof module.fetchAlbumSummary, 'function');
  assert.ok(module.SUMMARY_SOURCES);
});

// =============================================================================
// SUMMARY_SOURCES constants tests
// =============================================================================

test('SUMMARY_SOURCES should have claude', () => {
  // Claude is now the only summary source (Last.fm/Wikipedia were removed)
  assert.strictEqual(SUMMARY_SOURCES.CLAUDE, 'claude');
});

// =============================================================================
// fetchAlbumSummary tests (uses Claude API)
// =============================================================================

test('fetchAlbumSummary should return not found for empty input', async () => {
  const result = await fetchAlbumSummary('', '');
  assert.strictEqual(result.found, false);
  assert.strictEqual(result.summary, null);
  assert.strictEqual(result.source, null);
});

test('fetchAlbumSummary should include source in result', async () => {
  // This tests the structure of the result
  // Note: This will fail if Claude API key is not set, but that's OK for test structure validation
  const result = await fetchAlbumSummary(
    'NonExistentArtist12345',
    'NonExistentAlbum12345'
  );

  assert.ok('summary' in result);
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
          from_claude: '50',
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
  assert.strictEqual(stats.fromClaude, 50);
});
