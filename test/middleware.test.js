const test = require('node:test');
const assert = require('node:assert');

// Mock logger to avoid file system operations in tests
const mockLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

// Mock the logger module
require.cache[require.resolve('../utils/logger')] = {
  exports: mockLogger,
};

const {
  AppError,
  ErrorTypes,
  errorHandler,
} = require('../middleware/error-handler.js');

test('AppError should create error with correct properties', () => {
  const error = new AppError('Test error', 400, ErrorTypes.VALIDATION);

  assert.strictEqual(error.message, 'Test error');
  assert.strictEqual(error.statusCode, 400);
  assert.strictEqual(error.type, ErrorTypes.VALIDATION);
  assert.strictEqual(error.isOperational, true);
  assert.ok(error.timestamp);
  assert.ok(error.stack);
});

test('AppError should use default values', () => {
  const error = new AppError('Test error');

  assert.strictEqual(error.statusCode, 500);
  assert.strictEqual(error.type, ErrorTypes.INTERNAL);
  assert.strictEqual(error.isOperational, true);
});

test('ErrorTypes should contain expected error types', () => {
  assert.strictEqual(ErrorTypes.VALIDATION, 'VALIDATION_ERROR');
  assert.strictEqual(ErrorTypes.AUTHENTICATION, 'AUTHENTICATION_ERROR');
  assert.strictEqual(ErrorTypes.AUTHORIZATION, 'AUTHORIZATION_ERROR');
  assert.strictEqual(ErrorTypes.NOT_FOUND, 'NOT_FOUND_ERROR');
  assert.strictEqual(ErrorTypes.DATABASE, 'DATABASE_ERROR');
  assert.strictEqual(ErrorTypes.EXTERNAL_API, 'EXTERNAL_API_ERROR');
  assert.strictEqual(ErrorTypes.INTERNAL, 'INTERNAL_ERROR');
});

test('errorHandler should handle AppError correctly', () => {
  const mockReq = {
    get: () => 'application/json',
    accepts: () => 'json',
    method: 'GET',
    url: '/test',
    ip: '127.0.0.1',
  };
  const mockRes = {
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (data) {
      this.jsonData = data;
      return this;
    },
  };
  const mockNext = () => {};

  const appError = new AppError(
    'Validation failed',
    400,
    ErrorTypes.VALIDATION
  );

  errorHandler(appError, mockReq, mockRes, mockNext);

  assert.strictEqual(mockRes.statusCode, 400);
  assert.strictEqual(mockRes.jsonData.error.message, 'Validation failed');
  assert.strictEqual(mockRes.jsonData.error.type, ErrorTypes.VALIDATION);
});

test('errorHandler should handle generic Error correctly', () => {
  const mockReq = {
    get: () => 'application/json',
    accepts: () => 'json',
    method: 'GET',
    url: '/test',
    ip: '127.0.0.1',
  };
  const mockRes = {
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (data) {
      this.jsonData = data;
      return this;
    },
  };
  const mockNext = () => {};

  const genericError = new Error('Something went wrong');

  errorHandler(genericError, mockReq, mockRes, mockNext);

  assert.strictEqual(mockRes.statusCode, 500);
  assert.strictEqual(mockRes.jsonData.error.message, 'Something went wrong');
  assert.strictEqual(mockRes.jsonData.error.type, ErrorTypes.INTERNAL);
});
