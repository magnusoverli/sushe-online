const USERS_FIELD_MAP = {
  _id: '_id',
  email: 'email',
  username: 'username',
  hash: 'hash',
  accentColor: 'accent_color',
  timeFormat: 'time_format',
  dateFormat: 'date_format',
  lastSelectedList: 'last_selected_list',
  role: 'role',
  adminGrantedAt: 'admin_granted_at',
  spotifyAuth: 'spotify_auth',
  tidalAuth: 'tidal_auth',
  tidalCountry: 'tidal_country',
  musicService: 'music_service',
  resetToken: 'reset_token',
  resetExpires: 'reset_expires',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  lastActivity: 'last_activity',
  lastfmAuth: 'lastfm_auth',
  listSetupDismissedUntil: 'list_setup_dismissed_until',
  lastfmUsername: 'lastfm_username',
  approvalStatus: 'approval_status',
  columnVisibility: 'column_visibility',
};

const LISTS_FIELD_MAP = {
  _id: '_id',
  userId: 'user_id',
  name: 'name',
  data: 'data',
  year: 'year',
  isMain: 'is_main',
  groupId: 'group_id',
  sortOrder: 'sort_order',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const LIST_ITEMS_FIELD_MAP = {
  _id: '_id',
  listId: 'list_id',
  position: 'position',
  albumId: 'album_id',
  comments: 'comments',
  comments2: 'comments_2',
  primaryTrack: 'primary_track',
  secondaryTrack: 'secondary_track',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const ALBUMS_FIELD_MAP = {
  _id: 'id',
  albumId: 'album_id',
  artist: 'artist',
  album: 'album',
  releaseDate: 'release_date',
  country: 'country',
  genre1: 'genre_1',
  genre2: 'genre_2',
  tracks: 'tracks',
  coverImage: 'cover_image',
  coverImageFormat: 'cover_image_format',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const LIST_GROUPS_FIELD_MAP = {
  _id: '_id',
  userId: 'user_id',
  name: 'name',
  year: 'year',
  sortOrder: 'sort_order',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

module.exports = {
  USERS_FIELD_MAP,
  LISTS_FIELD_MAP,
  LIST_ITEMS_FIELD_MAP,
  ALBUMS_FIELD_MAP,
  LIST_GROUPS_FIELD_MAP,
};
