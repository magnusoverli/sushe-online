const test = require('node:test');
const assert = require('node:assert');
const { mock } = require('node:test');
const {
  createPersonalRecommendationsService,
} = require('../services/personal-recommendations-service.js');

// =============================================================================
// Helper: create service with mocked deps
// =============================================================================

let idCounter = 0;

function createTestService(options = {}) {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };

  const mockPool = {
    query: options.query || mock.fn(async () => ({ rows: [], rowCount: 0 })),
  };

  const mockEngine = options.recommendationEngine || {
    generateRecommendations: mock.fn(async () => ({
      recommendations: [
        { artist: 'Artist1', album: 'Album1', reasoning: 'Great fit' },
      ],
      promptSnapshot: 'test prompt',
      inputTokens: 100,
      outputTokens: 50,
    })),
  };

  const mockPoolService = options.poolService || {
    getPoolForWeek: mock.fn(async () => [
      { artist: 'Artist1', album: 'Album1', album_id: 'album-1' },
    ]),
    buildWeeklyPool: mock.fn(async () => {}),
    cleanupOldPools: mock.fn(async () => {}),
  };

  const mockNormalizeAlbumKey =
    options.normalizeAlbumKey ||
    ((artist, album) =>
      `${String(artist || '')
        .toLowerCase()
        .trim()}::${String(album || '')
        .toLowerCase()
        .trim()}`);

  idCounter = 0;
  const mockGenerateId =
    options.generateId || mock.fn(() => `test-id-${++idCounter}`);

  const service = createPersonalRecommendationsService({
    pool: mockPool,
    logger: mockLogger,
    recommendationEngine: options.noEngine === true ? null : mockEngine,
    poolService: options.noPoolService === true ? null : mockPoolService,
    upsertAlbumRecord: options.upsertAlbumRecord || null,
    normalizeAlbumKey: mockNormalizeAlbumKey,
    env: options.env || {
      PERSONAL_RECS_MODEL: 'claude-sonnet-4-5',
      PERSONAL_RECS_RATE_LIMIT_MS: '0',
      PERSONAL_RECS_MIN_ALBUMS: '10',
      PERSONAL_RECS_ACTIVE_DAYS: '30',
    },
    generateId: mockGenerateId,
  });

  return {
    service,
    mockLogger,
    mockPool,
    mockEngine,
    mockPoolService,
    mockGenerateId,
  };
}

// Helper: create a query mock that returns different results per call pattern
function createQueryRouter(routes) {
  return mock.fn(async (sql, params) => {
    for (const route of routes) {
      if (sql.includes(route.match)) {
        return typeof route.result === 'function'
          ? route.result(sql, params)
          : route.result;
      }
    }
    return { rows: [], rowCount: 0 };
  });
}

// =============================================================================
// createPersonalRecommendationsService - constructor
// =============================================================================

test('createPersonalRecommendationsService requires pool', () => {
  assert.throws(
    () => createPersonalRecommendationsService({}),
    /Database pool is required/
  );
});

test('createPersonalRecommendationsService creates service with valid pool', () => {
  const service = createPersonalRecommendationsService({
    pool: { query: mock.fn() },
  });
  assert.ok(service.generateForUser);
  assert.ok(service.generateForAllUsers);
  assert.ok(service.rotateAndCleanup);
  assert.ok(service.getListsForUser);
  assert.ok(service.getListById);
  assert.ok(service.getUserPromptSettings);
  assert.ok(service.updateUserPromptSettings);
  assert.ok(service.checkUserEligibility);
});

// =============================================================================
// checkUserEligibility
// =============================================================================

test('checkUserEligibility returns ineligible when recommendations disabled', async () => {
  const query = createQueryRouter([
    {
      match: 'is_enabled',
      result: { rows: [{ is_enabled: false }], rowCount: 1 },
    },
  ]);
  const { service } = createTestService({ query });

  const result = await service.checkUserEligibility('user-1');
  assert.strictEqual(result.eligible, false);
  assert.strictEqual(result.reason, 'recommendations_disabled');
});

test('checkUserEligibility returns ineligible for insufficient albums', async () => {
  const query = createQueryRouter([
    { match: 'is_enabled', result: { rows: [], rowCount: 0 } },
    {
      match: 'COUNT(DISTINCT',
      result: { rows: [{ count: '3' }], rowCount: 1 },
    },
  ]);
  const { service } = createTestService({ query });

  const result = await service.checkUserEligibility('user-1');
  assert.strictEqual(result.eligible, false);
  assert.ok(result.reason.includes('insufficient_albums'));
  assert.ok(result.reason.includes('3/10'));
});

test('checkUserEligibility returns ineligible for inactive user', async () => {
  const query = createQueryRouter([
    { match: 'is_enabled', result: { rows: [], rowCount: 0 } },
    {
      match: 'COUNT(DISTINCT',
      result: { rows: [{ count: '15' }], rowCount: 1 },
    },
    { match: 'last_login', result: { rows: [], rowCount: 0 } },
  ]);
  const { service } = createTestService({ query });

  const result = await service.checkUserEligibility('user-1');
  assert.strictEqual(result.eligible, false);
  assert.strictEqual(result.reason, 'inactive_user');
});

test('checkUserEligibility returns eligible for valid user', async () => {
  const query = createQueryRouter([
    { match: 'is_enabled', result: { rows: [], rowCount: 0 } },
    {
      match: 'COUNT(DISTINCT',
      result: { rows: [{ count: '15' }], rowCount: 1 },
    },
    {
      match: 'last_login',
      result: { rows: [{ last_login: new Date() }], rowCount: 1 },
    },
  ]);
  const { service } = createTestService({ query });

  const result = await service.checkUserEligibility('user-1');
  assert.strictEqual(result.eligible, true);
  assert.strictEqual(result.reason, '');
});

test('checkUserEligibility treats enabled user as eligible candidate', async () => {
  const query = createQueryRouter([
    {
      match: 'is_enabled',
      result: { rows: [{ is_enabled: true }], rowCount: 1 },
    },
    {
      match: 'COUNT(DISTINCT',
      result: { rows: [{ count: '20' }], rowCount: 1 },
    },
    {
      match: 'last_login',
      result: { rows: [{ last_login: new Date() }], rowCount: 1 },
    },
  ]);
  const { service } = createTestService({ query });

  const result = await service.checkUserEligibility('user-1');
  assert.strictEqual(result.eligible, true);
});

// =============================================================================
// generateForUser
// =============================================================================

test('generateForUser skips if recommendations already exist', async () => {
  const query = createQueryRouter([
    {
      match: 'personal_recommendation_lists WHERE user_id',
      result: { rows: [{ _id: 'existing-list' }], rowCount: 1 },
    },
  ]);
  const { service, mockLogger } = createTestService({ query });

  const result = await service.generateForUser('user-1', '2025-02-03');
  assert.deepStrictEqual(result, { _id: 'existing-list' });
  assert.ok(
    mockLogger.info.mock.calls.some((c) =>
      c.arguments[0].includes('already exist')
    )
  );
});

test('generateForUser returns null when user is not eligible', async () => {
  const query = createQueryRouter([
    {
      match: 'personal_recommendation_lists WHERE user_id',
      result: { rows: [], rowCount: 0 },
    },
    {
      match: 'is_enabled',
      result: { rows: [{ is_enabled: false }], rowCount: 1 },
    },
  ]);
  const { service, mockLogger } = createTestService({ query });

  const result = await service.generateForUser('user-1', '2025-02-03');
  assert.strictEqual(result, null);
  assert.ok(
    mockLogger.info.mock.calls.some((c) =>
      c.arguments[0].includes('not eligible')
    )
  );
});

test('generateForUser returns null when engine not available', async () => {
  const query = createQueryRouter([
    {
      match: 'personal_recommendation_lists WHERE user_id',
      result: { rows: [], rowCount: 0 },
    },
    { match: 'is_enabled', result: { rows: [], rowCount: 0 } },
    {
      match: 'COUNT(DISTINCT',
      result: { rows: [{ count: '15' }], rowCount: 1 },
    },
    {
      match: 'last_login',
      result: { rows: [{ last_login: new Date() }], rowCount: 1 },
    },
  ]);
  const { service, mockLogger } = createTestService({
    query,
    noEngine: true,
  });

  const result = await service.generateForUser('user-1', '2025-02-03');
  assert.strictEqual(result, null);
  assert.ok(
    mockLogger.error.mock.calls.some((c) =>
      c.arguments[0].includes('engine not available')
    )
  );
});

test('generateForUser creates failed list on empty release pool', async () => {
  const query = createQueryRouter([
    {
      match: 'personal_recommendation_lists WHERE user_id',
      result: { rows: [], rowCount: 0 },
    },
    { match: 'is_enabled', result: { rows: [], rowCount: 0 } },
    {
      match: 'COUNT(DISTINCT',
      result: { rows: [{ count: '15' }], rowCount: 1 },
    },
    {
      match: 'last_login',
      result: { rows: [{ last_login: new Date() }], rowCount: 1 },
    },
    { match: 'genre_affinity', result: { rows: [{}], rowCount: 1 } },
    { match: 'SELECT DISTINCT a.artist', result: { rows: [], rowCount: 0 } },
    { match: 'custom_prompt', result: { rows: [], rowCount: 0 } },
    {
      match: 'INSERT INTO personal_recommendation_lists',
      result: { rows: [], rowCount: 1 },
    },
  ]);

  const mockPoolService = {
    getPoolForWeek: mock.fn(async () => []),
    buildWeeklyPool: mock.fn(async () => {}),
    cleanupOldPools: mock.fn(async () => {}),
  };

  const { service } = createTestService({
    query,
    poolService: mockPoolService,
  });

  const result = await service.generateForUser('user-1', '2025-02-03');
  assert.strictEqual(result.status, 'failed');
});

test('generateForUser creates completed list on success', async () => {
  const query = createQueryRouter([
    {
      match: 'personal_recommendation_lists WHERE user_id',
      result: { rows: [], rowCount: 0 },
    },
    { match: 'is_enabled', result: { rows: [], rowCount: 0 } },
    {
      match: 'COUNT(DISTINCT',
      result: { rows: [{ count: '15' }], rowCount: 1 },
    },
    {
      match: 'last_login',
      result: { rows: [{ last_login: new Date() }], rowCount: 1 },
    },
    {
      match: 'genre_affinity',
      result: {
        rows: [
          {
            genre_affinity: [{ name: 'Rock', score: 90 }],
            artist_affinity: [],
            country_affinity: [],
          },
        ],
        rowCount: 1,
      },
    },
    { match: 'SELECT DISTINCT a.artist', result: { rows: [], rowCount: 0 } },
    { match: 'custom_prompt', result: { rows: [], rowCount: 0 } },
    {
      match: 'INSERT INTO personal_recommendation_lists',
      result: { rows: [], rowCount: 1 },
    },
    {
      match: 'INSERT INTO personal_recommendation_items',
      result: { rows: [], rowCount: 1 },
    },
  ]);

  const { service, mockLogger } = createTestService({ query });

  const result = await service.generateForUser('user-1', '2025-02-03');
  assert.strictEqual(result.status, 'completed');
  assert.ok(result._id.startsWith('test-id-'));
  assert.ok(
    mockLogger.info.mock.calls.some((c) =>
      c.arguments[0].includes('Generated recommendations')
    )
  );
});

test('generateForUser creates failed list on engine error', async () => {
  const query = createQueryRouter([
    {
      match: 'personal_recommendation_lists WHERE user_id',
      result: { rows: [], rowCount: 0 },
    },
    { match: 'is_enabled', result: { rows: [], rowCount: 0 } },
    {
      match: 'COUNT(DISTINCT',
      result: { rows: [{ count: '15' }], rowCount: 1 },
    },
    {
      match: 'last_login',
      result: { rows: [{ last_login: new Date() }], rowCount: 1 },
    },
    { match: 'genre_affinity', result: { rows: [{}], rowCount: 1 } },
    { match: 'SELECT DISTINCT a.artist', result: { rows: [], rowCount: 0 } },
    { match: 'custom_prompt', result: { rows: [], rowCount: 0 } },
    {
      match: 'INSERT INTO personal_recommendation_lists',
      result: { rows: [], rowCount: 1 },
    },
  ]);

  const mockEngine = {
    generateRecommendations: mock.fn(async () => {
      throw new Error('Claude API error');
    }),
  };

  const { service, mockLogger } = createTestService({
    query,
    recommendationEngine: mockEngine,
  });

  const result = await service.generateForUser('user-1', '2025-02-03');
  assert.strictEqual(result.status, 'failed');
  assert.ok(
    mockLogger.error.mock.calls.some((c) =>
      c.arguments[0].includes('Failed to generate')
    )
  );
});

test('generateForUser creates failed list when engine returns empty', async () => {
  const query = createQueryRouter([
    {
      match: 'personal_recommendation_lists WHERE user_id',
      result: { rows: [], rowCount: 0 },
    },
    { match: 'is_enabled', result: { rows: [], rowCount: 0 } },
    {
      match: 'COUNT(DISTINCT',
      result: { rows: [{ count: '15' }], rowCount: 1 },
    },
    {
      match: 'last_login',
      result: { rows: [{ last_login: new Date() }], rowCount: 1 },
    },
    { match: 'genre_affinity', result: { rows: [{}], rowCount: 1 } },
    { match: 'SELECT DISTINCT a.artist', result: { rows: [], rowCount: 0 } },
    { match: 'custom_prompt', result: { rows: [], rowCount: 0 } },
    {
      match: 'INSERT INTO personal_recommendation_lists',
      result: { rows: [], rowCount: 1 },
    },
  ]);

  const mockEngine = {
    generateRecommendations: mock.fn(async () => ({
      recommendations: [],
      promptSnapshot: 'test',
      inputTokens: 100,
      outputTokens: 50,
    })),
  };

  const { service } = createTestService({
    query,
    recommendationEngine: mockEngine,
  });

  const result = await service.generateForUser('user-1', '2025-02-03');
  assert.strictEqual(result.status, 'failed');
});

test('generateForUser uses empty pool when no poolService', async () => {
  const query = createQueryRouter([
    {
      match: 'personal_recommendation_lists WHERE user_id',
      result: { rows: [], rowCount: 0 },
    },
    { match: 'is_enabled', result: { rows: [], rowCount: 0 } },
    {
      match: 'COUNT(DISTINCT',
      result: { rows: [{ count: '15' }], rowCount: 1 },
    },
    {
      match: 'last_login',
      result: { rows: [{ last_login: new Date() }], rowCount: 1 },
    },
    { match: 'genre_affinity', result: { rows: [{}], rowCount: 1 } },
    { match: 'SELECT DISTINCT a.artist', result: { rows: [], rowCount: 0 } },
    { match: 'custom_prompt', result: { rows: [], rowCount: 0 } },
    {
      match: 'INSERT INTO personal_recommendation_lists',
      result: { rows: [], rowCount: 1 },
    },
  ]);

  const { service } = createTestService({
    query,
    noPoolService: true,
  });

  const result = await service.generateForUser('user-1', '2025-02-03');
  // Should fail because release pool is empty (no pool service)
  assert.strictEqual(result.status, 'failed');
});

// =============================================================================
// generateForAllUsers
// =============================================================================

test('generateForAllUsers builds pool and processes users', async () => {
  let callIndex = 0;
  const query = mock.fn(async (sql) => {
    // First call: buildWeeklyPool triggers no queries from service directly
    // Users query
    if (sql.includes('SELECT _id FROM users')) {
      return { rows: [{ _id: 'user-1' }, { _id: 'user-2' }], rowCount: 2 };
    }
    // For generateForUser calls: existing list check
    if (sql.includes('personal_recommendation_lists WHERE user_id')) {
      callIndex++;
      // user-1: already exists, user-2: doesn't exist
      if (callIndex === 1) {
        return { rows: [{ _id: 'existing' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    // user-2 eligibility: disabled
    if (sql.includes('is_enabled')) {
      return { rows: [{ is_enabled: false }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  const { service, mockPoolService } = createTestService({ query });

  const result = await service.generateForAllUsers('2025-02-03');
  assert.strictEqual(result.success, 1); // user-1 already had recs (returned existing)
  assert.strictEqual(result.skipped, 1); // user-2 not eligible
  assert.strictEqual(mockPoolService.buildWeeklyPool.mock.calls.length, 1);
});

test('generateForAllUsers handles errors for individual users', async () => {
  let userCallCount = 0;
  const query = mock.fn(async (sql) => {
    if (sql.includes('SELECT _id FROM users')) {
      return { rows: [{ _id: 'user-1' }], rowCount: 1 };
    }
    if (sql.includes('personal_recommendation_lists WHERE user_id')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('is_enabled')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('COUNT(DISTINCT')) {
      userCallCount++;
      if (userCallCount === 1) {
        throw new Error('DB error');
      }
      return { rows: [{ count: '15' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  const { service, mockLogger } = createTestService({ query });

  const result = await service.generateForAllUsers('2025-02-03');
  assert.strictEqual(result.failed, 1);
  assert.ok(
    mockLogger.error.mock.calls.some((c) =>
      c.arguments[0].includes('Unexpected error')
    )
  );
});

test('generateForAllUsers skips pool build when no poolService', async () => {
  const query = mock.fn(async (sql) => {
    if (sql.includes('SELECT _id FROM users')) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });

  const { service } = createTestService({ query, noPoolService: true });

  const result = await service.generateForAllUsers('2025-02-03');
  assert.strictEqual(result.success, 0);
  assert.strictEqual(result.failed, 0);
  assert.strictEqual(result.skipped, 0);
});

// =============================================================================
// rotateAndCleanup
// =============================================================================

test('rotateAndCleanup deletes old lists and cleans pools', async () => {
  const query = mock.fn(async () => ({ rows: [], rowCount: 5 }));
  const { service, mockPoolService, mockLogger } = createTestService({
    query,
  });

  await service.rotateAndCleanup('2025-02-10');
  assert.strictEqual(query.mock.calls.length, 1);
  assert.ok(query.mock.calls[0].arguments[0].includes('DELETE'));
  assert.strictEqual(mockPoolService.cleanupOldPools.mock.calls.length, 1);
  assert.ok(
    mockLogger.info.mock.calls.some((c) =>
      c.arguments[0].includes('Rotated old')
    )
  );
});

test('rotateAndCleanup calculates correct cutoff date', async () => {
  const query = mock.fn(async () => ({ rows: [], rowCount: 0 }));
  const { service } = createTestService({ query });

  await service.rotateAndCleanup('2025-02-10');
  // cutoff should be 7 days before: 2025-02-03
  const params = query.mock.calls[0].arguments[1];
  assert.strictEqual(params[0], '2025-02-03');
});

test('rotateAndCleanup works without poolService', async () => {
  const query = mock.fn(async () => ({ rows: [], rowCount: 0 }));
  const { service } = createTestService({ query, noPoolService: true });

  // Should not throw
  await service.rotateAndCleanup('2025-02-10');
  assert.strictEqual(query.mock.calls.length, 1);
});

// =============================================================================
// getListsForUser
// =============================================================================

test('getListsForUser returns rows from query', async () => {
  const expectedRows = [
    { _id: 'list-1', week_start: '2025-02-03', items: [] },
    { _id: 'list-2', week_start: '2025-01-27', items: [] },
  ];
  const query = mock.fn(async () => ({
    rows: expectedRows,
    rowCount: 2,
  }));
  const { service } = createTestService({ query });

  const result = await service.getListsForUser('user-1');
  assert.deepStrictEqual(result, expectedRows);
  assert.ok(query.mock.calls[0].arguments[0].includes('prl.user_id'));
  assert.deepStrictEqual(query.mock.calls[0].arguments[1], ['user-1']);
});

test('getListsForUser returns empty array when no lists', async () => {
  const query = mock.fn(async () => ({ rows: [], rowCount: 0 }));
  const { service } = createTestService({ query });

  const result = await service.getListsForUser('user-1');
  assert.deepStrictEqual(result, []);
});

// =============================================================================
// getListById
// =============================================================================

test('getListById returns list with items', async () => {
  const expectedRow = {
    _id: 'list-1',
    week_start: '2025-02-03',
    items: [{ artist: 'A', album: 'B' }],
  };
  const query = mock.fn(async () => ({
    rows: [expectedRow],
    rowCount: 1,
  }));
  const { service } = createTestService({ query });

  const result = await service.getListById('list-1', 'user-1');
  assert.deepStrictEqual(result, expectedRow);
  assert.ok(query.mock.calls[0].arguments[0].includes('prl._id'));
  assert.deepStrictEqual(query.mock.calls[0].arguments[1], [
    'list-1',
    'user-1',
  ]);
});

test('getListById returns null when not found', async () => {
  const query = mock.fn(async () => ({ rows: [], rowCount: 0 }));
  const { service } = createTestService({ query });

  const result = await service.getListById('nonexistent', 'user-1');
  assert.strictEqual(result, null);
});

// =============================================================================
// getUserPromptSettings
// =============================================================================

test('getUserPromptSettings returns defaults when no record', async () => {
  const query = mock.fn(async () => ({ rows: [], rowCount: 0 }));
  const { service } = createTestService({ query });

  const result = await service.getUserPromptSettings('user-1');
  assert.deepStrictEqual(result, { customPrompt: '', isEnabled: true });
});

test('getUserPromptSettings returns saved settings', async () => {
  const query = mock.fn(async () => ({
    rows: [{ custom_prompt: 'I like jazz', is_enabled: false }],
    rowCount: 1,
  }));
  const { service } = createTestService({ query });

  const result = await service.getUserPromptSettings('user-1');
  assert.strictEqual(result.customPrompt, 'I like jazz');
  assert.strictEqual(result.isEnabled, false);
});

test('getUserPromptSettings handles null custom_prompt', async () => {
  const query = mock.fn(async () => ({
    rows: [{ custom_prompt: null, is_enabled: true }],
    rowCount: 1,
  }));
  const { service } = createTestService({ query });

  const result = await service.getUserPromptSettings('user-1');
  assert.strictEqual(result.customPrompt, '');
  assert.strictEqual(result.isEnabled, true);
});

// =============================================================================
// updateUserPromptSettings
// =============================================================================

test('updateUserPromptSettings saves settings', async () => {
  const query = mock.fn(async () => ({ rows: [], rowCount: 1 }));
  const { service, mockLogger } = createTestService({ query });

  await service.updateUserPromptSettings('user-1', {
    customPrompt: 'I like rock',
    isEnabled: true,
  });

  assert.strictEqual(query.mock.calls.length, 1);
  assert.ok(query.mock.calls[0].arguments[0].includes('INSERT INTO'));
  assert.ok(
    mockLogger.info.mock.calls.some((c) =>
      c.arguments[0].includes('Updated user prompt')
    )
  );
});

test('updateUserPromptSettings rejects prompts over 1000 chars', async () => {
  const query = mock.fn(async () => ({ rows: [], rowCount: 1 }));
  const { service } = createTestService({ query });

  await assert.rejects(
    () =>
      service.updateUserPromptSettings('user-1', {
        customPrompt: 'x'.repeat(1001),
        isEnabled: true,
      }),
    /1000 characters or less/
  );
  assert.strictEqual(query.mock.calls.length, 0);
});

test('updateUserPromptSettings allows exactly 1000 chars', async () => {
  const query = mock.fn(async () => ({ rows: [], rowCount: 1 }));
  const { service } = createTestService({ query });

  await service.updateUserPromptSettings('user-1', {
    customPrompt: 'x'.repeat(1000),
    isEnabled: true,
  });
  assert.strictEqual(query.mock.calls.length, 1);
});

test('updateUserPromptSettings handles null values for partial updates', async () => {
  const query = mock.fn(async () => ({ rows: [], rowCount: 1 }));
  const { service } = createTestService({ query });

  await service.updateUserPromptSettings('user-1', {
    customPrompt: null,
    isEnabled: false,
  });

  const params = query.mock.calls[0].arguments[1];
  assert.strictEqual(params[0], 'user-1');
  assert.strictEqual(params[1], null);
  assert.strictEqual(params[2], false);
});
