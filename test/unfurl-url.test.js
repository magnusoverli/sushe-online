const { describe, it } = require('node:test');
const assert = require('node:assert');

const { validateUnfurlTarget } = require('../utils/unfurl-url');

describe('unfurl-url', () => {
  it('accepts public http/https URLs', () => {
    assert.deepStrictEqual(
      validateUnfurlTarget('https://example.com').valid,
      true
    );
    assert.deepStrictEqual(
      validateUnfurlTarget('http://example.com/a?b=1').valid,
      true
    );
  });

  it('rejects localhost and private IPv4 addresses', () => {
    assert.deepStrictEqual(
      validateUnfurlTarget('http://localhost:3000').valid,
      false
    );
    assert.deepStrictEqual(
      validateUnfurlTarget('http://127.0.0.1').valid,
      false
    );
    assert.deepStrictEqual(
      validateUnfurlTarget('http://192.168.1.5').valid,
      false
    );
    assert.deepStrictEqual(
      validateUnfurlTarget('http://10.0.0.8').valid,
      false
    );
  });

  it('rejects private IPv6 targets', () => {
    assert.deepStrictEqual(validateUnfurlTarget('http://[::1]').valid, false);
    assert.deepStrictEqual(
      validateUnfurlTarget('http://[fd00::1]').valid,
      false
    );
  });

  it('rejects non-http protocols and URL credentials', () => {
    assert.deepStrictEqual(
      validateUnfurlTarget('file:///etc/passwd').valid,
      false
    );
    assert.deepStrictEqual(
      validateUnfurlTarget('https://user:pass@example.com').valid,
      false
    );
  });
});
