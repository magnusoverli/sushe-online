const { test } = require('node:test');
const assert = require('node:assert/strict');

test('raw playback/scrobble requests share session CSRF headers without inventing missing tokens', async () => {
  const { csrfHeaders } = await import('../src/js/modules/csrf-headers.js');
  assert.deepEqual(csrfHeaders('session-token'), {
    'X-CSRF-Token': 'session-token',
  });
  for (const missing of [null, '', false])
    assert.deepEqual(csrfHeaders(missing), {});
});
