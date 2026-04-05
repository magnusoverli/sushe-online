const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  normalizeOrigin,
  parseAllowedOrigins,
  isAllowedOrigin,
  createOriginPolicyFromEnv,
} = require('../utils/origin-policy.js');

describe('origin-policy normalizeOrigin', () => {
  it('removes trailing slash', () => {
    assert.strictEqual(
      normalizeOrigin('https://example.com/'),
      'https://example.com'
    );
  });

  it('returns empty string for invalid input', () => {
    assert.strictEqual(normalizeOrigin(), '');
    assert.strictEqual(normalizeOrigin(null), '');
  });
});

describe('origin-policy parseAllowedOrigins', () => {
  it('parses comma-separated origins', () => {
    const origins = parseAllowedOrigins(
      'https://a.example.com, https://b.example.com/'
    );
    assert.deepStrictEqual(origins, [
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('returns empty array for missing env value', () => {
    assert.deepStrictEqual(parseAllowedOrigins(undefined), []);
  });
});

describe('origin-policy isAllowedOrigin', () => {
  it('allows no origin', () => {
    assert.strictEqual(isAllowedOrigin(undefined, {}), true);
  });

  it('allows browser extension origins', () => {
    assert.strictEqual(
      isAllowedOrigin('chrome-extension://abcdefghijklmno', {}),
      true
    );
    assert.strictEqual(
      isAllowedOrigin('moz-extension://abcdefghijklmno', {}),
      true
    );
  });

  it('allows localhost and private network origins', () => {
    assert.strictEqual(isAllowedOrigin('http://localhost:3000', {}), true);
    assert.strictEqual(isAllowedOrigin('http://127.0.0.1:3000', {}), true);
    assert.strictEqual(isAllowedOrigin('http://192.168.1.2:3000', {}), true);
  });

  it('allows all https origins in non-strict mode', () => {
    assert.strictEqual(
      isAllowedOrigin('https://unknown.example.com', {
        strictMode: false,
        allowedOrigins: [],
      }),
      true
    );
  });

  it('denies unknown https origins in strict mode', () => {
    assert.strictEqual(
      isAllowedOrigin('https://unknown.example.com', {
        strictMode: true,
        allowedOrigins: [],
      }),
      false
    );
  });

  it('allows allowlisted origins in strict mode', () => {
    assert.strictEqual(
      isAllowedOrigin('https://admin.example.com', {
        strictMode: true,
        allowedOrigins: ['https://admin.example.com'],
      }),
      true
    );
  });

  it('denies non-https non-allowlisted public origins', () => {
    assert.strictEqual(isAllowedOrigin('http://evil.example.com', {}), false);
  });
});

describe('origin-policy createOriginPolicyFromEnv', () => {
  it('reads strict mode and allowlist from env', () => {
    const policy = createOriginPolicyFromEnv({
      CORS_STRICT_MODE: 'true',
      ALLOWED_ORIGINS: 'https://one.example.com,https://two.example.com',
    });

    assert.strictEqual(policy.strictMode, true);
    assert.deepStrictEqual(policy.allowedOrigins, [
      'https://one.example.com',
      'https://two.example.com',
    ]);
  });
});
