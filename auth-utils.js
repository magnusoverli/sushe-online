// auth-utils.js
// Helper to validate OAuth tokens and extension tokens

const crypto = require('crypto');

function isTokenValid(token) {
  if (!token || !token.access_token) return false;
  if (token.expires_at && token.expires_at <= Date.now()) return false;
  return true;
}

// Generate a cryptographically secure random token
function generateExtensionToken() {
  // 32 bytes = 256 bits of entropy, base64url encoded
  return crypto.randomBytes(32).toString('base64url');
}

// Validate extension token format
function isValidExtensionToken(token) {
  if (!token || typeof token !== 'string') return false;
  // Should be 43 characters for 32-byte base64url encoded string
  if (token.length !== 43) return false;
  // Should only contain base64url characters
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return false;
  return true;
}

// Find and validate extension token from database
async function validateExtensionToken(token, pool) {
  if (!isValidExtensionToken(token)) {
    return null;
  }

  try {
    const result = await pool.query(
      `SELECT user_id, expires_at, is_revoked 
       FROM extension_tokens 
       WHERE token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return null; // Token not found
    }

    const tokenData = result.rows[0];

    // Check if token is revoked
    if (tokenData.is_revoked) {
      return null;
    }

    // Check if token is expired
    if (new Date(tokenData.expires_at) < new Date()) {
      return null;
    }

    // Update last_used_at timestamp
    await pool.query(
      `UPDATE extension_tokens 
       SET last_used_at = NOW() 
       WHERE token = $1`,
      [token]
    );

    return tokenData.user_id;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error validating extension token:', error);
    return null;
  }
}

// Clean up expired tokens (can be called periodically)
async function cleanupExpiredTokens(pool) {
  try {
    const result = await pool.query(
      `DELETE FROM extension_tokens 
       WHERE expires_at < NOW() 
       OR is_revoked = TRUE`
    );
    return result.rowCount;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error cleaning up expired tokens:', error);
    return 0;
  }
}

module.exports = {
  isTokenValid,
  generateExtensionToken,
  isValidExtensionToken,
  validateExtensionToken,
  cleanupExpiredTokens,
};
