const assert = require('node:assert');
const test = require('node:test');

const { isValidEmail, isValidUsername, isValidPassword } = require('../validators');
const { adjustColor, colorWithOpacity } = require('../color-utils');
const { isTokenValid } = require('../auth-utils');

// Validators tests

test('isValidEmail identifies valid and invalid emails', () => {
  assert.strictEqual(isValidEmail('user@example.com'), true);
  assert.strictEqual(isValidEmail('not an email'), false);
});

test('isValidUsername enforces allowed characters and length', () => {
  assert.strictEqual(isValidUsername('good_user'), true);
  assert.strictEqual(isValidUsername('no'), false); // too short
  assert.strictEqual(isValidUsername('bad*user'), false); // invalid char
});

test('isValidPassword checks minimum length', () => {
  assert.strictEqual(isValidPassword('12345678'), true);
  assert.strictEqual(isValidPassword('short'), false);
});

// Color util tests

test('adjustColor brightens and darkens colors', () => {
  assert.strictEqual(adjustColor('#000000', 10), '#1a1a1a');
  assert.strictEqual(adjustColor('#ff0000', -10), '#e60000');
});

test('colorWithOpacity converts hex to rgba with opacity', () => {
  assert.strictEqual(colorWithOpacity('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)');
  assert.strictEqual(colorWithOpacity('invalid', 0.5), 'invalid');
});

test('isTokenValid checks expiration and presence', () => {
  const valid = { access_token: 'abc', expires_at: Date.now() + 10000 };
  const expired = { access_token: 'abc', expires_at: Date.now() - 1000 };
  const missing = null;
  assert.strictEqual(isTokenValid(valid), true);
  assert.strictEqual(isTokenValid(expired), false);
  assert.strictEqual(isTokenValid(missing), false);
});
