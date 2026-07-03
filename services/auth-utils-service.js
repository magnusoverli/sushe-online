/**
 * Auth utility service.
 *
 * Helpers to validate OAuth tokens and extension tokens.
 */

const crypto = require('crypto');
const { ensureDb } = require('../db/postgres');

// Length of the non-secret token prefix stored in `token_lookup` for indexed
// lookups. Kept short so it leaks negligible information while still narrowing
// candidate rows to (almost always) one before the constant-time hash compare.
const EXTENSION_TOKEN_LOOKUP_LEN = 8;

/**
 * Hash a raw extension token for storage/comparison (SHA-256 hex). Tokens are
 * 256-bit random values, so a fast hash is sufficient — a slow KDF would only
 * add latency to every authenticated API request without adding real security.
 * @param {string} token
 * @returns {string} 64-char hex digest
 */
function hashExtensionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Non-secret indexed lookup prefix for a raw token.
 * @param {string} token
 * @returns {string}
 */
function extensionTokenLookup(token) {
  return token.slice(0, EXTENSION_TOKEN_LOOKUP_LEN);
}

/**
 * Constant-time comparison of two equal-length hex digests.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function createAuthUtils(deps = {}) {
  const logger = deps.logger || require('../utils/logger');

  function isTokenValid(token) {
    if (!token || !token.access_token) return false;
    if (token.expires_at && token.expires_at <= Date.now()) return false;
    return true;
  }

  function canTokenBeRefreshed(token) {
    if (!token) return false;
    return !!token.refresh_token;
  }

  function isTokenUsable(token) {
    if (!token) return false;
    if (isTokenValid(token)) return true;
    return canTokenBeRefreshed(token);
  }

  function generateExtensionToken() {
    return crypto.randomBytes(32).toString('base64url');
  }

  function isValidExtensionToken(token) {
    if (!token || typeof token !== 'string') return false;
    if (token.length !== 43) return false;
    if (!/^[A-Za-z0-9_-]+$/.test(token)) return false;
    return true;
  }

  async function validateExtensionToken(token, db) {
    if (!isValidExtensionToken(token)) {
      return null;
    }
    const datastore = ensureDb(db, 'auth-utils.validateExtensionToken');

    const lookup = extensionTokenLookup(token);
    const hash = hashExtensionToken(token);

    try {
      // Look up by the short non-secret prefix (indexed), then constant-time
      // compare the full hash. Tokens are stored only as hashes, so a leaked
      // database dump does not expose usable credentials.
      const result = await datastore.raw(
        `SELECT id, user_id, expires_at, is_revoked, token_hash
         FROM extension_tokens
         WHERE token_lookup = $1 AND is_revoked = FALSE`,
        [lookup],
        { name: 'auth-utils-validate-extension-token', retryable: true }
      );

      const tokenData = result.rows.find(
        (row) => row.token_hash && timingSafeEqualHex(row.token_hash, hash)
      );

      if (!tokenData) {
        return null;
      }

      if (new Date(tokenData.expires_at) < new Date()) {
        return null;
      }

      await datastore.raw(
        `UPDATE extension_tokens
         SET last_used_at = NOW()
         WHERE id = $1`,
        [tokenData.id],
        { name: 'auth-utils-touch-extension-token' }
      );

      return tokenData.user_id;
    } catch (error) {
      logger.error('Error validating extension token', {
        error: error.message,
      });
      return null;
    }
  }

  async function cleanupExpiredTokens(db) {
    const datastore = ensureDb(db, 'auth-utils.cleanupExpiredTokens');
    try {
      const result = await datastore.raw(
        `DELETE FROM extension_tokens
         WHERE expires_at < NOW()
         OR is_revoked = TRUE`,
        [],
        { name: 'auth-utils-cleanup-expired' }
      );
      return result.rowCount;
    } catch (error) {
      logger.error('Error cleaning up expired tokens', {
        error: error.message,
      });
      return 0;
    }
  }

  return {
    isTokenValid,
    isTokenUsable,
    canTokenBeRefreshed,
    generateExtensionToken,
    validateExtensionToken,
    cleanupExpiredTokens,
  };
}

const defaultInstance = createAuthUtils();

module.exports = {
  createAuthUtils,
  hashExtensionToken,
  extensionTokenLookup,
  timingSafeEqualHex,
  ...defaultInstance,
};
