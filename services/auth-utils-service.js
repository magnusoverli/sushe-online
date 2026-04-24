/**
 * Auth utility service.
 *
 * Helpers to validate OAuth tokens and extension tokens.
 */

const crypto = require('crypto');
const { ensureDb } = require('../db/postgres');

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

    try {
      const result = await datastore.raw(
        `SELECT user_id, expires_at, is_revoked
         FROM extension_tokens
         WHERE token = $1`,
        [token],
        { name: 'auth-utils-validate-extension-token', retryable: true }
      );

      if (result.rows.length === 0) {
        return null;
      }

      const tokenData = result.rows[0];
      if (tokenData.is_revoked) {
        return null;
      }

      if (new Date(tokenData.expires_at) < new Date()) {
        return null;
      }

      await datastore.raw(
        `UPDATE extension_tokens
         SET last_used_at = NOW()
         WHERE token = $1`,
        [token],
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

module.exports = { createAuthUtils, ...defaultInstance };
