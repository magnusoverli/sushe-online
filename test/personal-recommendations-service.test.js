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

test('checkUserEligibility returns eligible when no prompt settings row exists', async () => {
  const query = createQueryRouter([
    { match: 'is_enabled', result: { rows: [], rowCount: 0 } },
  ]);
  const { service } = createTestService({ query });

  const result = await service.checkUserEligibility('user-1');
  assert.strictEqual(result.eligible, true);
  assert.strictEqual(result.reason, '');
});

test('checkUserEligibility returns eligible when explicitly enabled', async () => {
  const query = createQueryRouter([
    {
      match: 'is_enabled',
      result: { rows: [{ is_enabled: true }], rowCount: 1 },
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

test('generateForUser with force deletes existing and regenerates', async () => {
  const deletedItems = [];
  const deletedLists = [];
  const query = createQueryRouter([
    {
      match: 'personal_recommendation_lists WHERE user_id',
      result: { rows: [{ _id: 'existing-list' }], rowCount: 1 },
    },
    {
      match: 'DELETE FROM personal_recommendation_items',
      result: (sql, params) => {
        deletedItems.push(params[0]);
        return { rows: [], rowCount: 1 };
      },
    },
    {
      match: 'DELETE FROM personal_recommendation_lists',
      result: (sql, params) => {
        deletedLists.push(params[0]);
        return { rows: [], rowCount: 1 };
      },
    },
    { match: 'is_enabled', result: { rows: [], rowCount: 0 } },
    { match: 'genre_affinity', result: { rows: [{}], rowCount: 1 } },
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

  const result = await service.generateForUser('user-1', '2025-02-03', {
    force: true,
  });
  assert.strictEqual(result.status, 'completed');
  assert.deepStrictEqual(deletedItems, ['existing-list']);
  assert.deepStrictEqual(deletedLists, ['existing-list']);
  assert.ok(
    mockLogger.info.mock.calls.some((c) =>
      c.arguments[0].includes('Force regeneration')
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

test('generateForUser forwards pool metadata to upsertAlbumRecord', async () => {
  const upsertCalls = [];
  const storedItems = [];
  const query = createQueryRouter([
    {
      match: 'personal_recommendation_lists WHERE user_id',
      result: { rows: [], rowCount: 0 },
    },
    { match: 'is_enabled', result: { rows: [], rowCount: 0 } },
    { match: 'genre_affinity', result: { rows: [{}], rowCount: 1 } },
    { match: 'SELECT DISTINCT a.artist', result: { rows: [], rowCount: 0 } },
    { match: 'custom_prompt', result: { rows: [], rowCount: 0 } },
    {
      match: 'INSERT INTO personal_recommendation_lists',
      result: { rows: [], rowCount: 1 },
    },
    {
      match: 'INSERT INTO personal_recommendation_items',
      result: (sql, params) => {
        storedItems.push({
          albumId: params[2],
          genre_1: params[7],
          genre_2: params[8],
          country: params[9],
        });
        return { rows: [], rowCount: 1 };
      },
    },
  ]);

  const mockCoverImage = Buffer.from('fake-jpeg-data');
  const mockPoolService = {
    getPoolForWeek: mock.fn(async () => [
      {
        artist: 'Artist1',
        album: 'Album1',
        album_id: 'spotify-123',
        genre_1: 'Electronic',
        genre_2: 'Ambient',
        country: 'United Kingdom',
        release_date: '2025-02-05',
        cover_image: mockCoverImage,
        cover_image_format: 'JPEG',
        tracks: [
          { name: 'Track 1', length: 240000 },
          { name: 'Track 2', length: 180000 },
        ],
      },
    ]),
    buildWeeklyPool: mock.fn(async () => {}),
    cleanupOldPools: mock.fn(async () => {}),
  };

  const mockUpsertAlbumRecord = mock.fn(async (albumData) => {
    upsertCalls.push(albumData);
    return 'canonical-album-id-1';
  });

  const { service } = createTestService({
    query,
    poolService: mockPoolService,
    upsertAlbumRecord: mockUpsertAlbumRecord,
  });

  const result = await service.generateForUser('user-1', '2025-02-03');
  assert.strictEqual(result.status, 'completed');

  // Verify upsertAlbumRecord was called with full pool metadata
  assert.strictEqual(upsertCalls.length, 1);
  const upserted = upsertCalls[0];
  assert.strictEqual(upserted.artist, 'Artist1');
  assert.strictEqual(upserted.album, 'Album1');
  assert.strictEqual(upserted.album_id, 'spotify-123');
  assert.strictEqual(upserted.genre_1, 'Electronic');
  assert.strictEqual(upserted.genre_2, 'Ambient');
  assert.strictEqual(upserted.country, 'United Kingdom');
  assert.strictEqual(upserted.release_date, '2025-02-05');
  assert.strictEqual(upserted.cover_image, mockCoverImage);
  assert.strictEqual(upserted.cover_image_format, 'JPEG');
  assert.deepStrictEqual(upserted.tracks, [
    { name: 'Track 1', length: 240000 },
    { name: 'Track 2', length: 180000 },
  ]);

  // Verify the returned canonical album_id was used for the recommendation item
  assert.strictEqual(storedItems.length, 1);
  assert.strictEqual(storedItems[0].albumId, 'canonical-album-id-1');

  // Verify pool metadata also stored on recommendation item
  assert.strictEqual(storedItems[0].genre_1, 'Electronic');
  assert.strictEqual(storedItems[0].genre_2, 'Ambient');
  assert.strictEqual(storedItems[0].country, 'United Kingdom');
});

test('generateForUser creates failed list on engine error', async () => {
  const query = createQueryRouter([
    {
      match: 'personal_recommendation_lists WHERE user_id',
      result: { rows: [], rowCount: 0 },
    },
    { match: 'is_enabled', result: { rows: [], rowCount: 0 } },
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
    if (
      sql.includes('FROM users') &&
      !sql.includes('personal_recommendation')
    ) {
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
  let isEnabledCallCount = 0;
  const query = mock.fn(async (sql) => {
    if (
      sql.includes('FROM users') &&
      !sql.includes('personal_recommendation')
    ) {
      return { rows: [{ _id: 'user-1' }], rowCount: 1 };
    }
    if (sql.includes('personal_recommendation_lists WHERE user_id')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('is_enabled')) {
      isEnabledCallCount++;
      if (isEnabledCallCount === 1) {
        throw new Error('DB error');
      }
      return { rows: [], rowCount: 0 };
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
    if (
      sql.includes('FROM users') &&
      !sql.includes('personal_recommendation')
    ) {
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
