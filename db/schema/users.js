const { USERS_FIELD_MAP } = require('./table-maps');

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

/**
 * Raw `users` row exactly as `SELECT ${USER_SELECT_COLUMNS}` returns it, i.e.
 * snake_case column names straight from node-postgres. Nullability mirrors the
 * migration-owned schema: `_id`/`email`/`username`/`hash` are NOT NULL
 * (001_initial_schema), every other selected column is nullable.
 *
 * The JSONB columns (`spotify_auth`, `tidal_auth`, `lastfm_auth`,
 * `column_visibility`) are provider/UI-owned blobs, so they are kept as broad
 * objects here — the same treatment `User` in db/types.js gives them.
 *
 * @typedef {Object} UserRow
 * @property {string} _id TEXT, the app-level id (not the SERIAL `id`).
 * @property {string} email
 * @property {string} username
 * @property {string} hash
 * @property {string|null} accent_color
 * @property {string|null} time_format
 * @property {string|null} date_format
 * @property {string|null} last_selected_list
 * @property {string|null} role
 * @property {Date|null} admin_granted_at TIMESTAMPTZ.
 * @property {Object|null} spotify_auth JSONB OAuth blob.
 * @property {Object|null} tidal_auth JSONB OAuth blob.
 * @property {string|null} tidal_country
 * @property {string|null} music_service
 * @property {string|null} reset_token
 * @property {string|number|null} reset_expires BIGINT epoch ms (066_align_fresh_schema_with_prod);
 *   node-postgres hands BIGINT back as a string unless a type parser is installed.
 * @property {Date|null} created_at TIMESTAMPTZ.
 * @property {Date|null} updated_at TIMESTAMPTZ.
 * @property {Date|null} last_activity TIMESTAMPTZ.
 * @property {Object|null} lastfm_auth JSONB session blob.
 * @property {string|null} lastfm_username
 * @property {Date|null} list_setup_dismissed_until TIMESTAMPTZ.
 * @property {string|null} approval_status VARCHAR(20).
 * @property {Object|null} column_visibility JSONB.
 */

/**
 * Convert a raw `users` row into the camelCase shape the app consumes
 * (`User` in db/types.js). Callers pass `result.rows[0] || null`, so the
 * nullish input is expected and mapped to `null`.
 *
 * @param {UserRow|null|undefined} row
 */
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

module.exports = {
  USERS_FIELD_MAP,
  USER_SELECT_COLUMNS,
  mapUserRow,
};
