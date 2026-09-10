const SENSITIVE_QUERY_KEYS = new Set([
  'code',
  'state',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  '_csrf',
]);

/** @param {string|undefined} value */
function logSafeUrl(value) {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value, 'http://request.invalid');
    const path = url.pathname.replace(/(\/reset\/)[^/]+/g, '$1[redacted]');
    let redacted = path !== url.pathname;
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, '[redacted]');
        redacted = true;
      }
    }
    return redacted ? path + url.search : value;
  } catch {
    return '[invalid URL]';
  }
}

module.exports = { logSafeUrl };
