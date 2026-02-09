const test = require('node:test');
const assert = require('node:assert');
const { mock } = require('node:test');
const {
  createNewReleasePoolService,
} = require('../services/new-release-pool-service.js');
const {
  createPersonalRecommendationsService,
} = require('../services/personal-recommendations-service.js');
const {
  createRecommendationEngine,
} = require('../utils/personal-recommendations-engine.js');

// =============================================================================
// Integration test: end-to-end flow with mocked external APIs
// Pool gathering -> Engine generation -> Service list creation -> Cleanup
// =============================================================================

function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
}

let idCounter = 0;
function mockGenerateId() {
  return `int-test-id-${++idCounter}`;
}

function normalizeAlbumKey(artist, album) {
  return `${String(artist || '')
    .toLowerCase()
    .trim()}::${String(album || '')
    .toLowerCase()
    .trim()}`;
}

// =============================================================================
// Pool service: buildWeeklyPool gathers from sources and stores
// =============================================================================

test('integration: pool service gathers releases from mocked sources', async () => {
  const mockLogger = createMockLogger();
  const insertedRows = [];

  const mockPool = {
    query: mock.fn(async (sql, params) => {
      if (sql.includes('SELECT COUNT')) {
        return { rows: [{ count: '0' }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO weekly_new_releases')) {
        insertedRows.push({
          week_start: params[0],
          album_id: params[1],
          source: params[2],
          artist: params[4],
          album: params[5],
        });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };

  const mockGather = mock.fn(async () => [
    {
      artist: 'Radiohead',
      album: 'New Album',
      source: 'spotify',
      release_date: '2026-02-02',
    },
    {
      artist: 'Bjork',
      album: 'Latest',
      source: 'musicbrainz',
      release_date: '2026-02-03',
    },
    {
      artist: 'FKA twigs',
      album: 'Fresh',
      source: 'claude_search',
      genre: 'electronic',
    },
  ]);

  const poolService = createNewReleasePoolService({
    pool: mockPool,
    logger: mockLogger,
    gatherWeeklyNewReleases: mockGather,
  });

  const count = await poolService.buildWeeklyPool('2026-02-02');
  assert.strictEqual(count, 3);
  assert.strictEqual(insertedRows.length, 3);
  assert.strictEqual(insertedRows[0].artist, 'Radiohead');
  assert.strictEqual(insertedRows[1].source, 'musicbrainz');
  assert.strictEqual(insertedRows[2].artist, 'FKA twigs');
});

test('integration: pool service skips build if pool already exists', async () => {
  const mockLogger = createMockLogger();
  const mockPool = {
    query: mock.fn(async () => ({ rows: [{ count: '15' }], rowCount: 1 })),
  };

  const mockGather = mock.fn(async () => []);

  const poolService = createNewReleasePoolService({
    pool: mockPool,
    logger: mockLogger,
    gatherWeeklyNewReleases: mockGather,
  });

  const count = await poolService.buildWeeklyPool('2026-02-02');
  assert.strictEqual(count, 15);
  // gatherWeeklyNewReleases should not have been called
  assert.strictEqual(mockGather.mock.calls.length, 0);
});

// =============================================================================
// Engine: generates recommendations from Claude with post-processing
// =============================================================================

test('integration: engine calls Claude and parses recommendations', async () => {
  const mockLogger = createMockLogger();
  const mockClaudeClient = {
    callClaude: mock.fn(async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            {
              artist: 'Radiohead',
              album: 'New Album',
              reasoning: 'Matches your taste for experimental rock',
            },
            {
              artist: 'Bjork',
              album: 'Latest',
              reasoning: 'Aligns with your electronic preferences',
            },
          ]),
        },
      ],
      usage: { input_tokens: 500, output_tokens: 200 },
    })),
    extractTextFromContent: (content) => {
      const textBlock = content.find((c) => c.type === 'text');
      return textBlock?.text || '';
    },
  };

  const engine = createRecommendationEngine({
    claudeClient: mockClaudeClient,
    logger: mockLogger,
    normalizeAlbumKey,
    env: {
      PERSONAL_RECS_COUNT: '5',
      PERSONAL_RECS_MODEL: 'claude-sonnet-4-5',
      PERSONAL_RECS_MAX_TOKENS: '1500',
    },
  });

  const result = await engine.generateRecommendations({
    newReleases: [
      { artist: 'Radiohead', album: 'New Album', genre: 'rock' },
      { artist: 'Bjork', album: 'Latest', genre: 'electronic' },
      { artist: 'Drake', album: 'Another One', genre: 'hip-hop' },
    ],
    genreAffinity: [{ genre: 'rock', weight: 10 }],
    artistAffinity: [],
    countryAffinity: [],
    userAlbumKeys: [],
    customPrompt: '',
  });

  assert.ok(result);
  assert.strictEqual(result.recommendations.length, 2);
  assert.strictEqual(result.recommendations[0].artist, 'Radiohead');
  assert.strictEqual(result.recommendations[1].artist, 'Bjork');
  assert.strictEqual(result.inputTokens, 500);
  assert.strictEqual(result.outputTokens, 200);
  assert.ok(result.promptSnapshot);
});

test('integration: engine filters owned albums from recommendations', async () => {
  const mockLogger = createMockLogger();
  const mockClaudeClient = {
    callClaude: mock.fn(async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            {
              artist: 'Radiohead',
              album: 'New Album',
              reasoning: 'Great fit',
            },
            {
              artist: 'Bjork',
              album: 'Latest',
              reasoning: 'Aligns with taste',
            },
          ]),
        },
      ],
      usage: { input_tokens: 300, output_tokens: 100 },
    })),
    extractTextFromContent: (content) => {
      const textBlock = content.find((c) => c.type === 'text');
      return textBlock?.text || '';
    },
  };

  const engine = createRecommendationEngine({
    claudeClient: mockClaudeClient,
    logger: mockLogger,
    normalizeAlbumKey,
    env: { PERSONAL_RECS_COUNT: '5' },
  });

  const result = await engine.generateRecommendations({
    newReleases: [
      { artist: 'Radiohead', album: 'New Album' },
      { artist: 'Bjork', album: 'Latest' },
    ],
    genreAffinity: [],
    artistAffinity: [],
    countryAffinity: [],
    // User already owns Radiohead - New Album
    userAlbumKeys: ['radiohead::new album'],
    customPrompt: '',
  });

  assert.ok(result);
  assert.strictEqual(result.recommendations.length, 1);
  assert.strictEqual(result.recommendations[0].artist, 'Bjork');
});

// =============================================================================
// Service: full flow — eligibility, generation, storage, retrieval
// =============================================================================

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

test('integration: service generates and stores recommendations for eligible user', async () => {
  idCounter = 0;
  const storedItems = [];

  const query = createQueryRouter([
    // generateForUser: check existing list
    {
      match: 'SELECT _id FROM personal_recommendation_lists',
      result: { rows: [], rowCount: 0 },
    },
    // checkEligibility: is_enabled
    { match: 'is_enabled', result: { rows: [], rowCount: 0 } },
    // checkEligibility: album count
    {
      match: 'COUNT(DISTINCT',
      result: { rows: [{ count: '20' }], rowCount: 1 },
    },
    // checkEligibility: last_login
    {
      match: 'last_login',
      result: { rows: [{ last_login: new Date() }], rowCount: 1 },
    },
    // fetchUserContext: genre_affinity
    {
      match: 'genre_affinity',
      result: {
        rows: [
          {
            genre_affinity: [{ genre: 'rock', weight: 10 }],
            artist_affinity: [],
            country_affinity: [],
          },
        ],
        rowCount: 1,
      },
    },
    // fetchUserContext: owned albums
    {
      match: 'SELECT DISTINCT a.artist',
      result: {
        rows: [{ artist: 'Old Band', album: 'Old Album' }],
        rowCount: 1,
      },
    },
    // fetchUserContext: custom prompt
    {
      match: 'SELECT custom_prompt FROM',
      result: { rows: [{ custom_prompt: '' }], rowCount: 1 },
    },
    // INSERT list
    {
      match: 'INSERT INTO personal_recommendation_lists',
      result: { rows: [], rowCount: 1 },
    },
    // INSERT items
    {
      match: 'INSERT INTO personal_recommendation_items',
      result: (sql, params) => {
        storedItems.push({
          id: params[0],
          listId: params[1],
          albumId: params[2],
          position: params[3],
          reasoning: params[4],
        });
        return { rows: [], rowCount: 1 };
      },
    },
  ]);

  const mockEngine = {
    generateRecommendations: mock.fn(async () => ({
      recommendations: [
        {
          artist: 'Radiohead',
          album: 'New Album',
          reasoning: 'Experimental rock fit',
        },
        {
          artist: 'Bjork',
          album: 'Latest',
          reasoning: 'Electronic alignment',
        },
      ],
      promptSnapshot: 'test prompt snapshot',
      inputTokens: 500,
      outputTokens: 200,
    })),
  };

  const mockPoolService = {
    getPoolForWeek: mock.fn(async () => [
      { artist: 'Radiohead', album: 'New Album', album_id: 'album-r1' },
      { artist: 'Bjork', album: 'Latest', album_id: 'album-b1' },
      { artist: 'Drake', album: 'Another One', album_id: 'album-d1' },
    ]),
    buildWeeklyPool: mock.fn(async () => {}),
    cleanupOldPools: mock.fn(async () => {}),
  };

  const service = createPersonalRecommendationsService({
    pool: { query },
    logger: createMockLogger(),
    recommendationEngine: mockEngine,
    poolService: mockPoolService,
    normalizeAlbumKey,
    env: {
      PERSONAL_RECS_MODEL: 'claude-sonnet-4-5',
      PERSONAL_RECS_RATE_LIMIT_MS: '0',
      PERSONAL_RECS_MIN_ALBUMS: '10',
      PERSONAL_RECS_ACTIVE_DAYS: '30',
    },
    generateId: mockGenerateId,
  });

  const result = await service.generateForUser('user-1', '2026-02-02');
  assert.ok(result);
  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(storedItems.length, 2);
  assert.strictEqual(storedItems[0].position, 1);
  assert.strictEqual(storedItems[0].reasoning, 'Experimental rock fit');
  assert.strictEqual(storedItems[1].position, 2);
  assert.strictEqual(storedItems[1].reasoning, 'Electronic alignment');
});

test('integration: service returns failed list when release pool is empty', async () => {
  idCounter = 0;
  let insertedFailed = false;

  const query = createQueryRouter([
    {
      match: 'SELECT _id FROM personal_recommendation_lists',
      result: { rows: [], rowCount: 0 },
    },
    { match: 'is_enabled', result: { rows: [], rowCount: 0 } },
    {
      match: 'COUNT(DISTINCT',
      result: { rows: [{ count: '20' }], rowCount: 1 },
    },
    {
      match: 'last_login',
      result: { rows: [{ last_login: new Date() }], rowCount: 1 },
    },
    { match: 'genre_affinity', result: { rows: [{}], rowCount: 1 } },
    {
      match: 'SELECT DISTINCT a.artist',
      result: { rows: [], rowCount: 0 },
    },
    {
      match: 'SELECT custom_prompt FROM',
      result: { rows: [], rowCount: 0 },
    },
    {
      match: 'INSERT INTO personal_recommendation_lists',
      result: () => {
        insertedFailed = true;
        return { rows: [], rowCount: 1 };
      },
    },
  ]);

  const mockPoolService = {
    getPoolForWeek: mock.fn(async () => []),
    buildWeeklyPool: mock.fn(async () => {}),
    cleanupOldPools: mock.fn(async () => {}),
  };

  const service = createPersonalRecommendationsService({
    pool: { query },
    logger: createMockLogger(),
    recommendationEngine: { generateRecommendations: mock.fn() },
    poolService: mockPoolService,
    normalizeAlbumKey,
    env: {
      PERSONAL_RECS_RATE_LIMIT_MS: '0',
      PERSONAL_RECS_MIN_ALBUMS: '10',
      PERSONAL_RECS_ACTIVE_DAYS: '30',
    },
    generateId: mockGenerateId,
  });

  const result = await service.generateForUser('user-1', '2026-02-02');
  assert.ok(result);
  assert.strictEqual(result.status, 'failed');
  assert.ok(insertedFailed);
});

test('integration: service skips ineligible users in generateForAllUsers', async () => {
  idCounter = 0;

  const query = createQueryRouter([
    // generateForAllUsers: get active users
    {
      match: 'SELECT _id FROM users',
      result: {
        rows: [{ _id: 'user-1' }, { _id: 'user-2' }],
        rowCount: 2,
      },
    },
    // generateForUser: check existing list (none)
    {
      match: 'SELECT _id FROM personal_recommendation_lists',
      result: { rows: [], rowCount: 0 },
    },
    // checkEligibility: disabled for all users in this test
    {
      match: 'is_enabled',
      result: { rows: [{ is_enabled: false }], rowCount: 1 },
    },
  ]);

  const mockPoolService = {
    buildWeeklyPool: mock.fn(async () => {}),
    getPoolForWeek: mock.fn(async () => []),
    cleanupOldPools: mock.fn(async () => {}),
  };

  const service = createPersonalRecommendationsService({
    pool: { query },
    logger: createMockLogger(),
    recommendationEngine: { generateRecommendations: mock.fn() },
    poolService: mockPoolService,
    normalizeAlbumKey,
    env: {
      PERSONAL_RECS_RATE_LIMIT_MS: '0',
      PERSONAL_RECS_MIN_ALBUMS: '10',
      PERSONAL_RECS_ACTIVE_DAYS: '30',
    },
    generateId: mockGenerateId,
  });

  const result = await service.generateForAllUsers('2026-02-02');
  assert.strictEqual(result.skipped, 2);
  assert.strictEqual(result.success, 0);
  assert.strictEqual(result.failed, 0);
  assert.strictEqual(mockPoolService.buildWeeklyPool.mock.calls.length, 1);
});

// =============================================================================
// Rotation and cleanup
// =============================================================================

test('integration: rotateAndCleanup deletes old lists and cleans pools', async () => {
  let deletedListsCutoff = null;

  const query = createQueryRouter([
    {
      match: 'DELETE FROM personal_recommendation_lists',
      result: (sql, params) => {
        deletedListsCutoff = params[0];
        return { rows: [], rowCount: 3 };
      },
    },
  ]);

  const mockPoolService = {
    cleanupOldPools: mock.fn(async () => {}),
    buildWeeklyPool: mock.fn(async () => {}),
    getPoolForWeek: mock.fn(async () => []),
  };

  const service = createPersonalRecommendationsService({
    pool: { query },
    logger: createMockLogger(),
    poolService: mockPoolService,
    normalizeAlbumKey,
    env: { PERSONAL_RECS_RATE_LIMIT_MS: '0' },
    generateId: mockGenerateId,
  });

  await service.rotateAndCleanup('2026-02-09');
  assert.ok(deletedListsCutoff);
  // weekStart 2026-02-09 minus 7 days = 2026-02-02
  assert.strictEqual(deletedListsCutoff, '2026-02-02');
  assert.strictEqual(mockPoolService.cleanupOldPools.mock.calls.length, 1);
});

// =============================================================================
// Data retrieval
// =============================================================================

test('integration: getListsForUser returns lists with items', async () => {
  const query = createQueryRouter([
    {
      match: 'personal_recommendation_lists prl',
      result: {
        rows: [
          {
            _id: 'list-1',
            user_id: 'user-1',
            week_start: '2026-02-02',
            status: 'completed',
            items: [
              {
                _id: 'item-1',
                album_id: 'alb-1',
                position: 1,
                reasoning: 'Great fit',
                artist: 'Radiohead',
                album: 'New Album',
                cover_image: null,
              },
            ],
          },
        ],
        rowCount: 1,
      },
    },
  ]);

  const service = createPersonalRecommendationsService({
    pool: { query },
    logger: createMockLogger(),
    normalizeAlbumKey,
    env: { PERSONAL_RECS_RATE_LIMIT_MS: '0' },
    generateId: mockGenerateId,
  });

  const lists = await service.getListsForUser('user-1');
  assert.strictEqual(lists.length, 1);
  assert.strictEqual(lists[0]._id, 'list-1');
  assert.strictEqual(lists[0].status, 'completed');
  assert.strictEqual(lists[0].items.length, 1);
  assert.strictEqual(lists[0].items[0].artist, 'Radiohead');
});

test('integration: getListById returns null for non-existent list', async () => {
  const query = createQueryRouter([
    {
      match: 'personal_recommendation_lists prl',
      result: { rows: [], rowCount: 0 },
    },
  ]);

  const service = createPersonalRecommendationsService({
    pool: { query },
    logger: createMockLogger(),
    normalizeAlbumKey,
    env: { PERSONAL_RECS_RATE_LIMIT_MS: '0' },
    generateId: mockGenerateId,
  });

  const list = await service.getListById('nonexistent', 'user-1');
  assert.strictEqual(list, null);
});

// =============================================================================
// User prompt settings
// =============================================================================

test('integration: getUserPromptSettings returns defaults for new user', async () => {
  const query = createQueryRouter([
    {
      match: 'SELECT custom_prompt, is_enabled',
      result: { rows: [], rowCount: 0 },
    },
  ]);

  const service = createPersonalRecommendationsService({
    pool: { query },
    logger: createMockLogger(),
    normalizeAlbumKey,
    env: { PERSONAL_RECS_RATE_LIMIT_MS: '0' },
    generateId: mockGenerateId,
  });

  const settings = await service.getUserPromptSettings('new-user');
  assert.strictEqual(settings.customPrompt, '');
  assert.strictEqual(settings.isEnabled, true);
});

test('integration: updateUserPromptSettings upserts correctly', async () => {
  let upsertedParams = null;

  const query = createQueryRouter([
    {
      match: 'INSERT INTO personal_recommendation_prompts',
      result: (sql, params) => {
        upsertedParams = params;
        return { rows: [], rowCount: 1 };
      },
    },
  ]);

  const service = createPersonalRecommendationsService({
    pool: { query },
    logger: createMockLogger(),
    normalizeAlbumKey,
    env: { PERSONAL_RECS_RATE_LIMIT_MS: '0' },
    generateId: mockGenerateId,
  });

  await service.updateUserPromptSettings('user-1', {
    customPrompt: 'I love jazz',
    isEnabled: true,
  });
  assert.ok(upsertedParams);
  assert.strictEqual(upsertedParams[0], 'user-1');
  assert.strictEqual(upsertedParams[1], 'I love jazz');
  assert.strictEqual(upsertedParams[2], true);
});

test('integration: updateUserPromptSettings rejects long prompts', async () => {
  const service = createPersonalRecommendationsService({
    pool: { query: mock.fn() },
    logger: createMockLogger(),
    normalizeAlbumKey,
    env: { PERSONAL_RECS_RATE_LIMIT_MS: '0' },
    generateId: mockGenerateId,
  });

  await assert.rejects(
    () =>
      service.updateUserPromptSettings('user-1', {
        customPrompt: 'x'.repeat(1001),
      }),
    /1000 characters/
  );
});

// =============================================================================
// Full end-to-end: pool -> engine -> service -> retrieval
// =============================================================================

test('integration: full flow from pool build to list retrieval', async () => {
  idCounter = 0;
  const storedReleases = [];
  const storedListItems = [];
  let listInserted = false;

  // Simulated pool data store
  const poolData = [];

  const query = createQueryRouter([
    // Pool build: count existing (more specific match to avoid collision)
    {
      match: 'COUNT(*) as count FROM weekly_new_releases',
      result: () => ({
        rows: [{ count: String(poolData.length) }],
        rowCount: 1,
      }),
    },
    // Pool build: INSERT weekly_new_releases
    {
      match: 'INSERT INTO weekly_new_releases',
      result: (sql, params) => {
        const release = {
          week_start: params[0],
          album_id: params[1],
          source: params[2],
          artist: params[4],
          album: params[5],
        };
        poolData.push(release);
        storedReleases.push(release);
        return { rows: [], rowCount: 1 };
      },
    },
    // Pool getPoolForWeek: SELECT *
    {
      match: 'SELECT * FROM weekly_new_releases',
      result: () => ({ rows: [...poolData], rowCount: poolData.length }),
    },
    // Service: check existing list
    {
      match: 'SELECT _id FROM personal_recommendation_lists',
      result: { rows: [], rowCount: 0 },
    },
    // Eligibility: is_enabled
    { match: 'is_enabled', result: { rows: [], rowCount: 0 } },
    // Eligibility: album count (specific match to avoid collision with pool count)
    {
      match: 'COUNT(DISTINCT li.album_id)',
      result: { rows: [{ count: '25' }], rowCount: 1 },
    },
    // Eligibility: last_login
    {
      match: 'last_login',
      result: { rows: [{ last_login: new Date() }], rowCount: 1 },
    },
    // fetchUserContext: affinity
    {
      match: 'genre_affinity',
      result: {
        rows: [
          {
            genre_affinity: [{ genre: 'electronic', weight: 8 }],
            artist_affinity: [],
            country_affinity: [],
          },
        ],
        rowCount: 1,
      },
    },
    // fetchUserContext: owned albums
    {
      match: 'SELECT DISTINCT a.artist',
      result: { rows: [], rowCount: 0 },
    },
    // fetchUserContext: custom prompt
    {
      match: 'SELECT custom_prompt FROM',
      result: { rows: [], rowCount: 0 },
    },
    // INSERT list
    {
      match: 'INSERT INTO personal_recommendation_lists',
      result: () => {
        listInserted = true;
        return { rows: [], rowCount: 1 };
      },
    },
    // INSERT items
    {
      match: 'INSERT INTO personal_recommendation_items',
      result: (sql, params) => {
        storedListItems.push({
          id: params[0],
          listId: params[1],
          albumId: params[2],
          position: params[3],
          reasoning: params[4],
        });
        return { rows: [], rowCount: 1 };
      },
    },
  ]);

  const mockGather = mock.fn(async () => [
    {
      artist: 'Aphex Twin',
      album: 'Syro II',
      source: 'spotify',
      release_date: '2026-02-03',
    },
    {
      artist: 'Burial',
      album: 'Untrue II',
      source: 'musicbrainz',
      release_date: '2026-02-04',
    },
  ]);

  const mockClaudeClient = {
    callClaude: mock.fn(async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            {
              artist: 'Aphex Twin',
              album: 'Syro II',
              reasoning: 'Matches electronic taste',
            },
            {
              artist: 'Burial',
              album: 'Untrue II',
              reasoning: 'Dark electronic alignment',
            },
          ]),
        },
      ],
      usage: { input_tokens: 400, output_tokens: 150 },
    })),
    extractTextFromContent: (content) => {
      const textBlock = content.find((c) => c.type === 'text');
      return textBlock?.text || '';
    },
  };

  // Step 1: Build pool
  const poolService = createNewReleasePoolService({
    pool: { query },
    logger: createMockLogger(),
    gatherWeeklyNewReleases: mockGather,
  });

  await poolService.buildWeeklyPool('2026-02-02');
  assert.strictEqual(storedReleases.length, 2);

  // Step 2: Create engine
  const engine = createRecommendationEngine({
    claudeClient: mockClaudeClient,
    logger: createMockLogger(),
    normalizeAlbumKey,
    env: { PERSONAL_RECS_COUNT: '5' },
  });

  // Step 3: Create service using real pool service and engine
  const service = createPersonalRecommendationsService({
    pool: { query },
    logger: createMockLogger(),
    recommendationEngine: engine,
    poolService,
    normalizeAlbumKey,
    env: {
      PERSONAL_RECS_MODEL: 'claude-sonnet-4-5',
      PERSONAL_RECS_RATE_LIMIT_MS: '0',
      PERSONAL_RECS_MIN_ALBUMS: '10',
      PERSONAL_RECS_ACTIVE_DAYS: '30',
    },
    generateId: mockGenerateId,
  });

  // Step 4: Generate recommendations
  const result = await service.generateForUser('user-1', '2026-02-02');
  assert.ok(result);
  assert.strictEqual(result.status, 'completed');
  assert.ok(listInserted);
  assert.strictEqual(storedListItems.length, 2);
  assert.strictEqual(storedListItems[0].reasoning, 'Matches electronic taste');
  assert.strictEqual(storedListItems[1].reasoning, 'Dark electronic alignment');

  // Verify Claude was called with the pool data
  assert.strictEqual(mockClaudeClient.callClaude.mock.calls.length, 1);
});
