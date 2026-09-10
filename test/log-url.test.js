const { test } = require('node:test');
const assert = require('node:assert/strict');
const { logSafeUrl } = require('../utils/log-url');

test('request logging redacts reset links and encoded OAuth credentials without changing ordinary URLs', () => {
  assert.equal(logSafeUrl('/api/lists?q=My%20List'), '/api/lists?q=My%20List');
  for (const url of [
    '/reset/private-token',
    '/auth/spotify/callback?code=private-token&state=private-state',
    '/auth/callback?%63ode=private-token&code=private-token',
  ]) {
    assert.ok(!logSafeUrl(url).includes('private'));
  }
});
