/**
 * Tests for services/image-refetch.js
 * Tests the image refetch service that re-downloads album covers from
 * external sources (Cover Art Archive, iTunes) and stores them in the database.
 */

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');

// =============================================================================
// Mock setup
// =============================================================================

// Static mock image buffer (valid 10x10 JPEG) that sharp can process
const MOCK_IMAGE_BASE64 =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAKAAoDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z';
const MOCK_IMAGE_BUFFER = Buffer.from(MOCK_IMAGE_BASE64, 'base64');

const createMockLogger = () => ({
  error: mock.fn(),
  warn: mock.fn(),
  info: mock.fn(),
  debug: mock.fn(),
});

const createMockPool = (overrides = {}) => ({
  query: mock.fn(async () => ({
    rows: [],
    rowCount: 0,
  })),
  ...overrides,
});

// =============================================================================
// createImageRefetchService - factory tests
// =============================================================================

describe('createImageRefetchService', () => {
  // We need to require the module fresh for each test to reset module state
  let createImageRefetchService;

  beforeEach(() => {
    // Clear require cache to get a fresh module instance
    delete require.cache[require.resolve('../services/image-refetch.js')];

    // Mock sharp globally before requiring the module
    const mockSharpInstance = {
      metadata: mock.fn(async () => ({
        width: 300,
        height: 300,
        format: 'jpeg',
      })),
      resize: mock.fn(function () {
        return this;
      }),
      jpeg: mock.fn(function () {
        return this;
      }),
      toBuffer: mock.fn(async () => MOCK_IMAGE_BUFFER),
    };

    // Replace sharp in require cache with a mock
    const sharpPath = require.resolve('sharp');
    require.cache[sharpPath] = {
      id: sharpPath,
      filename: sharpPath,
      loaded: true,
      exports: mock.fn(() => mockSharpInstance),
    };

    ({ createImageRefetchService } = require('../services/image-refetch.js'));
  });

  it('should throw if pool is not provided', () => {
    assert.throws(
      () => createImageRefetchService(),
      /PostgreSQL pool is required/
    );
  });

  it('should throw if pool is null', () => {
    assert.throws(
      () => createImageRefetchService({ pool: null }),
      /PostgreSQL pool is required/
    );
  });

  it('should create service with valid pool', () => {
    const pool = createMockPool();
    const service = createImageRefetchService({ pool });

    assert.ok(service, 'should create a service instance');
    assert.strictEqual(typeof service.getStats, 'function');
    assert.strictEqual(typeof service.isJobRunning, 'function');
    assert.strictEqual(typeof service.stopJob, 'function');
    assert.strictEqual(typeof service.getProgress, 'function');
    assert.strictEqual(typeof service.refetchAllImages, 'function');
  });
});

// =============================================================================
// isJobRunning / stopJob / getProgress - state management
// =============================================================================

describe('Job state management', () => {
  let createImageRefetchService;

  beforeEach(() => {
    delete require.cache[require.resolve('../services/image-refetch.js')];

    const sharpPath = require.resolve('sharp');
    const mockSharpInstance = {
      metadata: mock.fn(async () => ({ width: 300, height: 300 })),
      resize: mock.fn(function () {
        return this;
      }),
      jpeg: mock.fn(function () {
        return this;
      }),
      toBuffer: mock.fn(async () => MOCK_IMAGE_BUFFER),
    };
    require.cache[sharpPath] = {
      id: sharpPath,
      filename: sharpPath,
      loaded: true,
      exports: mock.fn(() => mockSharpInstance),
    };

    ({ createImageRefetchService } = require('../services/image-refetch.js'));
  });

  it('isJobRunning should return false when no job is running', () => {
    const pool = createMockPool();
    const service = createImageRefetchService({ pool });

    assert.strictEqual(service.isJobRunning(), false);
  });

  it('stopJob should return false when no job is running', () => {
    const pool = createMockPool();
    const service = createImageRefetchService({ pool });

    assert.strictEqual(service.stopJob(), false);
  });

  it('getProgress should return null when no job is running', () => {
    const pool = createMockPool();
    const service = createImageRefetchService({ pool });

    assert.strictEqual(service.getProgress(), null);
  });
});

// =============================================================================
// getStats - database statistics
// =============================================================================

describe('getStats', () => {
  let createImageRefetchService;

  beforeEach(() => {
    delete require.cache[require.resolve('../services/image-refetch.js')];

    const sharpPath = require.resolve('sharp');
    const mockSharpInstance = {
      metadata: mock.fn(async () => ({ width: 300, height: 300 })),
    };
    require.cache[sharpPath] = {
      id: sharpPath,
      filename: sharpPath,
      loaded: true,
      exports: mock.fn(() => mockSharpInstance),
    };

    ({ createImageRefetchService } = require('../services/image-refetch.js'));
  });

  it('should return album image statistics', async () => {
    const pool = createMockPool({
      query: mock.fn(async () => ({
        rows: [
          {
            total_albums: '100',
            with_image: '85',
            without_image: '15',
            avg_size_kb: '45.2',
            max_size_kb: '120.5',
            min_size_kb: '5.3',
          },
        ],
      })),
    });

    const service = createImageRefetchService({
      pool,
      logger: createMockLogger(),
    });
    const stats = await service.getStats();

    assert.strictEqual(stats.totalAlbums, 100);
    assert.strictEqual(stats.withImage, 85);
    assert.strictEqual(stats.withoutImage, 15);
    assert.strictEqual(stats.avgSizeKb, 45.2);
    assert.strictEqual(stats.maxSizeKb, 120.5);
    assert.strictEqual(stats.minSizeKb, 5.3);
  });

  it('should handle null numeric values in stats', async () => {
    const pool = createMockPool({
      query: mock.fn(async () => ({
        rows: [
          {
            total_albums: '0',
            with_image: '0',
            without_image: '0',
            avg_size_kb: null,
            max_size_kb: null,
            min_size_kb: null,
          },
        ],
      })),
    });

    const service = createImageRefetchService({
      pool,
      logger: createMockLogger(),
    });
    const stats = await service.getStats();

    assert.strictEqual(stats.totalAlbums, 0);
    assert.strictEqual(stats.withImage, 0);
    assert.strictEqual(stats.avgSizeKb, 0);
    assert.strictEqual(stats.maxSizeKb, 0);
    assert.strictEqual(stats.minSizeKb, 0);
  });

  it('should query the albums table', async () => {
    const queryFn = mock.fn(async () => ({
      rows: [
        {
          total_albums: '10',
          with_image: '5',
          without_image: '5',
          avg_size_kb: '30.0',
          max_size_kb: '60.0',
          min_size_kb: '10.0',
        },
      ],
    }));
    const pool = createMockPool({ query: queryFn });

    const service = createImageRefetchService({
      pool,
      logger: createMockLogger(),
    });
    await service.getStats();

    assert.strictEqual(queryFn.mock.calls.length, 1);
    const sql = queryFn.mock.calls[0].arguments[0];
    assert.ok(sql.includes('albums'), 'should query the albums table');
    assert.ok(
      sql.includes('cover_image'),
      'should reference cover_image column'
    );
  });
});

// =============================================================================
// refetchAllImages - main job
// =============================================================================

describe('refetchAllImages', () => {
  let createImageRefetchService;

  beforeEach(() => {
    delete require.cache[require.resolve('../services/image-refetch.js')];

    const sharpPath = require.resolve('sharp');
    const mockSharpInstance = {
      metadata: mock.fn(async () => ({ width: 300, height: 300 })),
      resize: mock.fn(function () {
        return this;
      }),
      jpeg: mock.fn(function () {
        return this;
      }),
      toBuffer: mock.fn(async () => MOCK_IMAGE_BUFFER),
    };
    require.cache[sharpPath] = {
      id: sharpPath,
      filename: sharpPath,
      loaded: true,
      exports: mock.fn(() => mockSharpInstance),
    };

    ({ createImageRefetchService } = require('../services/image-refetch.js'));
  });

  it('should throw if a job is already running', async () => {
    let resolveQuery;
    const hangingQuery = new Promise((resolve) => {
      resolveQuery = resolve;
    });

    const queryFn = mock.fn(async (sql) => {
      if (sql.includes('COUNT')) {
        // Total albums query - hang to keep job running
        return hangingQuery;
      }
      return { rows: [], rowCount: 0 };
    });

    const pool = createMockPool({ query: queryFn });
    const service = createImageRefetchService({
      pool,
      logger: createMockLogger(),
    });

    // Start first job (will hang on first query)
    const firstJob = service.refetchAllImages();

    // Attempt second job should throw
    await assert.rejects(
      () => service.refetchAllImages(),
      /already running/,
      'should reject when job is already in progress'
    );

    // Clean up: resolve the hanging query and let the job finish
    resolveQuery({ rows: [{ total: '0' }] });
    await firstJob;
  });

  it('should return summary with zero totals when no albums exist', async () => {
    const queryFn = mock.fn(async (sql) => {
      if (sql.includes('COUNT')) {
        return { rows: [{ total: '0' }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const pool = createMockPool({ query: queryFn });
    const service = createImageRefetchService({
      pool,
      logger: createMockLogger(),
    });
    const summary = await service.refetchAllImages();

    assert.strictEqual(summary.total, 0);
    assert.strictEqual(summary.success, 0);
    assert.strictEqual(summary.failed, 0);
    assert.strictEqual(summary.skipped, 0);
    assert.strictEqual(summary.stoppedEarly, false);
    assert.ok(summary.startedAt, 'should have a startedAt timestamp');
    assert.ok(summary.completedAt, 'should have a completedAt timestamp');
    assert.strictEqual(typeof summary.durationSeconds, 'number');
  });

  it('should return summary when all albums are already high quality', async () => {
    const queryFn = mock.fn(async (sql) => {
      if (sql.includes('COUNT') && !sql.includes('COALESCE')) {
        return { rows: [{ total: '5' }] };
      }
      if (sql.includes('COALESCE') && sql.includes('COUNT')) {
        // No candidates - all are above threshold
        return { rows: [{ total: '0' }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const pool = createMockPool({ query: queryFn });
    const service = createImageRefetchService({
      pool,
      logger: createMockLogger(),
    });
    const summary = await service.refetchAllImages();

    assert.strictEqual(summary.total, 5);
    assert.strictEqual(summary.skipped, 5);
    assert.strictEqual(summary.success, 0);
    assert.strictEqual(summary.failed, 0);
    assert.strictEqual(summary.stoppedEarly, false);
  });

  it('should reset isRunning state after job completes', async () => {
    const queryFn = mock.fn(async () => ({
      rows: [{ total: '0' }],
    }));
    const pool = createMockPool({ query: queryFn });
    const service = createImageRefetchService({
      pool,
      logger: createMockLogger(),
    });

    await service.refetchAllImages();
    assert.strictEqual(
      service.isJobRunning(),
      false,
      'job should not be running after completion'
    );
  });

  it('should reset isRunning state even if job throws', async () => {
    const queryFn = mock.fn(async () => {
      throw new Error('Database exploded');
    });
    const pool = createMockPool({ query: queryFn });
    const service = createImageRefetchService({
      pool,
      logger: createMockLogger(),
    });

    await assert.rejects(() => service.refetchAllImages(), /Database exploded/);

    assert.strictEqual(
      service.isJobRunning(),
      false,
      'job should not be running after error'
    );
    assert.strictEqual(
      service.getProgress(),
      null,
      'progress should be null after error'
    );
  });

  it('should stop early when stopJob is called', async () => {
    let queryCallCount = 0;
    const queryFn = mock.fn(async (sql) => {
      queryCallCount++;
      // First COUNT query - total albums
      if (queryCallCount === 1) {
        return { rows: [{ total: '100' }] };
      }
      // Second COUNT query - candidates
      if (queryCallCount === 2) {
        return { rows: [{ total: '100' }] };
      }
      // Album batch query - return albums that would need processing
      if (sql.includes('SELECT album_id')) {
        return {
          rows: [
            {
              album_id: 'album-1',
              artist: 'Artist',
              album: 'Album',
              image_size_bytes: 0,
            },
          ],
        };
      }
      // cover_image query for shouldSkipAlbum
      if (sql.includes('cover_image')) {
        return { rows: [{ cover_image: null }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const pool = createMockPool({ query: queryFn });
    const service = createImageRefetchService({
      pool,
      logger: createMockLogger(),
    });

    // Start the job and immediately request a stop
    const jobPromise = service.refetchAllImages();
    // Give it a tick to start processing
    await new Promise((resolve) => setTimeout(resolve, 10));
    service.stopJob();

    const summary = await jobPromise;
    assert.strictEqual(summary.stoppedEarly, true);
  });

  it('should handle album processing errors gracefully', async () => {
    let batchCallCount = 0;
    const queryFn = mock.fn(async (sql) => {
      // Total albums count
      if (sql.includes('COUNT') && !sql.includes('COALESCE')) {
        return { rows: [{ total: '1' }] };
      }
      // Candidate albums count
      if (sql.includes('COUNT') && sql.includes('COALESCE')) {
        return { rows: [{ total: '1' }] };
      }
      // Batch query (includes SELECT album_id and COALESCE(OCTET_LENGTH(cover_image)))
      if (sql.includes('SELECT album_id')) {
        batchCallCount++;
        if (batchCallCount === 1) {
          return {
            rows: [
              {
                album_id: 'album-err',
                artist: '',
                album: '',
                image_size_bytes: 0,
              },
            ],
          };
        }
        // Second batch returns empty to end loop
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });

    const pool = createMockPool({ query: queryFn });
    const logger = createMockLogger();
    const service = createImageRefetchService({ pool, logger });

    // fetchCoverArt returns null for empty artist/album, so this should count as failed
    const summary = await service.refetchAllImages();

    assert.strictEqual(summary.failed, 1);
  });
});

// =============================================================================
// Module exports
// =============================================================================

describe('module exports', () => {
  it('should export createImageRefetchService function', () => {
    delete require.cache[require.resolve('../services/image-refetch.js')];
    const mod = require('../services/image-refetch.js');

    assert.strictEqual(typeof mod.createImageRefetchService, 'function');
  });
});
