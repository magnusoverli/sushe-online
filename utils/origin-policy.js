/**
 * Shared origin policy used by both HTTP CORS and WebSocket CORS.
 */

const PRIVATE_NETWORK_ORIGIN_REGEX =
  /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.\d{1,3}\.\d{1,3})(:\d+)?$/; // eslint-disable-line security/detect-unsafe-regex

function normalizeOrigin(origin) {
  if (!origin || typeof origin !== 'string') {
    return '';
  }
  return origin.endsWith('/') ? origin.slice(0, -1) : origin;
}

function parseAllowedOrigins(rawAllowedOrigins) {
  if (!rawAllowedOrigins || typeof rawAllowedOrigins !== 'string') {
    return [];
  }

  return rawAllowedOrigins
    .split(',')
    .map((item) => normalizeOrigin(item.trim()))
    .filter(Boolean);
}

function isLocalOrigin(origin) {
  return (
    origin.includes('localhost') ||
    origin.includes('127.0.0.1') ||
    origin.includes('[::1]')
  );
}

function isBrowserExtensionOrigin(origin) {
  return (
    origin.startsWith('chrome-extension://') ||
    origin.startsWith('moz-extension://')
  );
}

function isAllowedOrigin(origin, options = {}) {
  const strictMode = options.strictMode === true;
  const allowedOrigins = options.allowedOrigins || [];
  const normalizedOrigin = normalizeOrigin(origin);

  // Allow requests with no origin (mobile apps, curl, Postman)
  if (!origin) {
    return true;
  }

  if (isBrowserExtensionOrigin(normalizedOrigin)) {
    return true;
  }

  if (isLocalOrigin(normalizedOrigin)) {
    return true;
  }

  if (PRIVATE_NETWORK_ORIGIN_REGEX.test(normalizedOrigin)) {
    return true;
  }

  if (allowedOrigins.includes(normalizedOrigin)) {
    return true;
  }

  // Backward-compatible default: allow all HTTPS origins unless strict mode is enabled
  if (!strictMode && normalizedOrigin.startsWith('https://')) {
    return true;
  }

  return false;
}

function createOriginPolicyFromEnv(env = process.env) {
  return {
    strictMode: env.CORS_STRICT_MODE === 'true',
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
  };
}

module.exports = {
  PRIVATE_NETWORK_ORIGIN_REGEX,
  normalizeOrigin,
  parseAllowedOrigins,
  isAllowedOrigin,
  createOriginPolicyFromEnv,
};
