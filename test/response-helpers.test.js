const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  success,
  error,
  notFound,
  validationError,
} = require('../utils/response-helpers');

/**
 * Create a mock Express response object
 */
function createMockRes() {
  const res = {
    _status: 200,
    _json: null,
    status(code) {
      res._status = code;
      return res;
    },
    json(data) {
      res._json = data;
      return res;
    },
  };
  return res;
}

// =============================================================================
// success() tests
// =============================================================================

describe('success', () => {
  it('should send success response with default data', () => {
    const res = createMockRes();
    success(res);
    assert.deepStrictEqual(res._json, { success: true });
  });

  it('should merge data with success flag', () => {
    const res = createMockRes();
    success(res, { items: [1, 2, 3] });
    assert.deepStrictEqual(res._json, { success: true, items: [1, 2, 3] });
  });

  it('should allow data to override success flag', () => {
    const res = createMockRes();
    success(res, { success: false, reason: 'custom' });
    assert.deepStrictEqual(res._json, { success: false, reason: 'custom' });
  });

  it('should handle complex nested data', () => {
    const res = createMockRes();
    success(res, {
      list: { id: '123', name: 'Test' },
      count: 5,
    });
    assert.deepStrictEqual(res._json, {
      success: true,
      list: { id: '123', name: 'Test' },
      count: 5,
    });
  });

  it('should not set a status code (uses Express default 200)', () => {
    const res = createMockRes();
    success(res, { data: 'test' });
    assert.strictEqual(res._status, 200);
  });
});

// =============================================================================
// error() tests
// =============================================================================

describe('error', () => {
  it('should send error with default 400 status', () => {
    const res = createMockRes();
    error(res, 'Bad request');
    assert.strictEqual(res._status, 400);
    assert.deepStrictEqual(res._json, { error: 'Bad request' });
  });

  it('should use custom status code', () => {
    const res = createMockRes();
    error(res, 'Server error', 500);
    assert.strictEqual(res._status, 500);
    assert.deepStrictEqual(res._json, { error: 'Server error' });
  });

  it('should include extra context', () => {
    const res = createMockRes();
    error(res, 'Auth expired', 401, {
      code: 'TOKEN_EXPIRED',
      service: 'spotify',
    });
    assert.strictEqual(res._status, 401);
    assert.deepStrictEqual(res._json, {
      error: 'Auth expired',
      code: 'TOKEN_EXPIRED',
      service: 'spotify',
    });
  });

  it('should handle empty extra object', () => {
    const res = createMockRes();
    error(res, 'Not allowed', 403, {});
    assert.strictEqual(res._status, 403);
    assert.deepStrictEqual(res._json, { error: 'Not allowed' });
  });
});

// =============================================================================
// notFound() tests
// =============================================================================

describe('notFound', () => {
  it('should send 404 with default resource name', () => {
    const res = createMockRes();
    notFound(res);
    assert.strictEqual(res._status, 404);
    assert.deepStrictEqual(res._json, { error: 'Resource not found' });
  });

  it('should use custom resource name', () => {
    const res = createMockRes();
    notFound(res, 'Album');
    assert.strictEqual(res._status, 404);
    assert.deepStrictEqual(res._json, { error: 'Album not found' });
  });

  it('should use custom resource name for List', () => {
    const res = createMockRes();
    notFound(res, 'List');
    assert.strictEqual(res._status, 404);
    assert.deepStrictEqual(res._json, { error: 'List not found' });
  });
});

// =============================================================================
// validationError() tests
// =============================================================================

describe('validationError', () => {
  it('should handle single error string', () => {
    const res = createMockRes();
    validationError(res, 'Name is required');
    assert.strictEqual(res._status, 400);
    assert.deepStrictEqual(res._json, {
      error: 'Name is required',
      validation_errors: ['Name is required'],
    });
  });

  it('should handle array of errors', () => {
    const res = createMockRes();
    validationError(res, ['Name is required', 'Year is invalid']);
    assert.strictEqual(res._status, 400);
    assert.deepStrictEqual(res._json, {
      error: 'Name is required, Year is invalid',
      validation_errors: ['Name is required', 'Year is invalid'],
    });
  });

  it('should handle single-element array', () => {
    const res = createMockRes();
    validationError(res, ['Email is invalid']);
    assert.strictEqual(res._status, 400);
    assert.deepStrictEqual(res._json, {
      error: 'Email is invalid',
      validation_errors: ['Email is invalid'],
    });
  });

  it('should handle empty array', () => {
    const res = createMockRes();
    validationError(res, []);
    assert.strictEqual(res._status, 400);
    assert.deepStrictEqual(res._json, {
      error: '',
      validation_errors: [],
    });
  });
});
