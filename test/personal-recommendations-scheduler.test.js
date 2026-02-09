const test = require('node:test');
const assert = require('node:assert');
const { mock } = require('node:test');
const {
  createPersonalRecommendationsScheduler,
} = require('../services/personal-recommendations-scheduler.js');

// =============================================================================
// Helper: create scheduler with mocked deps
// =============================================================================

function createTestScheduler(options = {}) {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };

  const mockPool = {
    query: options.poolQuery || mock.fn(async () => ({ rows: [] })),
  };

  const mockService = {
    rotateAndCleanup: options.rotateAndCleanup || mock.fn(async () => {}),
    generateForAllUsers:
      options.generateForAllUsers ||
      mock.fn(async () => ({ success: 5, failed: 0, skipped: 1 })),
    generateForUser:
      options.generateForUser ||
      mock.fn(async () => ({ _id: 'test', status: 'completed' })),
  };

  const scheduler = createPersonalRecommendationsScheduler({
    pool: mockPool,
    logger: mockLogger,
    personalRecsService: mockService,
    env: options.env || {},
  });

  return { scheduler, mockLogger, mockPool, mockService };
}

// =============================================================================
// Constructor
// =============================================================================

test('createPersonalRecommendationsScheduler requires pool', () => {
  assert.throws(
    () => createPersonalRecommendationsScheduler({}),
    /Database pool is required/
  );
});

// =============================================================================
// getCurrentWeekStart
// =============================================================================

test('getCurrentWeekStart should return a Monday date', () => {
  const { scheduler } = createTestScheduler();
  const weekStart = scheduler.getCurrentWeekStart();

  // Parse the date and check it's a Monday
  const date = new Date(weekStart + 'T00:00:00Z');
  // getUTCDay: 0=Sunday, 1=Monday
  assert.strictEqual(date.getUTCDay(), 1);
});

test('getCurrentWeekStart should return YYYY-MM-DD format', () => {
  const { scheduler } = createTestScheduler();
  const weekStart = scheduler.getCurrentWeekStart();
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(weekStart));
});

// =============================================================================
// start/stop
// =============================================================================

test('start should set isStarted to true', () => {
  const { scheduler } = createTestScheduler();

  assert.strictEqual(scheduler.isStarted(), false);
  scheduler.start();
  assert.strictEqual(scheduler.isStarted(), true);
  scheduler.stop();
  assert.strictEqual(scheduler.isStarted(), false);
});

test('start should warn if already started', () => {
  const { scheduler, mockLogger } = createTestScheduler();

  scheduler.start();
  scheduler.start(); // Second call should warn
  assert.ok(
    mockLogger.warn.mock.calls.some(
      (c) =>
        c.arguments[0] === 'Personal recommendations scheduler already started'
    )
  );
  scheduler.stop();
});

test('stop should clear all timers', () => {
  const { scheduler } = createTestScheduler();

  scheduler.start();
  scheduler.stop();
  assert.strictEqual(scheduler.isStarted(), false);
});

// =============================================================================
// runWeeklyGeneration
// =============================================================================

test('runWeeklyGeneration should call rotateAndCleanup and generateForAllUsers', async () => {
  const { scheduler, mockService } = createTestScheduler();

  await scheduler.runWeeklyGeneration();

  assert.strictEqual(mockService.rotateAndCleanup.mock.calls.length, 1);
  assert.strictEqual(mockService.generateForAllUsers.mock.calls.length, 1);
});

test('runWeeklyGeneration should skip if already running', async () => {
  const { mockLogger } = createTestScheduler();

  // Create a scheduler with a slow service to test concurrency guard
  let resolveGeneration;
  const slowService = {
    rotateAndCleanup: mock.fn(async () => {}),
    generateForAllUsers: mock.fn(
      () =>
        new Promise((resolve) => {
          resolveGeneration = resolve;
        })
    ),
    generateForUser: mock.fn(async () => ({})),
  };

  const scheduler = createPersonalRecommendationsScheduler({
    pool: { query: mock.fn(async () => ({ rows: [] })) },
    logger: mockLogger,
    personalRecsService: slowService,
    env: {},
  });

  // Start first run (will block on generateForAllUsers)
  const run1 = scheduler.runWeeklyGeneration();

  // Try second run while first is still going
  await scheduler.runWeeklyGeneration();

  assert.ok(
    mockLogger.warn.mock.calls.some(
      (c) =>
        c.arguments[0] ===
        'Personal recommendations generation already running, skipping'
    )
  );

  // Resolve the first run
  resolveGeneration({ success: 1, failed: 0, skipped: 0 });
  await run1;
});

test('runWeeklyGeneration should handle errors gracefully', async () => {
  const { scheduler, mockLogger } = createTestScheduler({
    generateForAllUsers: mock.fn(async () => {
      throw new Error('DB error');
    }),
  });

  // Should not throw
  await scheduler.runWeeklyGeneration();

  assert.ok(
    mockLogger.error.mock.calls.some(
      (c) =>
        c.arguments[0] ===
        'Failed to run weekly personal recommendations generation'
    )
  );
});

test('runWeeklyGeneration should log error when service not available', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };

  const scheduler = createPersonalRecommendationsScheduler({
    pool: { query: mock.fn(async () => ({ rows: [] })) },
    logger: mockLogger,
    personalRecsService: null,
    env: {},
  });

  await scheduler.runWeeklyGeneration();

  assert.ok(
    mockLogger.error.mock.calls.some(
      (c) =>
        c.arguments[0] ===
        'Personal recommendations service not available for scheduler'
    )
  );
});
