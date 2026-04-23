/**
 * Shared test helpers - mock factories used across multiple test files.
 *
 * Usage:
 *   const { createMockLogger, createMockPool, createMockReq, createMockRes } = require('./helpers');
 *
 * Guidelines:
 *   - Use these for generic mocks that don't need domain-specific behavior.
 *   - Domain-specific mocks (e.g., SQL-pattern-matching pools) should remain local to their test file.
 *   - All mock functions use `mock.fn()` so call assertions (e.g., `.mock.calls.length`) work.
 */
const { mock } = require('node:test');

/**
 * Creates a mock logger with info/warn/error/debug methods.
 * All methods are mock.fn() so tests can assert on call counts and arguments.
 */
function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
    shutdown: mock.fn(async () => {}),
  };
}

/**
 * Creates a mock datastore/pool that satisfies BOTH the legacy pg-pool
 * surface (query/connect) and the canonical datastore surface
 * (raw/withClient/withTransaction). Services now require `deps.db`, but
 * many tests historically created a "pool" with `.query`; this helper
 * lets those tests keep working by exposing `.raw` as an alias.
 *
 * @param {Array} queryResults - Array of { rows, rowCount } objects returned in order
 * @param {Object} overrides - Additional properties to merge onto the object
 */
function createMockPool(queryResults = [], overrides = {}) {
  let callIndex = 0;
  const defaultQuery = mock.fn(async () => {
    const result = queryResults[callIndex] || { rows: [], rowCount: 0 };
    callIndex++;
    return result;
  });
  const defaultConnect = mock.fn(async () => ({
    query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    release: mock.fn(),
  }));
  // Overrides can swap out query or connect — raw always tracks the
  // active .query so `.raw()` callers hit the same mock that tests
  // installed as `query`.
  const query = overrides.query || defaultQuery;
  const connect = overrides.connect || defaultConnect;
  return {
    ...overrides,
    // Legacy pg-pool surface
    query,
    connect,
    // Canonical datastore surface — raw shares the active query mock so
    // call assertions on `pool.query.mock.calls` still work when the
    // code under test now invokes `.raw()` on what it received as
    // `deps.db`.
    raw: query,
    withClient: mock.fn(async (cb) => {
      const client = await connect();
      try {
        return await cb(client);
      } finally {
        if (client.release) client.release();
      }
    }),
    withTransaction: mock.fn(async (cb) => {
      const client = await connect();
      try {
        await client.query('BEGIN');
        const r = await cb(client);
        await client.query('COMMIT');
        return r;
      } finally {
        if (client.release) client.release();
      }
    }),
  };
}

/**
 * Creates a mock canonical datastore with just the .raw interface.
 * @param {Function} rawFn - The mock implementation for .raw
 */
function createMockDb(
  rawFn = mock.fn(async () => ({ rows: [], rowCount: 0 }))
) {
  return {
    raw: rawFn,
    withClient: mock.fn(async (cb) =>
      cb({ query: mock.fn(async () => ({ rows: [] })), release: () => {} })
    ),
    withTransaction: mock.fn(async (cb) =>
      cb({ query: mock.fn(async () => ({ rows: [] })), release: () => {} })
    ),
  };
}

/**
 * Creates a mock Express request object.
 *
 * @param {Object} overrides - Properties to merge/override on the request
 */
function createMockReq(overrides = {}) {
  return {
    originalUrl: '/test',
    method: 'GET',
    ip: '127.0.0.1',
    get: () => 'Test User Agent',
    user: null,
    accepts: () => true,
    flash: null,
    params: {},
    session: {
      id: 'test-session-id',
      passport: { user: 'user123' },
      save: (callback) => callback(null),
    },
    ...overrides,
  };
}

/**
 * Creates a mock Express response object.
 * All methods are mock.fn() and return `res` for chaining (e.g., `res.status(200).json(data)`).
 */
function createMockRes() {
  const res = {
    statusCode: null,
    body: null,
    redirectUrl: null,
    headersSent: false,
    status: mock.fn(function (code) {
      res.statusCode = code;
      return res;
    }),
    json: mock.fn(function (data) {
      res.body = data;
      return res;
    }),
    send: mock.fn(function (data) {
      res.body = data;
      return res;
    }),
    redirect: mock.fn(function (url) {
      res.redirectUrl = url;
      return res;
    }),
  };
  return res;
}

/**
 * Decorate a bare { query, connect } pool mock with the datastore surface
 * (raw + withTransaction + withClient) so it can be passed as deps.db.
 *
 * For tests that construct pool literals inline with only query/connect.
 *
 * @param {Object} pool - Minimum: { query: fn }. Optional: connect: fn.
 * @returns {Object} The same pool, augmented in place.
 */
function asMockDb(pool) {
  if (!pool.raw) pool.raw = pool.query;
  if (!pool.withClient) {
    pool.withClient = async (cb) => {
      const c = pool.connect
        ? await pool.connect()
        : { query: pool.query, release: () => {} };
      try {
        return await cb(c);
      } finally {
        if (c.release) c.release();
      }
    };
  }
  if (!pool.withTransaction) {
    pool.withTransaction = async (cb) => {
      const c = pool.connect
        ? await pool.connect()
        : { query: pool.query, release: () => {} };
      try {
        await c.query('BEGIN');
        const r = await cb(c);
        await c.query('COMMIT');
        return r;
      } catch (err) {
        try {
          await c.query('ROLLBACK');
        } catch (_err) {
          // ignore rollback failures in test mocks
        }
        throw err;
      } finally {
        if (c.release) c.release();
      }
    };
  }
  return pool;
}

module.exports = {
  createMockLogger,
  createMockPool,
  createMockDb,
  asMockDb,
  createMockReq,
  createMockRes,
};
