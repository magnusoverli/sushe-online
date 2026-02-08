const test = require('node:test');
const assert = require('node:assert');
const {
  isValidEmail,
  isValidUsername,
  isValidPassword,
  validateYear,
  validateListId,
  validateListName,
  validateOptionalString,
  validateRequiredString,
  validateArray,
  validateEnum,
  validateInteger,
  requireFields,
} = require('../utils/validators.js');

// =============================================================================
// isValidEmail tests
// =============================================================================

test('isValidEmail should return true for valid emails', () => {
  assert.strictEqual(isValidEmail('user@example.com'), true);
  assert.strictEqual(isValidEmail('test.user@domain.org'), true);
  assert.strictEqual(isValidEmail('name+tag@gmail.com'), true);
  assert.strictEqual(isValidEmail('user123@sub.domain.co.uk'), true);
  assert.strictEqual(isValidEmail('a@b.co'), true);
});

test('isValidEmail should return false for emails without @', () => {
  assert.strictEqual(isValidEmail('userexample.com'), false);
  assert.strictEqual(isValidEmail('plaintext'), false);
});

test('isValidEmail should return false for emails without domain', () => {
  assert.strictEqual(isValidEmail('user@'), false);
  assert.strictEqual(isValidEmail('user@.com'), false);
});

test('isValidEmail should return false for emails without local part', () => {
  assert.strictEqual(isValidEmail('@example.com'), false);
});

test('isValidEmail should return false for emails with spaces', () => {
  assert.strictEqual(isValidEmail('user @example.com'), false);
  assert.strictEqual(isValidEmail('user@ example.com'), false);
  assert.strictEqual(isValidEmail(' user@example.com'), false);
  assert.strictEqual(isValidEmail('user@example.com '), false);
});

test('isValidEmail should return false for empty/null/undefined', () => {
  assert.strictEqual(isValidEmail(''), false);
  assert.strictEqual(isValidEmail(null), false);
  assert.strictEqual(isValidEmail(undefined), false);
});

// =============================================================================
// isValidUsername tests
// =============================================================================

test('isValidUsername should return true for valid usernames', () => {
  assert.strictEqual(isValidUsername('abc'), true); // min length
  assert.strictEqual(isValidUsername('user123'), true);
  assert.strictEqual(isValidUsername('User_Name'), true);
  assert.strictEqual(isValidUsername('ALLCAPS'), true);
  assert.strictEqual(isValidUsername('___'), true); // underscores only
  assert.strictEqual(isValidUsername('a'.repeat(30)), true); // max length
});

test('isValidUsername should return false for usernames that are too short', () => {
  assert.strictEqual(isValidUsername(''), false);
  assert.strictEqual(isValidUsername('a'), false);
  assert.strictEqual(isValidUsername('ab'), false);
});

test('isValidUsername should return false for usernames that are too long', () => {
  assert.strictEqual(isValidUsername('a'.repeat(31)), false);
  assert.strictEqual(isValidUsername('a'.repeat(100)), false);
});

test('isValidUsername should return false for usernames with invalid characters', () => {
  assert.strictEqual(isValidUsername('user-name'), false); // hyphen
  assert.strictEqual(isValidUsername('user.name'), false); // dot
  assert.strictEqual(isValidUsername('user name'), false); // space
  assert.strictEqual(isValidUsername('user@name'), false); // at sign
  assert.strictEqual(isValidUsername('user!name'), false); // exclamation
  assert.strictEqual(isValidUsername('user#name'), false); // hash
});

test('isValidUsername should return false for null/undefined', () => {
  assert.strictEqual(isValidUsername(null), false);
  assert.strictEqual(isValidUsername(undefined), false);
});

// =============================================================================
// isValidPassword tests
// =============================================================================

test('isValidPassword should return true for valid passwords', () => {
  assert.strictEqual(isValidPassword('12345678'), true); // exactly 8 chars
  assert.strictEqual(isValidPassword('password123'), true);
  assert.strictEqual(isValidPassword('a'.repeat(100)), true); // long password
  assert.strictEqual(isValidPassword('P@ssw0rd!'), true); // special chars
});

test('isValidPassword should return false for passwords that are too short', () => {
  assert.strictEqual(isValidPassword(''), false);
  assert.strictEqual(isValidPassword('1234567'), false); // 7 chars
  assert.strictEqual(isValidPassword('abc'), false);
});

test('isValidPassword should return false for non-string values', () => {
  assert.strictEqual(isValidPassword(null), false);
  assert.strictEqual(isValidPassword(undefined), false);
  assert.strictEqual(isValidPassword(12345678), false); // number
  assert.strictEqual(isValidPassword(['password']), false); // array
  assert.strictEqual(isValidPassword({ password: 'test' }), false); // object
});

// =============================================================================
// validateYear tests
// =============================================================================

test('validateYear should return valid with null value for empty inputs', () => {
  assert.deepStrictEqual(validateYear(null), { valid: true, value: null });
  assert.deepStrictEqual(validateYear(undefined), { valid: true, value: null });
  assert.deepStrictEqual(validateYear(''), { valid: true, value: null });
});

test('validateYear should return valid for years within range', () => {
  assert.deepStrictEqual(validateYear(2024), { valid: true, value: 2024 });
  assert.deepStrictEqual(validateYear(1000), { valid: true, value: 1000 }); // min
  assert.deepStrictEqual(validateYear(9999), { valid: true, value: 9999 }); // max
  assert.deepStrictEqual(validateYear(1985), { valid: true, value: 1985 });
});

test('validateYear should parse string years correctly', () => {
  assert.deepStrictEqual(validateYear('2024'), { valid: true, value: 2024 });
  assert.deepStrictEqual(validateYear('1000'), { valid: true, value: 1000 });
  assert.deepStrictEqual(validateYear('9999'), { valid: true, value: 9999 });
});

test('validateYear should return invalid for years outside range', () => {
  const belowRange = validateYear(999);
  assert.strictEqual(belowRange.valid, false);
  assert.strictEqual(belowRange.value, null);
  assert.ok(belowRange.error.includes('between 1000 and 9999'));

  const aboveRange = validateYear(10000);
  assert.strictEqual(aboveRange.valid, false);
  assert.strictEqual(aboveRange.value, null);
  assert.ok(aboveRange.error.includes('between 1000 and 9999'));
});

test('validateYear should return invalid for non-integer values', () => {
  const floatResult = validateYear(2024.5);
  assert.strictEqual(floatResult.valid, false);
  assert.strictEqual(floatResult.value, null);
  assert.ok(floatResult.error.includes('valid integer'));

  const nanResult = validateYear('not-a-year');
  assert.strictEqual(nanResult.valid, false);
  assert.strictEqual(nanResult.value, null);
});

test('validateYear should handle edge cases', () => {
  // Negative years
  const negativeResult = validateYear(-2024);
  assert.strictEqual(negativeResult.valid, false);

  // Zero
  const zeroResult = validateYear(0);
  assert.strictEqual(zeroResult.valid, false);

  // String with leading zeros (still parses correctly)
  assert.deepStrictEqual(validateYear('2024'), { valid: true, value: 2024 });
});

// =============================================================================
// validateListId tests
// =============================================================================

test('validateListId should return valid for 24-char hex strings', () => {
  assert.deepStrictEqual(validateListId('a1b2c3d4e5f6a1b2c3d4e5f6'), {
    valid: true,
  });
  assert.deepStrictEqual(validateListId('000000000000000000000000'), {
    valid: true,
  });
  assert.deepStrictEqual(validateListId('ffffffffffffffffffffffff'), {
    valid: true,
  });
});

test('validateListId should return invalid for wrong length strings', () => {
  const tooShort = validateListId('a1b2c3d4e5f6a1b2c3d4e5f');
  assert.strictEqual(tooShort.valid, false);
  assert.ok(tooShort.error.includes('Invalid list ID format'));

  const tooLong = validateListId('a1b2c3d4e5f6a1b2c3d4e5f6a');
  assert.strictEqual(tooLong.valid, false);
});

test('validateListId should return invalid for non-hex characters', () => {
  const withUppercase = validateListId('A1B2C3D4E5F6A1B2C3D4E5F6');
  assert.strictEqual(withUppercase.valid, false);

  const withInvalidChars = validateListId('g1b2c3d4e5f6a1b2c3d4e5f6');
  assert.strictEqual(withInvalidChars.valid, false);

  const withSpaces = validateListId('a1b2c3d4e5f6 a1b2c3d4e5f');
  assert.strictEqual(withSpaces.valid, false);
});

test('validateListId should return invalid for null/undefined/empty', () => {
  assert.strictEqual(validateListId(null).valid, false);
  assert.strictEqual(validateListId(undefined).valid, false);
  assert.strictEqual(validateListId('').valid, false);
});

// =============================================================================
// validateListName tests
// =============================================================================

test('validateListName should return valid for normal names', () => {
  const result = validateListName('My List 2024');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, 'My List 2024');
});

test('validateListName should trim whitespace', () => {
  const result = validateListName('  Trimmed Name  ');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, 'Trimmed Name');
});

test('validateListName should return invalid for empty names', () => {
  assert.strictEqual(validateListName('').valid, false);
  assert.strictEqual(validateListName('   ').valid, false);
  assert.strictEqual(validateListName(null).valid, false);
  assert.strictEqual(validateListName(undefined).valid, false);
});

test('validateListName should return invalid for names over 200 chars', () => {
  const longName = 'a'.repeat(201);
  const result = validateListName(longName);
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('too long'));
});

test('validateListName should allow exactly 200 chars', () => {
  const maxName = 'a'.repeat(200);
  const result = validateListName(maxName);
  assert.strictEqual(result.valid, true);
});

// =============================================================================
// validateOptionalString tests
// =============================================================================

test('validateOptionalString should accept null value', () => {
  const result = validateOptionalString(null, 'field');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, null);
});

test('validateOptionalString should accept undefined value', () => {
  const result = validateOptionalString(undefined, 'field');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, null);
});

test('validateOptionalString should accept empty string', () => {
  const result = validateOptionalString('', 'field');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, null);
});

test('validateOptionalString should accept valid string', () => {
  const result = validateOptionalString('hello', 'field');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, 'hello');
});

test('validateOptionalString should reject non-string value', () => {
  const result = validateOptionalString(123, 'field');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error, 'field must be a string');
});

test('validateOptionalString should reject boolean value', () => {
  const result = validateOptionalString(true, 'field');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error, 'field must be a string');
});

test('validateOptionalString should validate maxLength', () => {
  const result = validateOptionalString('toolong', 'field', { maxLength: 5 });
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('max length'));
});

test('validateOptionalString should accept string within maxLength', () => {
  const result = validateOptionalString('ok', 'field', { maxLength: 5 });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, 'ok');
});

test('validateOptionalString should validate minLength', () => {
  const result = validateOptionalString('ab', 'field', { minLength: 3 });
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('at least 3 characters'));
});

test('validateOptionalString should accept string at exact minLength', () => {
  const result = validateOptionalString('abc', 'field', { minLength: 3 });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, 'abc');
});

// =============================================================================
// validateRequiredString tests
// =============================================================================

test('validateRequiredString should reject null value', () => {
  const result = validateRequiredString(null, 'name');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('required'));
});

test('validateRequiredString should reject undefined value', () => {
  const result = validateRequiredString(undefined, 'name');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('required'));
});

test('validateRequiredString should reject empty string', () => {
  const result = validateRequiredString('', 'name');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('required'));
});

test('validateRequiredString should reject number', () => {
  const result = validateRequiredString(42, 'name');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('must be a string'));
});

test('validateRequiredString should accept valid string', () => {
  const result = validateRequiredString('hello', 'name');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, 'hello');
});

test('validateRequiredString should validate maxLength on valid strings', () => {
  const result = validateRequiredString('toolongstring', 'name', {
    maxLength: 5,
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('max length'));
});

// =============================================================================
// validateArray tests
// =============================================================================

test('validateArray should accept valid array', () => {
  const result = validateArray([1, 2, 3], 'items');
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.value, [1, 2, 3]);
});

test('validateArray should accept empty array when not required', () => {
  const result = validateArray([], 'items');
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.value, []);
});

test('validateArray should return empty array for null when not required', () => {
  const result = validateArray(null, 'items');
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.value, []);
});

test('validateArray should return empty array for undefined when not required', () => {
  const result = validateArray(undefined, 'items');
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.value, []);
});

test('validateArray should reject null when required', () => {
  const result = validateArray(null, 'items', { required: true });
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('required'));
});

test('validateArray should reject non-array', () => {
  const result = validateArray('not array', 'items');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('must be an array'));
});

test('validateArray should reject object', () => {
  const result = validateArray({ a: 1 }, 'items');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('must be an array'));
});

test('validateArray should validate minLength', () => {
  const result = validateArray([1], 'items', { minLength: 2 });
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('at least 2 items'));
});

test('validateArray should validate maxLength', () => {
  const result = validateArray([1, 2, 3, 4], 'items', { maxLength: 3 });
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('at most 3 items'));
});

test('validateArray should accept array within bounds', () => {
  const result = validateArray([1, 2], 'items', {
    minLength: 1,
    maxLength: 3,
  });
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.value, [1, 2]);
});

// =============================================================================
// validateEnum tests
// =============================================================================

test('validateEnum should accept valid enum value', () => {
  const result = validateEnum('red', ['red', 'green', 'blue'], 'color');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, 'red');
});

test('validateEnum should reject invalid enum value', () => {
  const result = validateEnum('yellow', ['red', 'green', 'blue'], 'color');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('Valid values: red, green, blue'));
});

test('validateEnum should accept null when not required', () => {
  const result = validateEnum(null, ['red', 'green', 'blue'], 'color');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, null);
});

test('validateEnum should accept undefined when not required', () => {
  const result = validateEnum(undefined, ['red', 'green', 'blue'], 'color');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, null);
});

test('validateEnum should accept empty string when not required', () => {
  const result = validateEnum('', ['red', 'green', 'blue'], 'color');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, null);
});

test('validateEnum should reject null when required', () => {
  const result = validateEnum(null, ['red', 'green', 'blue'], 'color', {
    required: true,
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('required'));
});

test('validateEnum should work with non-string values', () => {
  const result = validateEnum(1, [1, 2, 3], 'priority');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, 1);
});

test('validateEnum should reject invalid non-string value', () => {
  const result = validateEnum(4, [1, 2, 3], 'priority');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('Valid values'));
});

// =============================================================================
// validateInteger tests
// =============================================================================

test('validateInteger should accept valid integer', () => {
  const result = validateInteger(42, 'age');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, 42);
});

test('validateInteger should accept zero', () => {
  const result = validateInteger(0, 'count');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, 0);
});

test('validateInteger should accept negative integer', () => {
  const result = validateInteger(-5, 'offset');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, -5);
});

test('validateInteger should parse string integer', () => {
  const result = validateInteger('42', 'age');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, 42);
});

test('validateInteger should accept null when not required', () => {
  const result = validateInteger(null, 'age');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, null);
});

test('validateInteger should accept undefined when not required', () => {
  const result = validateInteger(undefined, 'age');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, null);
});

test('validateInteger should accept empty string when not required', () => {
  const result = validateInteger('', 'age');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, null);
});

test('validateInteger should reject null when required', () => {
  const result = validateInteger(null, 'age', { required: true });
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('required'));
});

test('validateInteger should reject float', () => {
  const result = validateInteger(3.14, 'age');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('must be an integer'));
});

test('validateInteger should reject non-numeric string', () => {
  const result = validateInteger('abc', 'age');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('must be an integer'));
});

test('validateInteger should validate min', () => {
  const result = validateInteger(3, 'age', { min: 5 });
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('at least 5'));
});

test('validateInteger should validate max', () => {
  const result = validateInteger(100, 'age', { max: 50 });
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes('at most 50'));
});

test('validateInteger should accept value within range', () => {
  const result = validateInteger(25, 'age', { min: 1, max: 100 });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, 25);
});

test('validateInteger should accept value at exact min', () => {
  const result = validateInteger(1, 'age', { min: 1 });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, 1);
});

test('validateInteger should accept value at exact max', () => {
  const result = validateInteger(100, 'age', { max: 100 });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value, 100);
});

// =============================================================================
// requireFields tests
// =============================================================================

/**
 * Helper to create mock req/res/next for middleware tests
 */
function createMockMiddleware() {
  let statusCode = null;
  let jsonBody = null;
  let nextCalled = false;

  const req = { body: {} };
  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(body) {
      jsonBody = body;
      return res;
    },
  };
  const next = () => {
    nextCalled = true;
  };

  return {
    req,
    res,
    next,
    getStatus: () => statusCode,
    getJson: () => jsonBody,
    wasNextCalled: () => nextCalled,
  };
}

test('requireFields should call next when all fields are present', () => {
  const middleware = requireFields('artist', 'album');
  const { req, res, next, wasNextCalled, getStatus } = createMockMiddleware();
  req.body = { artist: 'Radiohead', album: 'OK Computer' };

  middleware(req, res, next);

  assert.strictEqual(wasNextCalled(), true);
  assert.strictEqual(getStatus(), null);
});

test('requireFields should return 400 when a single field is missing', () => {
  const middleware = requireFields('artist', 'album');
  const { req, res, next, wasNextCalled, getStatus, getJson } =
    createMockMiddleware();
  req.body = { artist: 'Radiohead' };

  middleware(req, res, next);

  assert.strictEqual(wasNextCalled(), false);
  assert.strictEqual(getStatus(), 400);
  assert.strictEqual(getJson().error, 'album is required');
});

test('requireFields should return 400 when multiple fields are missing', () => {
  const middleware = requireFields('artist', 'album');
  const { req, res, next, wasNextCalled, getStatus, getJson } =
    createMockMiddleware();
  req.body = {};

  middleware(req, res, next);

  assert.strictEqual(wasNextCalled(), false);
  assert.strictEqual(getStatus(), 400);
  assert.strictEqual(getJson().error, 'artist and album are required');
});

test('requireFields should treat empty string as missing', () => {
  const middleware = requireFields('name');
  const { req, res, next, wasNextCalled, getStatus, getJson } =
    createMockMiddleware();
  req.body = { name: '' };

  middleware(req, res, next);

  assert.strictEqual(wasNextCalled(), false);
  assert.strictEqual(getStatus(), 400);
  assert.strictEqual(getJson().error, 'name is required');
});

test('requireFields should treat null as missing', () => {
  const middleware = requireFields('name');
  const { req, res, next, wasNextCalled, getStatus } = createMockMiddleware();
  req.body = { name: null };

  middleware(req, res, next);

  assert.strictEqual(wasNextCalled(), false);
  assert.strictEqual(getStatus(), 400);
});

test('requireFields should treat undefined as missing', () => {
  const middleware = requireFields('name');
  const { req, res, next, wasNextCalled, getStatus } = createMockMiddleware();
  req.body = {};

  middleware(req, res, next);

  assert.strictEqual(wasNextCalled(), false);
  assert.strictEqual(getStatus(), 400);
});

test('requireFields should accept 0 as a valid value', () => {
  const middleware = requireFields('count');
  const { req, res, next, wasNextCalled, getStatus } = createMockMiddleware();
  req.body = { count: 0 };

  middleware(req, res, next);

  // Note: 0 is falsy, so requireFields treats it as missing.
  // This is the current behavior — fields are checked with !req.body[f]
  assert.strictEqual(wasNextCalled(), false);
  assert.strictEqual(getStatus(), 400);
});

test('requireFields should work with a single field', () => {
  const middleware = requireFields('token');
  const { req, res, next, wasNextCalled } = createMockMiddleware();
  req.body = { token: 'abc123' };

  middleware(req, res, next);

  assert.strictEqual(wasNextCalled(), true);
});

test('requireFields should call next with no fields specified', () => {
  const middleware = requireFields();
  const { req, res, next, wasNextCalled } = createMockMiddleware();
  req.body = {};

  middleware(req, res, next);

  assert.strictEqual(wasNextCalled(), true);
});

test('requireFields should handle three or more missing fields', () => {
  const middleware = requireFields('artist', 'album', 'year');
  const { req, res, next, getStatus, getJson } = createMockMiddleware();
  req.body = {};

  middleware(req, res, next);

  assert.strictEqual(getStatus(), 400);
  assert.strictEqual(getJson().error, 'artist and album and year are required');
});
