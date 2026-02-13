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
  };
}

/**
 * Creates a mock PostgreSQL pool with sequential query results.
 *
 * @param {Array} queryResults - Array of { rows, rowCount } objects returned in order
 * @param {Object} overrides - Additional properties to merge onto the pool object
 *
 * Examples:
 *   createMockPool([{ rows: [{ id: 1 }] }])           // single query result
 *   createMockPool([{ rows: [] }, { rows: [{ x: 1 }] }]) // two sequential queries
 *   createMockPool([], { connect: myCustomConnect })    // with overrides
 */
function createMockPool(queryResults = [], overrides = {}) {
  let callIndex = 0;
  return {
    query: mock.fn(async () => {
      const result = queryResults[callIndex] || { rows: [], rowCount: 0 };
      callIndex++;
      return result;
    }),
    connect: mock.fn(async () => ({
      query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
      release: mock.fn(),
    })),
    ...overrides,
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

module.exports = {
  createMockLogger,
  createMockPool,
  createMockReq,
  createMockRes,
};
