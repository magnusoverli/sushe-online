const { ensureDb } = require('../postgres');

function mapUserRow(row) {
  if (!row) return null;
  return {
    _id: row._id,
    email: row.email,
    username: row.username,
    hash: row.hash,
    accentColor: row.accent_color,
    timeFormat: row.time_format,
    dateFormat: row.date_format,
    lastSelectedList: row.last_selected_list,
    role: row.role,
    adminGrantedAt: row.admin_granted_at,
    spotifyAuth: row.spotify_auth,
    tidalAuth: row.tidal_auth,
    tidalCountry: row.tidal_country,
    musicService: row.music_service,
    resetToken: row.reset_token,
    resetExpires: row.reset_expires,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivity: row.last_activity,
    lastfmAuth: row.lastfm_auth,
    lastfmUsername: row.lastfm_username,
    listSetupDismissedUntil: row.list_setup_dismissed_until,
    approvalStatus: row.approval_status,
    columnVisibility: row.column_visibility,
  };
}

const USER_SELECT_COLUMNS = `
  _id,
  email,
  username,
  hash,
  accent_color,
  time_format,
  date_format,
  last_selected_list,
  role,
  admin_granted_at,
  spotify_auth,
  tidal_auth,
  tidal_country,
  music_service,
  reset_token,
  reset_expires,
  created_at,
  updated_at,
  last_activity,
  lastfm_auth,
  lastfm_username,
  list_setup_dismissed_until,
  approval_status,
  column_visibility
`;

function createUsersRepository(deps = {}) {
  const db = ensureDb(deps.db, 'users-repository');

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

  async function findByUsername(username) {
    const result = await db.raw(
      `SELECT ${USER_SELECT_COLUMNS}
       FROM users
       WHERE username = $1
       LIMIT 1`,
      [username],
      { name: 'users-repo-find-by-username', retryable: true }
    );
    return mapUserRow(result.rows[0] || null);
  }

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

  async function setSpotifyAuth(userId, token) {
    const result = await db.raw(
      `UPDATE users
       SET spotify_auth = $1,
           updated_at = NOW()
       WHERE _id = $2`,
      [token, userId],
      { name: 'users-repo-set-spotify-auth' }
    );
    return result.rowCount;
  }

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

  async function setTidalAuth(userId, token, countryCode = null) {
    const result = await db.raw(
      `UPDATE users
       SET tidal_auth = $1,
           tidal_country = $2,
           updated_at = NOW()
       WHERE _id = $3`,
      [token, countryCode, userId],
      { name: 'users-repo-set-tidal-auth' }
    );
    return result.rowCount;
  }

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
    findByUsername,
    findByResetToken,
    setResetToken,
    resetPasswordByToken,
    updateLastActivity,
    setSpotifyAuth,
    clearSpotifyAuth,
    setTidalAuth,
    clearTidalAuth,
    setLastfmAuth,
    clearLastfmAuth,
  };
}

module.exports = {
  createUsersRepository,
  mapUserRow,
  USER_SELECT_COLUMNS,
};
