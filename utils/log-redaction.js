const { logSafeUrl } = require('./log-url');
const REDACTED = '[redacted]';
const PRIVATE_KEYS = new Set([
  'password',
  'passwd',
  'pass',
  'hash',
  'passwordhash',
  'secret',
  'sessionsecret',
  'authorization',
  'cookie',
  'cookies',
  'setcookie',
  'token',
  'tokens',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'resettoken',
  'extensiontoken',
  'csrftoken',
  'csrf',
  'apikey',
  'clientsecret',
  'webhooksecret',
  'bottoken',
  'bottokenencrypted',
  'params',
  'parameters',
  'bindings',
  'sql',
  'query',
  'stderr',
  'stderrdata',
  'stderrsample',
  'responsebody',
  'error',
  'err',
  'stack',
  'details',
  'connectionstring',
  'databaseurl',
  'credential',
  'credentials',
]);

/** @param {string} value */
function safeText(value) {
  return value
    .replace(/[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi, (url) => logSafeUrl(url))
    .replace(/(\/(?:reset|api\/telegram\/webhook)\/)[^\s/?]+/g, '$1[redacted]')
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [redacted]')
    .replace(
      /\b(password|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[redacted]'
    );
}

/** @param {unknown} value @param {WeakSet<object>} [seen] @returns {unknown} */
function redactLogValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') return safeText(value);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Error) {
    const code = Reflect.get(value, 'code');
    return {
      type: value.name,
      code:
        typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)
          ? code
          : undefined,
    };
  }
  if (Buffer.isBuffer(value)) return '[binary omitted]';
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value))
    return value.map((item) => redactLogValue(item, seen));
  /** @type {Record<string, unknown>} */
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    result[key] =
      PRIVATE_KEYS.has(normalized) ||
      /(?:password|passwd|secret|token|tokenhash|sessionkey|privatekey|auth)$/.test(
        normalized
      )
        ? REDACTED
        : redactLogValue(item, seen);
  }
  return result;
}

module.exports = { redactLogValue };
