const test = require('node:test');
const assert = require('node:assert');
const {
  isValidEmail,
  isValidUsername,
  isValidPassword,
  validateYear,
  validateListId,
  validateListName,
} = require('../validators.js');

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
