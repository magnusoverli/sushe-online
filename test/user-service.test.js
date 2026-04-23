const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  createUserService,
  ALLOWED_TIME_FORMATS,
  ALLOWED_DATE_FORMATS,
  ALLOWED_MUSIC_SERVICES,
  ALLOWED_GRID_COLUMNS,
  HEX_COLOR_REGEX,
} = require('../services/user-service.js');
const { createMockLogger } = require('./helpers');

// =============================================================================
// Helpers
// =============================================================================

function createMockDb(overrides = {}) {
  const raw =
    overrides.raw || mock.fn(() => Promise.resolve({ rows: [], rowCount: 1 }));
  return {
    raw,
    withTransaction:
      overrides.withTransaction ||
      (async (callback) => {
        const client = { query: raw };
        return callback(client);
      }),
  };
}

// =============================================================================
// Constants
// =============================================================================

describe('user-service constants', () => {
  it('should export ALLOWED_TIME_FORMATS', () => {
    assert.deepStrictEqual(ALLOWED_TIME_FORMATS, ['12h', '24h']);
  });

  it('should export ALLOWED_DATE_FORMATS', () => {
    assert.deepStrictEqual(ALLOWED_DATE_FORMATS, ['MM/DD/YYYY', 'DD/MM/YYYY']);
  });

  it('should export ALLOWED_MUSIC_SERVICES', () => {
    assert.deepStrictEqual(ALLOWED_MUSIC_SERVICES, [
      'spotify',
      'tidal',
      'qobuz',
    ]);
  });

  it('should export ALLOWED_GRID_COLUMNS', () => {
    assert.deepStrictEqual(ALLOWED_GRID_COLUMNS, [
      'country',
      'genre_1',
      'genre_2',
      'track',
      'comment',
      'comment_2',
    ]);
  });

  it('should export HEX_COLOR_REGEX that validates hex colors', () => {
    assert.ok(HEX_COLOR_REGEX.test('#dc2626'));
    assert.ok(HEX_COLOR_REGEX.test('#FFFFFF'));
    assert.ok(HEX_COLOR_REGEX.test('#000000'));
    assert.ok(!HEX_COLOR_REGEX.test('dc2626'));
    assert.ok(!HEX_COLOR_REGEX.test('#gggggg'));
    assert.ok(!HEX_COLOR_REGEX.test('#fff'));
  });
});

// =============================================================================
// Factory
// =============================================================================

describe('createUserService', () => {
  it('should throw if db is not provided', () => {
    assert.throws(() => createUserService({}), /UserService requires deps\.db/);
  });

  it('should create service with valid dependencies', () => {
    const service = createUserService({
      db: createMockDb(),
    });
    assert.ok(service.updateSetting);
    assert.ok(service.updateUniqueField);
    assert.ok(service.updateLastSelectedList);
    assert.ok(service.validateSetting);
  });
});

// =============================================================================
// validateSetting
// =============================================================================

describe('userService.validateSetting', () => {
  let service;

  beforeEach(() => {
    service = createUserService({
      db: createMockDb(),
      logger: createMockLogger(),
    });
  });

  // accentColor
  it('should accept valid hex color', () => {
    const result = service.validateSetting('accentColor', '#dc2626');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, '#dc2626');
  });

  it('should reject invalid hex color', () => {
    assert.strictEqual(
      service.validateSetting('accentColor', 'red').valid,
      false
    );
    assert.strictEqual(
      service.validateSetting('accentColor', '#fff').valid,
      false
    );
    assert.strictEqual(service.validateSetting('accentColor', '').valid, false);
  });

  // timeFormat
  it('should accept valid time formats', () => {
    assert.strictEqual(
      service.validateSetting('timeFormat', '12h').valid,
      true
    );
    assert.strictEqual(
      service.validateSetting('timeFormat', '24h').valid,
      true
    );
  });

  it('should reject invalid time format', () => {
    assert.strictEqual(
      service.validateSetting('timeFormat', '48h').valid,
      false
    );
  });

  // dateFormat
  it('should accept valid date formats', () => {
    assert.strictEqual(
      service.validateSetting('dateFormat', 'MM/DD/YYYY').valid,
      true
    );
    assert.strictEqual(
      service.validateSetting('dateFormat', 'DD/MM/YYYY').valid,
      true
    );
  });

  it('should reject invalid date format', () => {
    assert.strictEqual(
      service.validateSetting('dateFormat', 'YYYY-MM-DD').valid,
      false
    );
  });

  // musicService
  it('should accept valid music services', () => {
    assert.strictEqual(
      service.validateSetting('musicService', 'spotify').valid,
      true
    );
    assert.strictEqual(
      service.validateSetting('musicService', 'tidal').valid,
      true
    );
    assert.strictEqual(
      service.validateSetting('musicService', 'qobuz').valid,
      true
    );
  });

  it('should accept null/empty music service (clear preference)', () => {
    const result = service.validateSetting('musicService', '');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, null);

    const result2 = service.validateSetting('musicService', null);
    assert.strictEqual(result2.valid, true);
    assert.strictEqual(result2.value, null);
  });

  it('should reject invalid music service', () => {
    assert.strictEqual(
      service.validateSetting('musicService', 'pandora').valid,
      false
    );
  });

  // Column visibility
  it('should accept valid columnVisibility object', () => {
    const result = service.validateSetting('columnVisibility', {
      country: false,
      genre_1: true,
    });
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.value, { country: false, genre_1: true });
  });

  it('should accept null columnVisibility (reset to default)', () => {
    const result = service.validateSetting('columnVisibility', null);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, null);
  });

  it('should accept empty object columnVisibility', () => {
    const result = service.validateSetting('columnVisibility', {});
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.value, {});
  });

  it('should accept all toggleable columns hidden', () => {
    const result = service.validateSetting('columnVisibility', {
      country: false,
      genre_1: false,
      genre_2: false,
      track: false,
      comment: false,
      comment_2: false,
    });
    assert.strictEqual(result.valid, true);
  });

  it('should reject columnVisibility with unknown column key', () => {
    const result = service.validateSetting('columnVisibility', {
      unknown_col: false,
    });
    assert.strictEqual(result.valid, false);
    assert.match(result.error, /Unknown column/);
  });

  it('should reject columnVisibility with non-boolean values', () => {
    const result = service.validateSetting('columnVisibility', {
      country: 'hidden',
    });
    assert.strictEqual(result.valid, false);
    assert.match(result.error, /booleans/);
  });

  it('should reject array as columnVisibility', () => {
    const result = service.validateSetting('columnVisibility', ['country']);
    assert.strictEqual(result.valid, false);
  });

  it('should reject string as columnVisibility', () => {
    const result = service.validateSetting('columnVisibility', 'country');
    assert.strictEqual(result.valid, false);
  });

  // Unknown field
  it('should reject unknown setting field', () => {
    const result = service.validateSetting('unknownField', 'value');
    assert.strictEqual(result.valid, false);
    assert.match(result.error, /Unknown setting/);
  });
});

// =============================================================================
// updateSetting
// =============================================================================

describe('userService.updateSetting', () => {
  it('should call db.raw with correct parameters', async () => {
    const mockDb = createMockDb();
    const invalidateUserCache = mock.fn();
    const service = createUserService({
      db: mockDb,
      logger: createMockLogger(),
      invalidateUserCache,
    });

    await service.updateSetting('user123', 'accentColor', '#ff0000');

    assert.strictEqual(mockDb.raw.mock.calls.length, 1);
    const [sql, params] = mockDb.raw.mock.calls[0].arguments;
    assert.match(sql, /UPDATE users SET accent_color/);
    assert.strictEqual(params[0], '#ff0000');
    assert.ok(params[1] instanceof Date);
    assert.strictEqual(params[2], 'user123');
    assert.strictEqual(invalidateUserCache.mock.calls.length, 1);
    assert.strictEqual(
      invalidateUserCache.mock.calls[0].arguments[0],
      'user123'
    );
  });
});

// =============================================================================
// updateUniqueField
// =============================================================================

describe('userService.updateUniqueField', () => {
  let service;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb({
      raw: mock.fn((sql) => {
        if (sql.includes('SELECT _id FROM users')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
    });
    service = createUserService({
      db: mockDb,
      logger: createMockLogger(),
    });
  });

  it('should succeed when value is unique', async () => {
    const invalidateUserCache = mock.fn();
    service = createUserService({
      db: mockDb,
      logger: createMockLogger(),
      invalidateUserCache,
    });

    const result = await service.updateUniqueField(
      'user123',
      'email',
      'new@example.com'
    );
    assert.strictEqual(result.success, true);

    assert.strictEqual(mockDb.raw.mock.calls.length, 2);
    const [checkSql, checkParams] = mockDb.raw.mock.calls[0].arguments;
    assert.match(checkSql, /SELECT _id FROM users/);
    assert.strictEqual(checkParams[0], 'new@example.com');
    assert.strictEqual(checkParams[1], 'user123');

    const [updateSql] = mockDb.raw.mock.calls[1].arguments;
    assert.match(updateSql, /UPDATE users SET email/);
    assert.strictEqual(invalidateUserCache.mock.calls.length, 1);
    assert.strictEqual(
      invalidateUserCache.mock.calls[0].arguments[0],
      'user123'
    );
  });

  it('should fail when email is already taken', async () => {
    mockDb.raw = mock.fn((sql) => {
      if (sql.includes('SELECT _id FROM users')) {
        return Promise.resolve({ rows: [{ _id: 'other' }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    service = createUserService({ db: mockDb, logger: createMockLogger() });

    const result = await service.updateUniqueField(
      'user123',
      'email',
      'taken@example.com'
    );
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'Email already in use');

    // Should not attempt update
    assert.strictEqual(mockDb.raw.mock.calls.length, 1);
  });

  it('should fail when username is already taken', async () => {
    mockDb.raw = mock.fn((sql) => {
      if (sql.includes('SELECT _id FROM users')) {
        return Promise.resolve({ rows: [{ _id: 'other' }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    service = createUserService({ db: mockDb, logger: createMockLogger() });

    const result = await service.updateUniqueField(
      'user123',
      'username',
      'taken'
    );
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'Username already taken');
  });

  it('should trim whitespace from value', async () => {
    const result = await service.updateUniqueField(
      'user123',
      'email',
      '  test@example.com  '
    );
    assert.strictEqual(result.success, true);

    const [, updateParams] = mockDb.raw.mock.calls[1].arguments;
    assert.strictEqual(updateParams[0], 'test@example.com');
  });
});

// =============================================================================
// updateLastSelectedList
// =============================================================================

describe('userService.updateLastSelectedList', () => {
  it('should call db.raw with correct parameters', async () => {
    const mockDb = createMockDb();
    const invalidateUserCache = mock.fn();
    const service = createUserService({
      db: mockDb,
      logger: createMockLogger(),
      invalidateUserCache,
    });

    await service.updateLastSelectedList('user123', 'list456');

    assert.strictEqual(mockDb.raw.mock.calls.length, 1);
    const [sql, params] = mockDb.raw.mock.calls[0].arguments;
    assert.match(sql, /UPDATE users SET last_selected_list/);
    assert.strictEqual(params[0], 'list456');
    assert.ok(params[1] instanceof Date);
    assert.strictEqual(params[2], 'user123');
    assert.strictEqual(invalidateUserCache.mock.calls.length, 1);
    assert.strictEqual(
      invalidateUserCache.mock.calls[0].arguments[0],
      'user123'
    );
  });
});
