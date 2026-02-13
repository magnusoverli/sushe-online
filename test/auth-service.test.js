const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  createAuthService,
  BCRYPT_SALT_ROUNDS,
  SESSION_DEFAULT_MS,
  SESSION_REMEMBER_MS,
  EXTENSION_TOKEN_EXPIRY_MS,
  USER_DEFAULTS,
} = require('../services/auth-service.js');
const { createMockLogger } = require('./helpers');

// =============================================================================
// Helpers
// =============================================================================

function createMockUsersAsync() {
  return {
    findOne: mock.fn(() => Promise.resolve(null)),
    insert: mock.fn((data) => Promise.resolve({ _id: 'user123', ...data })),
    update: mock.fn(() => Promise.resolve(1)),
  };
}

function createMockBcrypt() {
  return {
    hash: mock.fn(() => Promise.resolve('hashed_password')),
    compare: mock.fn(() => Promise.resolve(true)),
  };
}

function createValidators() {
  return {
    isValidEmail: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    isValidUsername: (u) =>
      typeof u === 'string' &&
      u.length >= 3 &&
      u.length <= 30 &&
      /^[a-zA-Z0-9_]+$/.test(u),
    isValidPassword: (p) => typeof p === 'string' && p.length >= 8,
  };
}

// =============================================================================
// Constants
// =============================================================================

describe('auth-service constants', () => {
  it('should export BCRYPT_SALT_ROUNDS as 12', () => {
    assert.strictEqual(BCRYPT_SALT_ROUNDS, 12);
  });

  it('should export SESSION_DEFAULT_MS as 1 day', () => {
    assert.strictEqual(SESSION_DEFAULT_MS, 24 * 60 * 60 * 1000);
  });

  it('should export SESSION_REMEMBER_MS as 30 days', () => {
    assert.strictEqual(SESSION_REMEMBER_MS, 30 * 24 * 60 * 60 * 1000);
  });

  it('should export EXTENSION_TOKEN_EXPIRY_MS as 90 days', () => {
    assert.strictEqual(EXTENSION_TOKEN_EXPIRY_MS, 90 * 24 * 60 * 60 * 1000);
  });

  it('should export USER_DEFAULTS with expected shape', () => {
    assert.strictEqual(USER_DEFAULTS.accentColor, '#dc2626');
    assert.strictEqual(USER_DEFAULTS.timeFormat, '24h');
    assert.strictEqual(USER_DEFAULTS.dateFormat, 'MM/DD/YYYY');
    assert.strictEqual(USER_DEFAULTS.approvalStatus, 'pending');
    assert.strictEqual(USER_DEFAULTS.spotifyAuth, null);
    assert.strictEqual(USER_DEFAULTS.tidalAuth, null);
    assert.strictEqual(USER_DEFAULTS.tidalCountry, null);
  });
});

// =============================================================================
// Factory
// =============================================================================

describe('createAuthService', () => {
  it('should throw if usersAsync is not provided', () => {
    assert.throws(() => createAuthService({}), /usersAsync is required/);
  });

  it('should create service with valid dependencies', () => {
    const service = createAuthService({
      usersAsync: createMockUsersAsync(),
    });
    assert.ok(service.registerUser);
    assert.ok(service.createApprovalEvent);
    assert.ok(service.changePassword);
    assert.ok(service.validateAdminCode);
    assert.ok(service.finalizeAdminCodeUsage);
    assert.ok(service.getSessionMaxAge);
  });
});

// =============================================================================
// registerUser
// =============================================================================

describe('authService.registerUser', () => {
  let service;
  let mockUsersAsync;
  let mockBcrypt;
  let validators;

  beforeEach(() => {
    mockUsersAsync = createMockUsersAsync();
    mockBcrypt = createMockBcrypt();
    validators = createValidators();
    service = createAuthService({
      usersAsync: mockUsersAsync,
      bcrypt: mockBcrypt,
      logger: createMockLogger(),
    });
  });

  it('should reject when fields are missing', async () => {
    const { user, validation } = await service.registerUser(
      { email: '', username: '', password: '', confirmPassword: '' },
      validators
    );
    assert.strictEqual(user, null);
    assert.strictEqual(validation.valid, false);
    assert.strictEqual(validation.error, 'All fields are required');
  });

  it('should reject when passwords do not match', async () => {
    const { user, validation } = await service.registerUser(
      {
        email: 'test@example.com',
        username: 'testuser',
        password: 'password123',
        confirmPassword: 'different',
      },
      validators
    );
    assert.strictEqual(user, null);
    assert.strictEqual(validation.error, 'Passwords do not match');
  });

  it('should reject invalid email format', async () => {
    const { user, validation } = await service.registerUser(
      {
        email: 'not-an-email',
        username: 'testuser',
        password: 'password123',
        confirmPassword: 'password123',
      },
      validators
    );
    assert.strictEqual(user, null);
    assert.match(validation.error, /valid email/);
  });

  it('should reject invalid username format', async () => {
    const { user, validation } = await service.registerUser(
      {
        email: 'test@example.com',
        username: 'ab',
        password: 'password123',
        confirmPassword: 'password123',
      },
      validators
    );
    assert.strictEqual(user, null);
    assert.match(validation.error, /letters, numbers/);
  });

  it('should reject weak password', async () => {
    const { user, validation } = await service.registerUser(
      {
        email: 'test@example.com',
        username: 'testuser',
        password: 'short',
        confirmPassword: 'short',
      },
      validators
    );
    assert.strictEqual(user, null);
    assert.match(validation.error, /at least 8/);
  });

  it('should reject duplicate email', async () => {
    mockUsersAsync.findOne = mock.fn(async (query) => {
      if (query.email) return { _id: 'existing', email: query.email };
      return null;
    });

    const { user, validation } = await service.registerUser(
      {
        email: 'taken@example.com',
        username: 'testuser',
        password: 'password123',
        confirmPassword: 'password123',
      },
      validators
    );
    assert.strictEqual(user, null);
    assert.strictEqual(validation.error, 'Email already registered');
  });

  it('should reject duplicate username', async () => {
    mockUsersAsync.findOne = mock.fn(async (query) => {
      if (query.username) return { _id: 'existing', username: query.username };
      return null;
    });

    const { user, validation } = await service.registerUser(
      {
        email: 'test@example.com',
        username: 'taken_user',
        password: 'password123',
        confirmPassword: 'password123',
      },
      validators
    );
    assert.strictEqual(user, null);
    assert.strictEqual(validation.error, 'Username already taken');
  });

  it('should successfully register a valid user', async () => {
    const { user, validation } = await service.registerUser(
      {
        email: 'new@example.com',
        username: 'newuser',
        password: 'password123',
        confirmPassword: 'password123',
      },
      validators
    );

    assert.strictEqual(validation.valid, true);
    assert.ok(user);
    assert.strictEqual(user.email, 'new@example.com');
    assert.strictEqual(user.username, 'newuser');

    // Verify bcrypt was called with correct salt rounds
    assert.strictEqual(mockBcrypt.hash.mock.calls.length, 1);
    assert.strictEqual(mockBcrypt.hash.mock.calls[0].arguments[1], 12);

    // Verify user was inserted with defaults
    assert.strictEqual(mockUsersAsync.insert.mock.calls.length, 1);
    const insertedData = mockUsersAsync.insert.mock.calls[0].arguments[0];
    assert.strictEqual(insertedData.accentColor, '#dc2626');
    assert.strictEqual(insertedData.timeFormat, '24h');
    assert.strictEqual(insertedData.dateFormat, 'MM/DD/YYYY');
    assert.strictEqual(insertedData.approvalStatus, 'pending');
  });
});

// =============================================================================
// createApprovalEvent
// =============================================================================

describe('authService.createApprovalEvent', () => {
  let service;
  let mockLogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    service = createAuthService({
      usersAsync: createMockUsersAsync(),
      logger: mockLogger,
    });
  });

  it('should warn when adminEventService is not available', async () => {
    await service.createApprovalEvent(null, { username: 'u', email: 'e' });
    assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
  });

  it('should call createEvent with correct parameters', async () => {
    const mockService = { createEvent: mock.fn(() => Promise.resolve()) };
    const user = {
      _id: 'id1',
      username: 'testuser',
      email: 'test@example.com',
    };

    await service.createApprovalEvent(mockService, user);

    assert.strictEqual(mockService.createEvent.mock.calls.length, 1);
    const event = mockService.createEvent.mock.calls[0].arguments[0];
    assert.strictEqual(event.type, 'account_approval');
    assert.strictEqual(event.data.userId, 'id1');
    assert.strictEqual(event.data.username, 'testuser');
    assert.strictEqual(event.actions.length, 2);
  });

  it('should not throw when createEvent fails', async () => {
    const mockService = {
      createEvent: mock.fn(() => Promise.reject(new Error('fail'))),
    };

    // Should not throw
    await service.createApprovalEvent(mockService, {
      _id: 'id',
      username: 'u',
      email: 'e',
    });
    assert.strictEqual(mockLogger.error.mock.calls.length, 1);
  });
});

// =============================================================================
// changePassword
// =============================================================================

describe('authService.changePassword', () => {
  let service;
  let mockBcrypt;
  const isValidPassword = (p) => typeof p === 'string' && p.length >= 8;

  beforeEach(() => {
    mockBcrypt = createMockBcrypt();
    service = createAuthService({
      usersAsync: createMockUsersAsync(),
      bcrypt: mockBcrypt,
      logger: createMockLogger(),
    });
  });

  it('should reject when fields are missing', async () => {
    const result = await service.changePassword(
      'uid',
      'hash',
      { currentPassword: '', newPassword: '', confirmPassword: '' },
      isValidPassword
    );
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'All fields are required');
  });

  it('should reject when new passwords do not match', async () => {
    const result = await service.changePassword(
      'uid',
      'hash',
      {
        currentPassword: 'oldpass12',
        newPassword: 'newpass12',
        confirmPassword: 'different',
      },
      isValidPassword
    );
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'New passwords do not match');
  });

  it('should reject weak new password', async () => {
    const result = await service.changePassword(
      'uid',
      'hash',
      {
        currentPassword: 'oldpass12',
        newPassword: 'short',
        confirmPassword: 'short',
      },
      isValidPassword
    );
    assert.strictEqual(result.success, false);
    assert.match(result.error, /at least 8/);
  });

  it('should reject incorrect current password', async () => {
    mockBcrypt.compare = mock.fn(() => Promise.resolve(false));

    const result = await service.changePassword(
      'uid',
      'hash',
      {
        currentPassword: 'wrongpass',
        newPassword: 'newpass12',
        confirmPassword: 'newpass12',
      },
      isValidPassword
    );
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'Current password is incorrect');
  });

  it('should succeed with valid input', async () => {
    const result = await service.changePassword(
      'uid',
      'hash',
      {
        currentPassword: 'oldpass12',
        newPassword: 'newpass12',
        confirmPassword: 'newpass12',
      },
      isValidPassword
    );
    assert.strictEqual(result.success, true);
    assert.ok(result.newHash);
    assert.strictEqual(mockBcrypt.hash.mock.calls.length, 1);
    assert.strictEqual(mockBcrypt.hash.mock.calls[0].arguments[1], 12);
  });
});

// =============================================================================
// validateAdminCode
// =============================================================================

describe('authService.validateAdminCode', () => {
  let service;

  beforeEach(() => {
    service = createAuthService({
      usersAsync: createMockUsersAsync(),
      logger: createMockLogger(),
    });
  });

  it('should reject null code', () => {
    const state = {
      adminCode: 'ABC123',
      adminCodeExpiry: new Date(Date.now() + 60000),
    };
    const result = service.validateAdminCode(null, 'uid', state);
    assert.strictEqual(result.valid, false);
  });

  it('should reject wrong code', () => {
    const state = {
      adminCode: 'ABC123',
      adminCodeExpiry: new Date(Date.now() + 60000),
    };
    const result = service.validateAdminCode('WRONG1', 'uid', state);
    assert.strictEqual(result.valid, false);
    assert.match(result.error, /Invalid or expired/);
  });

  it('should reject expired code', () => {
    const state = {
      adminCode: 'ABC123',
      adminCodeExpiry: new Date(Date.now() - 1000), // expired
    };
    const result = service.validateAdminCode('ABC123', 'uid', state);
    assert.strictEqual(result.valid, false);
  });

  it('should accept valid non-expired code (case-insensitive)', () => {
    const state = {
      adminCode: 'ABC123',
      adminCodeExpiry: new Date(Date.now() + 60000),
    };
    const result = service.validateAdminCode('abc123', 'uid', state);
    assert.strictEqual(result.valid, true);
  });
});

// =============================================================================
// finalizeAdminCodeUsage
// =============================================================================

describe('authService.finalizeAdminCodeUsage', () => {
  it('should track usage and regenerate code', () => {
    const service = createAuthService({
      usersAsync: createMockUsersAsync(),
      logger: createMockLogger(),
    });

    const state = {
      lastCodeUsedBy: null,
      lastCodeUsedAt: null,
      generateAdminCode: mock.fn(),
    };

    service.finalizeAdminCodeUsage(state, 'admin@test.com');

    assert.strictEqual(state.lastCodeUsedBy, 'admin@test.com');
    assert.ok(state.lastCodeUsedAt);
    assert.strictEqual(state.generateAdminCode.mock.calls.length, 1);
  });
});

// =============================================================================
// getSessionMaxAge
// =============================================================================

describe('authService.getSessionMaxAge', () => {
  let service;

  beforeEach(() => {
    service = createAuthService({
      usersAsync: createMockUsersAsync(),
      logger: createMockLogger(),
    });
  });

  it('should return default for falsy remember value', () => {
    assert.strictEqual(service.getSessionMaxAge(false), SESSION_DEFAULT_MS);
    assert.strictEqual(service.getSessionMaxAge(null), SESSION_DEFAULT_MS);
    assert.strictEqual(service.getSessionMaxAge(undefined), SESSION_DEFAULT_MS);
    assert.strictEqual(service.getSessionMaxAge('off'), SESSION_DEFAULT_MS);
  });

  it('should return remember duration for "on"', () => {
    assert.strictEqual(service.getSessionMaxAge('on'), SESSION_REMEMBER_MS);
  });

  it('should return remember duration for "true" (string)', () => {
    assert.strictEqual(service.getSessionMaxAge('true'), SESSION_REMEMBER_MS);
  });

  it('should return remember duration for true (boolean)', () => {
    assert.strictEqual(service.getSessionMaxAge(true), SESSION_REMEMBER_MS);
  });
});
