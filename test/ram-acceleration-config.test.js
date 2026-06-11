const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  DEFAULTS,
  parseBoolean,
  parseBytes,
  parsePositiveInteger,
  resolveRamAccelerationConfig,
} = require('../config/ram-acceleration');

describe('ram-acceleration config', () => {
  it('parses boolean values safely', () => {
    assert.strictEqual(parseBoolean('true'), true);
    assert.strictEqual(parseBoolean('1'), true);
    assert.strictEqual(parseBoolean('yes'), true);
    assert.strictEqual(parseBoolean('false', true), false);
    assert.strictEqual(parseBoolean('0', true), false);
    assert.strictEqual(parseBoolean('invalid', true), true);
  });

  it('parses byte values with units', () => {
    assert.strictEqual(parseBytes('512', 1), 512);
    assert.strictEqual(parseBytes('1KB', 1), 1024);
    assert.strictEqual(parseBytes('1.5MB', 1), 1572864);
    assert.strictEqual(parseBytes('2GB', 1), 2147483648);
    assert.strictEqual(parseBytes('bad', 123), 123);
    assert.strictEqual(parseBytes('1.2.3MB', 123), 123);
  });

  it('parses positive integers with fallback', () => {
    assert.strictEqual(parsePositiveInteger('42', 1), 42);
    assert.strictEqual(parsePositiveInteger('0', 1), 0);
    assert.strictEqual(parsePositiveInteger('-1', 9), 9);
    assert.strictEqual(parsePositiveInteger('10abc', 9), 9);
    assert.strictEqual(parsePositiveInteger('1.5', 9), 9);
    assert.strictEqual(parsePositiveInteger('bad', 9), 9);
  });

  it('keeps all child features disabled by default', () => {
    const config = resolveRamAccelerationConfig({});

    assert.strictEqual(config.enabled, false);
    assert.strictEqual(config.dbPrewarmEnabled, false);
    assert.strictEqual(config.coverCacheEnabled, false);
    assert.strictEqual(config.appPrewarmEnabled, false);
    assert.strictEqual(config.coverCacheMaxBytes, DEFAULTS.coverCacheMaxBytes);
  });

  it('enables child features from the master switch unless explicitly disabled', () => {
    const config = resolveRamAccelerationConfig({
      ENABLE_RAM_ACCELERATION: 'true',
      COVER_CACHE_ENABLED: 'false',
      COVER_CACHE_MAX_BYTES: '64MB',
      RESPONSE_CACHE_MAX_BYTES: '32MB',
      APP_PREWARM_USERS_LIMIT: '12',
    });

    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.dbPrewarmEnabled, true);
    assert.strictEqual(config.coverCacheEnabled, false);
    assert.strictEqual(config.appPrewarmEnabled, true);
    assert.strictEqual(config.coverCacheMaxBytes, 64 * 1024 * 1024);
    assert.strictEqual(config.responseCacheMaxBytes, 32 * 1024 * 1024);
    assert.strictEqual(config.appPrewarmUsersLimit, 12);
  });

  it('treats blank child flags as inherited from the master switch', () => {
    const config = resolveRamAccelerationConfig({
      ENABLE_RAM_ACCELERATION: 'true',
      DB_PREWARM_ENABLED: '',
      COVER_CACHE_ENABLED: '',
      APP_PREWARM_ENABLED: '',
    });

    assert.strictEqual(config.dbPrewarmEnabled, true);
    assert.strictEqual(config.coverCacheEnabled, true);
    assert.strictEqual(config.appPrewarmEnabled, true);
  });

  it('honors DB_PREWARM_MODE=off even when the master switch is enabled', () => {
    const config = resolveRamAccelerationConfig({
      ENABLE_RAM_ACCELERATION: 'true',
      DB_PREWARM_MODE: 'off',
    });

    assert.strictEqual(config.dbPrewarmMode, 'off');
    assert.strictEqual(config.dbPrewarmEnabled, false);
  });
});
