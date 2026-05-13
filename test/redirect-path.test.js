const { describe, it } = require('node:test');
const assert = require('node:assert');

const { sanitizeReturnPath } = require('../utils/redirect-path');

describe('redirect-path', () => {
  it('falls back to root for unsafe return paths', () => {
    assert.strictEqual(sanitizeReturnPath('https://evil.example/phish'), '/');
    assert.strictEqual(sanitizeReturnPath('//evil.example/phish'), '/');
    assert.strictEqual(sanitizeReturnPath('/safe/path'), '/safe/path');
  });
});
