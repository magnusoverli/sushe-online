/**
 * Helpers for validating app-internal redirect targets.
 */

function isSafeInternalPath(path) {
  if (typeof path !== 'string') {
    return false;
  }

  const trimmed = path.trim();
  if (!trimmed) {
    return false;
  }

  if (!trimmed.startsWith('/')) {
    return false;
  }

  // Disallow protocol-relative URLs (e.g. //evil.com)
  if (trimmed.startsWith('//')) {
    return false;
  }

  // Disallow backslashes and control characters
  const hasControlChars = [...trimmed].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });

  if (trimmed.includes('\\') || hasControlChars) {
    return false;
  }

  return true;
}

function sanitizeReturnPath(path, fallback = '/') {
  return isSafeInternalPath(path) ? path.trim() : fallback;
}

module.exports = {
  isSafeInternalPath,
  sanitizeReturnPath,
};
