const test = require('node:test');
const assert = require('node:assert');
const { mock } = require('node:test');
const registerRoutes = require('../routes/api/personal-recommendations.js');

// =============================================================================
// Helpers
// =============================================================================

function createMockApp() {
  const routes = {};

  function registerRoute(method, path, ...handlers) {
    routes[`${method}:${path}`] = handlers;
  }

  return {
    get: (...args) => registerRoute('GET', ...args),
    put: (...args) => registerRoute('PUT', ...args),
    post: (...args) => registerRoute('POST', ...args),
    routes,
    getHandler(method, path) {
      const key = `${method}:${path}`;
      const handlers = routes[key];
      if (!handlers) throw new Error(`No route registered for ${key}`);
      // Return last handler (the actual route handler, after middleware)
      return handlers[handlers.length - 1];
    },
  };
}

function createMockReq(overrides = {}) {
  return {
    user: { _id: 'user-1', role: 'user', ...overrides.user },
    params: overrides.params || {},
    body: overrides.body || {},
    ...overrides,
  };
}

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(data) {
      res.body = data;
      return res;
    },
  };
  return res;
}

function createMockService() {
  return {
    getListsForUser: mock.fn(async () => []),
    getListById: mock.fn(async () => null),
    getUserPromptSettings: mock.fn(async () => ({
      customPrompt: '',
      isEnabled: true,
    })),
    updateUserPromptSettings: mock.fn(async () => {}),
    generateForUser: mock.fn(async () => ({
      _id: 'list-1',
      status: 'completed',
    })),
    generateForAllUsers: mock.fn(async () => ({
      success: 1,
      failed: 0,
      skipped: 0,
    })),
  };
}

function setupRoutes(serviceOverrides) {
  const app = createMockApp();
  const mockService = { ...createMockService(), ...serviceOverrides };
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const ensureAuthAPI = (req, _res, next) => next();
  const mockPool = { query: mock.fn(async () => ({ rows: [], rowCount: 0 })) };

  registerRoutes(app, {
    ensureAuthAPI,
    personalRecsService: mockService,
    logger: mockLogger,
    pool: mockPool,
  });

  return { app, mockService, mockLogger, mockPool };
}

// =============================================================================
// Route registration
// =============================================================================

test('routes are not registered when service is null', () => {
  const app = createMockApp();
  registerRoutes(app, {
    ensureAuthAPI: () => {},
    personalRecsService: null,
    logger: { info: mock.fn(), warn: mock.fn(), error: mock.fn() },
  });
  assert.strictEqual(Object.keys(app.routes).length, 0);
});

test('routes are registered when service is provided', () => {
  const { app } = setupRoutes();
  const keys = Object.keys(app.routes);
  assert.ok(keys.includes('GET:/api/personal-recommendations'));
  assert.ok(keys.includes('GET:/api/personal-recommendations/prompts'));
  assert.ok(keys.includes('PUT:/api/personal-recommendations/prompts'));
  assert.ok(keys.includes('GET:/api/personal-recommendations/:listId'));
  assert.ok(keys.includes('POST:/api/admin/personal-recommendations/generate'));
  assert.ok(
    keys.includes('POST:/api/admin/personal-recommendations/generate/:userId')
  );
  assert.ok(keys.includes('GET:/api/admin/personal-recommendations/stats'));
});

// =============================================================================
// GET /api/personal-recommendations
// =============================================================================

test('GET /personal-recommendations returns user lists', async () => {
  const lists = [{ _id: 'list-1', week_start: '2025-02-03', items: [] }];
  const { app } = setupRoutes({
    getListsForUser: mock.fn(async () => lists),
  });

  const handler = app.getHandler('GET', '/api/personal-recommendations');
  const req = createMockReq();
  const res = createMockRes();

  await handler(req, res, mock.fn());
  assert.strictEqual(res.body.success, true);
  assert.deepStrictEqual(res.body.lists, lists);
});

test('GET /personal-recommendations calls next on error', async () => {
  const error = new Error('DB error');
  const { app } = setupRoutes({
    getListsForUser: mock.fn(async () => {
      throw error;
    }),
  });

  const handler = app.getHandler('GET', '/api/personal-recommendations');
  const req = createMockReq();
  const res = createMockRes();
  const next = mock.fn();

  await handler(req, res, next);
  assert.strictEqual(next.mock.calls.length, 1);
  assert.strictEqual(next.mock.calls[0].arguments[0], error);
});

// =============================================================================
// GET /api/personal-recommendations/prompts
// =============================================================================

test('GET /prompts returns user settings', async () => {
  const settings = { customPrompt: 'I like jazz', isEnabled: true };
  const { app } = setupRoutes({
    getUserPromptSettings: mock.fn(async () => settings),
  });

  const handler = app.getHandler(
    'GET',
    '/api/personal-recommendations/prompts'
  );
  const req = createMockReq();
  const res = createMockRes();

  await handler(req, res, mock.fn());
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.customPrompt, 'I like jazz');
  assert.strictEqual(res.body.isEnabled, true);
});

// =============================================================================
// PUT /api/personal-recommendations/prompts
// =============================================================================

test('PUT /prompts updates settings', async () => {
  const updateFn = mock.fn(async () => {});
  const { app } = setupRoutes({
    updateUserPromptSettings: updateFn,
  });

  const handler = app.getHandler(
    'PUT',
    '/api/personal-recommendations/prompts'
  );
  const req = createMockReq({
    body: { customPrompt: 'I like rock', isEnabled: false },
  });
  const res = createMockRes();

  await handler(req, res, mock.fn());
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(updateFn.mock.calls.length, 1);
  assert.strictEqual(
    updateFn.mock.calls[0].arguments[1].customPrompt,
    'I like rock'
  );
});

test('PUT /prompts rejects non-string customPrompt', async () => {
  const { app } = setupRoutes();

  const handler = app.getHandler(
    'PUT',
    '/api/personal-recommendations/prompts'
  );
  const req = createMockReq({ body: { customPrompt: 123 } });
  const res = createMockRes();

  await handler(req, res, mock.fn());
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.success, false);
  assert.ok(res.body.error.includes('string'));
});

test('PUT /prompts rejects customPrompt over 1000 chars', async () => {
  const { app } = setupRoutes();

  const handler = app.getHandler(
    'PUT',
    '/api/personal-recommendations/prompts'
  );
  const req = createMockReq({ body: { customPrompt: 'x'.repeat(1001) } });
  const res = createMockRes();

  await handler(req, res, mock.fn());
  assert.strictEqual(res.statusCode, 400);
  assert.ok(res.body.error.includes('1000'));
});

test('PUT /prompts rejects non-boolean isEnabled', async () => {
  const { app } = setupRoutes();

  const handler = app.getHandler(
    'PUT',
    '/api/personal-recommendations/prompts'
  );
  const req = createMockReq({ body: { isEnabled: 'yes' } });
  const res = createMockRes();

  await handler(req, res, mock.fn());
  assert.strictEqual(res.statusCode, 400);
  assert.ok(res.body.error.includes('boolean'));
});

test('PUT /prompts allows partial updates', async () => {
  const updateFn = mock.fn(async () => {});
  const { app } = setupRoutes({
    updateUserPromptSettings: updateFn,
  });

  const handler = app.getHandler(
    'PUT',
    '/api/personal-recommendations/prompts'
  );
  const req = createMockReq({ body: { isEnabled: false } });
  const res = createMockRes();

  await handler(req, res, mock.fn());
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(
    updateFn.mock.calls[0].arguments[1].customPrompt,
    undefined
  );
  assert.strictEqual(updateFn.mock.calls[0].arguments[1].isEnabled, false);
});

// =============================================================================
// GET /api/personal-recommendations/:listId
// =============================================================================

test('GET /:listId returns list when found', async () => {
  const list = {
    _id: 'list-1',
    items: [{ artist: 'A', album: 'B' }],
  };
  const { app } = setupRoutes({
    getListById: mock.fn(async () => list),
  });

  const handler = app.getHandler(
    'GET',
    '/api/personal-recommendations/:listId'
  );
  const req = createMockReq({ params: { listId: 'list-1' } });
  const res = createMockRes();

  await handler(req, res, mock.fn());
  assert.strictEqual(res.body.success, true);
  assert.deepStrictEqual(res.body.list, list);
  assert.deepStrictEqual(res.body.items, list.items);
});

test('GET /:listId returns 404 when not found', async () => {
  const { app } = setupRoutes({
    getListById: mock.fn(async () => null),
  });

  const handler = app.getHandler(
    'GET',
    '/api/personal-recommendations/:listId'
  );
  const req = createMockReq({ params: { listId: 'nonexistent' } });
  const res = createMockRes();

  await handler(req, res, mock.fn());
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(res.body.success, false);
});

// =============================================================================
// POST /api/admin/personal-recommendations/generate (all users)
// =============================================================================

test('POST /admin/generate rejects non-admin', async () => {
  const { app } = setupRoutes();

  const handler = app.getHandler(
    'POST',
    '/api/admin/personal-recommendations/generate'
  );
  const req = createMockReq({ user: { _id: 'user-1', role: 'user' } });
  const res = createMockRes();

  await handler(req, res, mock.fn());
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.success, false);
  assert.ok(res.body.error.includes('Admin'));
});

test('POST /admin/generate starts generation for admin', async () => {
  const generateFn = mock.fn(async () => ({
    success: 1,
    failed: 0,
    skipped: 0,
  }));
  const { app } = setupRoutes({
    generateForAllUsers: generateFn,
  });

  const handler = app.getHandler(
    'POST',
    '/api/admin/personal-recommendations/generate'
  );
  const req = createMockReq({ user: { _id: 'admin-1', role: 'admin' } });
  const res = createMockRes();

  await handler(req, res, mock.fn());
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.message, 'Generation started');
  assert.ok(res.body.weekStart); // Should have a date string
});

// =============================================================================
// POST /api/admin/personal-recommendations/generate/:userId
// =============================================================================

test('POST /admin/generate/:userId rejects non-admin', async () => {
  const { app } = setupRoutes();

  const handler = app.getHandler(
    'POST',
    '/api/admin/personal-recommendations/generate/:userId'
  );
  const req = createMockReq({
    user: { _id: 'user-1', role: 'user' },
    params: { userId: 'target-user' },
  });
  const res = createMockRes();

  await handler(req, res, mock.fn());
  assert.strictEqual(res.statusCode, 403);
});

test('POST /admin/generate/:userId generates for specific user', async () => {
  const generateFn = mock.fn(async () => ({
    _id: 'list-1',
    status: 'completed',
  }));
  const { app } = setupRoutes({
    generateForUser: generateFn,
  });

  const handler = app.getHandler(
    'POST',
    '/api/admin/personal-recommendations/generate/:userId'
  );
  const req = createMockReq({
    user: { _id: 'admin-1', role: 'admin' },
    params: { userId: 'target-user' },
  });
  const res = createMockRes();

  await handler(req, res, mock.fn());
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.result._id, 'list-1');
  assert.strictEqual(generateFn.mock.calls[0].arguments[0], 'target-user');
});

// =============================================================================
// GET /api/admin/personal-recommendations/stats
// =============================================================================

test('GET /admin/stats rejects non-admin', async () => {
  const { app } = setupRoutes();

  const handler = app.getHandler(
    'GET',
    '/api/admin/personal-recommendations/stats'
  );
  const req = createMockReq({ user: { _id: 'user-1', role: 'user' } });
  const res = createMockRes();

  await handler(req, res, mock.fn());
  assert.strictEqual(res.statusCode, 403);
});

test('GET /admin/stats returns stats for admin', async () => {
  const app = createMockApp();
  const mockService = createMockService();
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };

  let queryCallIndex = 0;
  const mockPool = {
    query: mock.fn(async () => {
      queryCallIndex++;
      if (queryCallIndex === 1) {
        return {
          rows: [
            {
              total_lists: '10',
              completed: '8',
              failed: '2',
              total_input_tokens: '5000',
              total_output_tokens: '2000',
            },
          ],
        };
      }
      if (queryCallIndex === 2) {
        return {
          rows: [
            { source: 'spotify', count: '50' },
            { source: 'musicbrainz', count: '30' },
          ],
        };
      }
      return { rows: [{ count: '5' }] };
    }),
  };

  registerRoutes(app, {
    ensureAuthAPI: (_req, _res, next) => next(),
    personalRecsService: mockService,
    logger: mockLogger,
    pool: mockPool,
  });

  const handler = app.getHandler(
    'GET',
    '/api/admin/personal-recommendations/stats'
  );
  const req = createMockReq({ user: { _id: 'admin-1', role: 'admin' } });
  const res = createMockRes();

  await handler(req, res, mock.fn());
  assert.strictEqual(res.body.success, true);
  assert.ok(res.body.stats.lists);
  assert.ok(res.body.stats.poolBySource);
  assert.strictEqual(res.body.stats.enabledUsers, 5);
});
