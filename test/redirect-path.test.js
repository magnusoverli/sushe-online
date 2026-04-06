const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  isSafeInternalPath,
  sanitizeReturnPath,
} = require('../utils/redirect-path');

describe('redirect-path', () => {
  it('accepts normal app-relative paths', () => {
    assert.strictEqual(isSafeInternalPath('/settings'), true);
    assert.strictEqual(isSafeInternalPath('/settings?tab=music#spotify'), true);
  });

  it('rejects external and protocol-relative paths', () => {
    assert.strictEqual(isSafeInternalPath('https://evil.example/phish'), false);
    assert.strictEqual(isSafeInternalPath('//evil.example/phish'), false);
  });

  it('rejects paths with backslashes or control characters', () => {
    assert.strictEqual(isSafeInternalPath('/foo\\bar'), false);
    assert.strictEqual(isSafeInternalPath('/foo\nbar'), false);
  });

  it('falls back to root for unsafe return paths', () => {
    assert.strictEqual(sanitizeReturnPath('https://evil.example/phish'), '/');
    assert.strictEqual(sanitizeReturnPath('//evil.example/phish'), '/');
    assert.strictEqual(sanitizeReturnPath('/safe/path'), '/safe/path');
  });
});
