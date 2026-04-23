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
