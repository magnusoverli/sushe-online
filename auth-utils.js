// auth-utils.js
// Helper to validate OAuth tokens

function isTokenValid(token) {
  if (!token || !token.access_token) return false;
  if (token.expires_at && token.expires_at <= Date.now()) return false;
  return true;
}

module.exports = { isTokenValid };
