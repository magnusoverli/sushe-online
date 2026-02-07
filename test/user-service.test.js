const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  createUserService,
  ALLOWED_TIME_FORMATS,
  ALLOWED_DATE_FORMATS,
  ALLOWED_MUSIC_SERVICES,
  HEX_COLOR_REGEX,
} = require('../services/user-service.js');

// =============================================================================
// Helpers
// =============================================================================

function createMockUsers() {
  return {
    update: mock.fn((_query, _update, _opts, cb) => cb(null, 1)),
    findOne: mock.fn((_query, cb) => cb(null, null)),
  };
}

function createMockUsersAsync() {
  return {
    findOne: mock.fn(() => Promise.resolve(null)),
    update: mock.fn(() => Promise.resolve(1)),
  };
}

function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
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
    assert.deepStrictEqual(ALLOWED_MUSIC_SERVICES, ['spotify', 'tidal']);
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
  it('should throw if users is not provided', () => {
    assert.throws(
      () => createUserService({ usersAsync: createMockUsersAsync() }),
      /users \(callback-style\) is required/
    );
  });

  it('should throw if usersAsync is not provided', () => {
    assert.throws(
      () => createUserService({ users: createMockUsers() }),
      /usersAsync is required/
    );
  });

  it('should create service with valid dependencies', () => {
    const service = createUserService({
      users: createMockUsers(),
      usersAsync: createMockUsersAsync(),
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
      users: createMockUsers(),
      usersAsync: createMockUsersAsync(),
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
  it('should call usersAsync.update with correct parameters', async () => {
    const mockUsersAsync = createMockUsersAsync();
    const service = createUserService({
      users: createMockUsers(),
      usersAsync: mockUsersAsync,
      logger: createMockLogger(),
    });

    await service.updateSetting('user123', 'accentColor', '#ff0000');

    assert.strictEqual(mockUsersAsync.update.mock.calls.length, 1);
    const [query, update] = mockUsersAsync.update.mock.calls[0].arguments;
    assert.strictEqual(query._id, 'user123');
    assert.strictEqual(update.$set.accentColor, '#ff0000');
    assert.ok(update.$set.updatedAt instanceof Date);
  });
});

// =============================================================================
// updateUniqueField
// =============================================================================

describe('userService.updateUniqueField', () => {
  let service;
  let mockUsersAsync;

  beforeEach(() => {
    mockUsersAsync = createMockUsersAsync();
    service = createUserService({
      users: createMockUsers(),
      usersAsync: mockUsersAsync,
      logger: createMockLogger(),
    });
  });

  it('should succeed when value is unique', async () => {
    const result = await service.updateUniqueField(
      'user123',
      'email',
      'new@example.com'
    );
    assert.strictEqual(result.success, true);

    // Verify uniqueness check
    assert.strictEqual(mockUsersAsync.findOne.mock.calls.length, 1);
    const query = mockUsersAsync.findOne.mock.calls[0].arguments[0];
    assert.strictEqual(query.email, 'new@example.com');
    assert.deepStrictEqual(query._id, { $ne: 'user123' });

    // Verify update
    assert.strictEqual(mockUsersAsync.update.mock.calls.length, 1);
  });

  it('should fail when email is already taken', async () => {
    mockUsersAsync.findOne = mock.fn(() =>
      Promise.resolve({ _id: 'other', email: 'taken@example.com' })
    );

    const result = await service.updateUniqueField(
      'user123',
      'email',
      'taken@example.com'
    );
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'Email already in use');

    // Should not attempt update
    assert.strictEqual(mockUsersAsync.update.mock.calls.length, 0);
  });

  it('should fail when username is already taken', async () => {
    mockUsersAsync.findOne = mock.fn(() =>
      Promise.resolve({ _id: 'other', username: 'taken' })
    );

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

    const updateArgs = mockUsersAsync.update.mock.calls[0].arguments;
    assert.strictEqual(updateArgs[1].$set.email, 'test@example.com');
  });
});

// =============================================================================
// updateLastSelectedList
// =============================================================================

describe('userService.updateLastSelectedList', () => {
  it('should call usersAsync.update with correct parameters', async () => {
    const mockUsersAsync = createMockUsersAsync();
    const service = createUserService({
      users: createMockUsers(),
      usersAsync: mockUsersAsync,
      logger: createMockLogger(),
    });

    await service.updateLastSelectedList('user123', 'list456');

    assert.strictEqual(mockUsersAsync.update.mock.calls.length, 1);
    const [query, update] = mockUsersAsync.update.mock.calls[0].arguments;
    assert.strictEqual(query._id, 'user123');
    assert.strictEqual(update.$set.lastSelectedList, 'list456');
    assert.ok(update.$set.updatedAt instanceof Date);
  });
});
