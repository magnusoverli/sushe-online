const test = require('node:test');
const assert = require('node:assert');
const { isTokenValid } = require('../auth-utils.js');

test('isTokenValid should return false for null/undefined token', () => {
  assert.strictEqual(isTokenValid(null), false);
  assert.strictEqual(isTokenValid(undefined), false);
  assert.strictEqual(isTokenValid({}), false);
});

test('isTokenValid should return false for token without access_token', () => {
  assert.strictEqual(isTokenValid({ expires_at: Date.now() + 1000 }), false);
  assert.strictEqual(isTokenValid({ refresh_token: 'test' }), false);
});

test('isTokenValid should return false for expired token', () => {
  const expiredToken = {
    access_token: 'test_token',
    expires_at: Date.now() - 1000, // Expired 1 second ago
  };
  assert.strictEqual(isTokenValid(expiredToken), false);
});

test('isTokenValid should return true for valid token without expiry', () => {
  const validToken = {
    access_token: 'test_token',
  };
  assert.strictEqual(isTokenValid(validToken), true);
});

test('isTokenValid should return true for valid token with future expiry', () => {
  const validToken = {
    access_token: 'test_token',
    expires_at: Date.now() + 3600000, // Expires in 1 hour
  };
  assert.strictEqual(isTokenValid(validToken), true);
});

test('isTokenValid should handle edge case of expiry exactly at current time', () => {
  const edgeToken = {
    access_token: 'test_token',
    expires_at: Date.now(),
  };
  assert.strictEqual(isTokenValid(edgeToken), false);
});
