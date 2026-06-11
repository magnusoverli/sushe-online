const DEFAULTS = {
  enabled: false,
  dbPrewarmEnabled: false,
  dbPrewarmMode: 'hot',
  coverCacheEnabled: false,
  coverCacheMaxBytes: 512 * 1024 * 1024,
  coverCacheMaxItems: 10000,
  responseCacheMaxBytes: 256 * 1024 * 1024,
  appPrewarmEnabled: false,
  appPrewarmBlocking: true,
  appPrewarmUsersLimit: 100,
  appPrewarmCoversLimit: 5000,
};

const BYTE_UNITS = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBytes(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  let valueEnd = 0;
  let hasDecimal = false;

  while (valueEnd < normalized.length) {
    const char = normalized[valueEnd];
    if (char >= '0' && char <= '9') {
      valueEnd += 1;
    } else if (char === '.' && !hasDecimal) {
      hasDecimal = true;
      valueEnd += 1;
    } else {
      break;
    }
  }

  const amountText = normalized.slice(0, valueEnd);
  if (!amountText || amountText[0] === '.' || amountText.endsWith('.')) {
    return fallback;
  }

  const amount = Number.parseFloat(amountText);
  const unit = normalized.slice(valueEnd).trim() || 'b';
  const multiplier = BYTE_UNITS[unit];
  if (!Number.isFinite(amount) || !multiplier) return fallback;
  return Math.floor(amount * multiplier);
}

function resolveChildFlag(env, key, masterEnabled, defaultValue) {
  if (env[key] === undefined || env[key] === null || env[key] === '') {
    return masterEnabled ? true : defaultValue;
  }
  return parseBoolean(env[key], defaultValue);
}

function resolveRamAccelerationConfig(env = process.env) {
  const enabled = parseBoolean(env.ENABLE_RAM_ACCELERATION, DEFAULTS.enabled);
  const dbPrewarmMode = ['hot', 'full', 'off'].includes(env.DB_PREWARM_MODE)
    ? env.DB_PREWARM_MODE
    : DEFAULTS.dbPrewarmMode;

  return {
    enabled,
    dbPrewarmEnabled:
      dbPrewarmMode !== 'off' &&
      resolveChildFlag(
        env,
        'DB_PREWARM_ENABLED',
        enabled,
        DEFAULTS.dbPrewarmEnabled
      ),
    dbPrewarmMode,
    coverCacheEnabled: resolveChildFlag(
      env,
      'COVER_CACHE_ENABLED',
      enabled,
      DEFAULTS.coverCacheEnabled
    ),
    coverCacheMaxBytes: parseBytes(
      env.COVER_CACHE_MAX_BYTES,
      DEFAULTS.coverCacheMaxBytes
    ),
    coverCacheMaxItems: parsePositiveInteger(
      env.COVER_CACHE_MAX_ITEMS,
      DEFAULTS.coverCacheMaxItems
    ),
    responseCacheMaxBytes: parseBytes(
      env.RESPONSE_CACHE_MAX_BYTES,
      DEFAULTS.responseCacheMaxBytes
    ),
    appPrewarmEnabled: resolveChildFlag(
      env,
      'APP_PREWARM_ENABLED',
      enabled,
      DEFAULTS.appPrewarmEnabled
    ),
    appPrewarmBlocking: parseBoolean(
      env.APP_PREWARM_BLOCKING,
      DEFAULTS.appPrewarmBlocking
    ),
    appPrewarmUsersLimit: parsePositiveInteger(
      env.APP_PREWARM_USERS_LIMIT,
      DEFAULTS.appPrewarmUsersLimit
    ),
    appPrewarmCoversLimit: parsePositiveInteger(
      env.APP_PREWARM_COVERS_LIMIT,
      DEFAULTS.appPrewarmCoversLimit
    ),
  };
}

module.exports = {
  DEFAULTS,
  parseBoolean,
  parseBytes,
  parsePositiveInteger,
  resolveRamAccelerationConfig,
};
