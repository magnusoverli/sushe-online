const test = require('node:test');
const assert = require('node:assert');

const {
  ErrorTypes,
  AppError,
  createErrorHandler,
  notFoundHandler,
} = require('../middleware/error-handler.js');

// Mock logger
const createMockLogger = () => ({
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
});

// Mock request
const createMockReq = (overrides = {}) => ({
  originalUrl: '/test',
  method: 'GET',
  ip: '127.0.0.1',
  get: () => 'Test User Agent',
  user: null,
  accepts: () => true, // Default to JSON
  flash: null,
  ...overrides,
});

// Mock response
const createMockRes = () => {
  const res = {
    statusCode: null,
    body: null,
    redirectUrl: null,
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (data) {
      this.body = data;
      return this;
    },
    send: function (data) {
      this.body = data;
      return this;
    },
    redirect: function (url) {
      this.redirectUrl = url;
      return this;
    },
  };
  return res;
};

// =============================================================================
// AppError class tests
// =============================================================================

test('AppError should create error with default values', () => {
  const error = new AppError('Test error');

  assert.strictEqual(error.message, 'Test error');
  assert.strictEqual(error.statusCode, 500);
  assert.strictEqual(error.type, ErrorTypes.INTERNAL);
  assert.strictEqual(error.isOperational, true);
  assert.ok(error.timestamp);
  assert.ok(error.stack);
});

test('AppError should accept custom statusCode', () => {
  const error = new AppError('Not found', 404);

  assert.strictEqual(error.statusCode, 404);
});

test('AppError should accept custom type', () => {
  const error = new AppError('Validation failed', 400, ErrorTypes.VALIDATION);

  assert.strictEqual(error.type, ErrorTypes.VALIDATION);
});

test('AppError should accept isOperational flag', () => {
  const error = new AppError('Critical error', 500, ErrorTypes.INTERNAL, false);

  assert.strictEqual(error.isOperational, false);
});

test('AppError should be instance of Error', () => {
  const error = new AppError('Test');

  assert.ok(error instanceof Error);
  assert.ok(error instanceof AppError);
});

// =============================================================================
// ErrorTypes tests
// =============================================================================

test('ErrorTypes should have all expected types', () => {
  assert.strictEqual(ErrorTypes.VALIDATION, 'VALIDATION_ERROR');
  assert.strictEqual(ErrorTypes.AUTHENTICATION, 'AUTHENTICATION_ERROR');
  assert.strictEqual(ErrorTypes.AUTHORIZATION, 'AUTHORIZATION_ERROR');
  assert.strictEqual(ErrorTypes.NOT_FOUND, 'NOT_FOUND_ERROR');
  assert.strictEqual(ErrorTypes.DATABASE, 'DATABASE_ERROR');
  assert.strictEqual(ErrorTypes.EXTERNAL_API, 'EXTERNAL_API_ERROR');
  assert.strictEqual(ErrorTypes.INTERNAL, 'INTERNAL_ERROR');
});

// =============================================================================
// errorHandler tests - specific error types
// =============================================================================

test('errorHandler should handle ValidationError', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('Invalid data');
  err.name = 'ValidationError';

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error.type, ErrorTypes.VALIDATION);
  assert.strictEqual(res.body.error.message, 'Validation Error');
});

test('errorHandler should handle CastError', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('Cast failed');
  err.name = 'CastError';

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(res.body.error.type, ErrorTypes.NOT_FOUND);
  assert.strictEqual(res.body.error.message, 'Resource not found');
});

test('errorHandler should handle CSRF token error', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('CSRF failed');
  err.code = 'EBADCSRFTOKEN';

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.error.type, ErrorTypes.AUTHENTICATION);
  assert.strictEqual(res.body.error.message, 'Invalid CSRF token');
});

test('errorHandler should handle MongoDB duplicate key error (11000)', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('Duplicate key');
  err.code = 11000;

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error.type, ErrorTypes.VALIDATION);
  assert.strictEqual(res.body.error.message, 'Duplicate field value');
});

// =============================================================================
// errorHandler tests - PostgreSQL connection errors
// =============================================================================

test('errorHandler should handle ECONNREFUSED', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('Connection refused');
  err.code = 'ECONNREFUSED';

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.body.error.type, ErrorTypes.DATABASE);
  assert.strictEqual(res.body.error.message, 'Database connection refused');
});

test('errorHandler should handle ETIMEDOUT', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('Timeout');
  err.code = 'ETIMEDOUT';

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.body.error.type, ErrorTypes.DATABASE);
  assert.strictEqual(res.body.error.message, 'Database connection timeout');
});

test('errorHandler should handle ECONNRESET', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('Connection reset');
  err.code = 'ECONNRESET';

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.body.error.type, ErrorTypes.DATABASE);
  assert.strictEqual(res.body.error.message, 'Database connection timeout');
});

test('errorHandler should handle ENOTFOUND', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('Host not found');
  err.code = 'ENOTFOUND';

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.body.error.type, ErrorTypes.DATABASE);
  assert.strictEqual(res.body.error.message, 'Database host not found');
});

// =============================================================================
// errorHandler tests - PostgreSQL specific error codes
// =============================================================================

test('errorHandler should handle PostgreSQL admin shutdown (57P01)', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('Admin shutdown');
  err.code = '57P01';

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.body.error.type, ErrorTypes.DATABASE);
  assert.strictEqual(
    res.body.error.message,
    'Database temporarily unavailable'
  );
});

test('errorHandler should handle PostgreSQL too many connections (53300)', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('Too many connections');
  err.code = '53300';

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.body.error.type, ErrorTypes.DATABASE);
  assert.strictEqual(res.body.error.message, 'Database overloaded');
});

test('errorHandler should handle PostgreSQL connection failure (08006)', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('Connection failure');
  err.code = '08006';

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.body.error.type, ErrorTypes.DATABASE);
  assert.strictEqual(res.body.error.message, 'Database connection failed');
});

test('errorHandler should handle PostgreSQL connection failure (08001)', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('Connection failure');
  err.code = '08001';

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.body.error.type, ErrorTypes.DATABASE);
  assert.strictEqual(res.body.error.message, 'Database connection failed');
});

test('errorHandler should handle PostgreSQL unique violation (23505)', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('Unique violation');
  err.code = '23505';

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.body.error.type, ErrorTypes.VALIDATION);
  assert.strictEqual(res.body.error.message, 'Duplicate data entry');
});

test('errorHandler should handle PostgreSQL foreign key violation (23503)', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('Foreign key violation');
  err.code = '23503';

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error.type, ErrorTypes.VALIDATION);
  assert.strictEqual(res.body.error.message, 'Referenced data not found');
});

// =============================================================================
// errorHandler tests - default handling and response formats
// =============================================================================

test('errorHandler should default to 500 for unknown errors', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('Unknown error');

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 500);
  assert.strictEqual(res.body.error.type, ErrorTypes.INTERNAL);
});

test('errorHandler should preserve AppError properties', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new AppError('Custom error', 422, ErrorTypes.VALIDATION);

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 422);
  assert.strictEqual(res.body.error.message, 'Custom error');
});

test('errorHandler should handle HTML request with flash', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);

  let flashMessage = null;
  const req = createMockReq({
    accepts: () => false, // Not JSON
    flash: (type, msg) => {
      flashMessage = { type, msg };
    },
  });
  const res = createMockRes();

  const err = new Error('Flash error');

  errorHandler(err, req, res, () => {});

  assert.strictEqual(flashMessage.type, 'error');
  assert.strictEqual(flashMessage.msg, 'Flash error');
  assert.strictEqual(res.redirectUrl, 'back');
});

test('errorHandler should fallback to plain text without flash', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq({
    accepts: () => false, // Not JSON
    flash: null, // No flash support
  });
  const res = createMockRes();

  const err = new Error('Plain text error');

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.statusCode, 500);
  assert.strictEqual(res.body, 'Plain text error');
});

test('errorHandler should include stack trace in development', () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';

  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('Dev error');

  errorHandler(err, req, res, () => {});

  assert.ok(res.body.error.stack);
  assert.ok(res.body.error.stack.includes('Dev error'));

  process.env.NODE_ENV = originalEnv;
});

test('errorHandler should not include stack trace in production', () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('Prod error');

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.body.error.stack, undefined);

  process.env.NODE_ENV = originalEnv;
});

test('errorHandler should log error details', () => {
  let loggedData = null;
  const logger = {
    error: (msg, data) => {
      loggedData = { msg, data };
    },
  };
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq({
    originalUrl: '/api/test',
    method: 'POST',
    ip: '192.168.1.1',
    user: { _id: 'user123' },
  });
  const res = createMockRes();

  const err = new Error('Logged error');

  errorHandler(err, req, res, () => {});

  assert.strictEqual(loggedData.msg, 'Error occurred:');
  assert.strictEqual(loggedData.data.message, 'Logged error');
  assert.strictEqual(loggedData.data.url, '/api/test');
  assert.strictEqual(loggedData.data.method, 'POST');
  assert.strictEqual(loggedData.data.ip, '192.168.1.1');
  assert.strictEqual(loggedData.data.userId, 'user123');
});

test('errorHandler should handle error without message', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error();
  err.message = '';

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.body.error.message, 'Internal Server Error');
});

// =============================================================================
// notFoundHandler tests
// =============================================================================

test('notFoundHandler should create 404 AppError', () => {
  let passedError = null;
  const next = (err) => {
    passedError = err;
  };
  const req = createMockReq({ originalUrl: '/unknown/route' });
  const res = createMockRes();

  notFoundHandler(req, res, next);

  assert.ok(passedError instanceof AppError);
  assert.strictEqual(passedError.statusCode, 404);
  assert.strictEqual(passedError.type, ErrorTypes.NOT_FOUND);
  assert.ok(passedError.message.includes('/unknown/route'));
});

test('notFoundHandler should include the requested URL in message', () => {
  let passedError = null;
  const next = (err) => {
    passedError = err;
  };
  const req = createMockReq({ originalUrl: '/api/v1/users/123' });
  const res = createMockRes();

  notFoundHandler(req, res, next);

  assert.strictEqual(passedError.message, 'Route /api/v1/users/123 not found');
});

// =============================================================================
// Edge cases
// =============================================================================

test('errorHandler should handle error with no type property', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = { message: 'No type error', statusCode: 400 };

  errorHandler(err, req, res, () => {});

  assert.strictEqual(res.body.error.type, ErrorTypes.INTERNAL);
});

test('errorHandler should handle error with no timestamp', () => {
  const logger = createMockLogger();
  const errorHandler = createErrorHandler(logger);
  const req = createMockReq();
  const res = createMockRes();

  const err = new Error('No timestamp');

  errorHandler(err, req, res, () => {});

  assert.ok(res.body.error.timestamp);
});
