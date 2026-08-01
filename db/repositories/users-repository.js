const { ensureDb } = require('../postgres');
const { mapUserRow, USER_SELECT_COLUMNS } = require('../schema/users');

/**
 * Provider OAuth payload stored verbatim in the `spotify_auth` / `tidal_auth`
 * JSONB columns. The provider owns the shape; these are the fields the app
 * reads back, so extra keys are expected and preserved.
 * @typedef {Object} OAuthTokenBlob
 * @property {string} [access_token]
 * @property {string} [refresh_token]
 * @property {string} [token_type]
 * @property {string} [scope]
 * @property {number} [expires_in]  Provider-reported lifetime in seconds.
 * @property {number} [expires_at]  Epoch ms, computed by the OAuth callback.
 */

/**
 * Session payload stored in the `lastfm_auth` JSONB column. Last.fm sessions
 * do not expire, so there is no refresh token or expiry.
 * @typedef {Object} LastfmAuthBlob
 * @property {string} session_key
 * @property {string} username
 * @property {number} [connected_at]  Epoch ms the session was established.
 */

/** @param {{ db?: * }} [deps] - `db` is validated by ensureDb, which types the result. */
function createUsersRepository(deps = {}) {
  const db = ensureDb(deps.db, 'users-repository');

  /** @param {string} userId - `users._id` (TEXT), not the SERIAL `id`. */
  async function findById(userId) {
    const result = await db.raw(
      `SELECT ${USER_SELECT_COLUMNS}
       FROM users
       WHERE _id = $1
       LIMIT 1`,
      [userId],
      { name: 'users-repo-find-by-id', retryable: true }
    );
    return mapUserRow(result.rows[0] || null);
  }

  /** @param {string} email */
  async function findByEmail(email) {
    const result = await db.raw(
      `SELECT ${USER_SELECT_COLUMNS}
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [email],
      { name: 'users-repo-find-by-email', retryable: true }
    );
    return mapUserRow(result.rows[0] || null);
  }

  /**
   * @param {string} token - Plaintext value of `users.reset_token`.
   * @param {number} [nowMs] - Epoch ms compared against `reset_expires` (BIGINT epoch ms).
   */
  async function findByResetToken(token, nowMs = Date.now()) {
    const result = await db.raw(
      `SELECT ${USER_SELECT_COLUMNS}
       FROM users
       WHERE reset_token = $1
         AND reset_expires > $2
       LIMIT 1`,
      [token, nowMs],
      { name: 'users-repo-find-by-reset-token', retryable: true }
    );
    return mapUserRow(result.rows[0] || null);
  }

  /**
   * @param {string} userId
   * @param {string} token
   * @param {number} expiresMs - Epoch ms written to `reset_expires` (BIGINT).
   */
  async function setResetToken(userId, token, expiresMs) {
    const result = await db.raw(
      `UPDATE users
       SET reset_token = $1,
           reset_expires = $2,
           updated_at = NOW()
       WHERE _id = $3`,
      [token, expiresMs, userId],
      { name: 'users-repo-set-reset-token' }
    );
    return result.rowCount;
  }

  /**
   * @param {string} token
   * @param {number} nowMs - Epoch ms compared against `reset_expires`.
   * @param {string} hash - Already-hashed password to store in `users.hash`.
   */
  async function resetPasswordByToken(token, nowMs, hash) {
    const result = await db.raw(
      `UPDATE users
       SET hash = $1,
           reset_token = NULL,
           reset_expires = NULL,
           updated_at = NOW()
       WHERE reset_token = $2
         AND reset_expires > $3`,
      [hash, token, nowMs],
      { name: 'users-repo-reset-password-by-token' }
    );
    return result.rowCount;
  }

  /**
   * @param {string} userId
   * @param {Date} timestamp - Written to `last_activity` (TIMESTAMPTZ).
   */
  async function updateLastActivity(userId, timestamp) {
    const result = await db.raw(
      `UPDATE users
       SET last_activity = $1
       WHERE _id = $2`,
      [timestamp, userId],
      { name: 'users-repo-update-last-activity' }
    );
    return result.rowCount;
  }

  /**
   * @param {string} userId
   * @param {OAuthTokenBlob} token
   */
  async function setSpotifyAuth(userId, token) {
    const result = await db.raw(
      `UPDATE users
       SET spotify_auth = $1,
           updated_at = NOW()
       WHERE _id = $2`,
      [token, userId],
      // Idempotent single-row write of the same value — safe to retry, and a
      // dropped persist here would strand a consumed OAuth refresh token.
      { name: 'users-repo-set-spotify-auth', retryable: true }
    );
    return result.rowCount;
  }

  /** @param {string} userId */
  async function clearSpotifyAuth(userId) {
    const result = await db.raw(
      `UPDATE users
       SET spotify_auth = NULL,
           updated_at = NOW()
       WHERE _id = $1`,
      [userId],
      { name: 'users-repo-clear-spotify-auth' }
    );
    return result.rowCount;
  }

  /**
   * @param {string} userId
   * @param {OAuthTokenBlob} token
   * @param {string|null} [countryCode] - ISO 3166-1 alpha-2; null leaves the
   *   stored `tidal_country` untouched (see COALESCE below).
   */
  async function setTidalAuth(userId, token, countryCode = null) {
    // COALESCE keeps the stored country when a token-only refresh passes
    // null — refreshes must never wipe a previously resolved region.
    const result = await db.raw(
      `UPDATE users
       SET tidal_auth = $1,
           tidal_country = COALESCE($2, tidal_country),
           updated_at = NOW()
       WHERE _id = $3`,
      [token, countryCode, userId],
      // Idempotent single-row write of the same value — safe to retry, and a
      // dropped persist here would strand a consumed OAuth refresh token.
      { name: 'users-repo-set-tidal-auth', retryable: true }
    );
    return result.rowCount;
  }

  /** @param {string} userId */
  async function clearTidalAuth(userId) {
    const result = await db.raw(
      `UPDATE users
       SET tidal_auth = NULL,
           updated_at = NOW()
       WHERE _id = $1`,
      [userId],
      { name: 'users-repo-clear-tidal-auth' }
    );
    return result.rowCount;
  }

  /**
   * @param {string} userId
   * @param {string|null} countryCode - ISO 3166-1 alpha-2.
   */
  async function setTidalCountry(userId, countryCode) {
    const result = await db.raw(
      `UPDATE users
       SET tidal_country = $1,
           updated_at = NOW()
       WHERE _id = $2`,
      [countryCode, userId],
      { name: 'users-repo-set-tidal-country' }
    );
    return result.rowCount;
  }

  /**
   * @param {string} userId
   * @param {LastfmAuthBlob} auth
   * @param {string} username - Denormalized copy of `auth.username` for lookups.
   */
  async function setLastfmAuth(userId, auth, username) {
    const result = await db.raw(
      `UPDATE users
       SET lastfm_auth = $1,
           lastfm_username = $2,
           updated_at = NOW()
       WHERE _id = $3`,
      [auth, username, userId],
      { name: 'users-repo-set-lastfm-auth' }
    );
    return result.rowCount;
  }

  /** @param {string} userId */
  async function clearLastfmAuth(userId) {
    const result = await db.raw(
      `UPDATE users
       SET lastfm_auth = NULL,
           lastfm_username = NULL,
           updated_at = NOW()
       WHERE _id = $1`,
      [userId],
      { name: 'users-repo-clear-lastfm-auth' }
    );
    return result.rowCount;
  }

  return {
    findById,
    findByEmail,
    findByResetToken,
    setResetToken,
    resetPasswordByToken,
    updateLastActivity,
    setSpotifyAuth,
    clearSpotifyAuth,
    setTidalAuth,
    clearTidalAuth,
    setTidalCountry,
    setLastfmAuth,
    clearLastfmAuth,
  };
}

module.exports = {
  createUsersRepository,
  mapUserRow,
  USER_SELECT_COLUMNS,
};
