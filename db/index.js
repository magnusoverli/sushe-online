// @ts-check
const MigrationManager = require('./migrations');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const {
  PgDatastore,
  Pool,
  waitForPostgres,
  warmConnections,
} = require('./postgres');
const { drainPool } = require('./close-pool');
const logger = require('../utils/logger');
const { setPoolReference } = require('../utils/metrics');

const dataDir = process.env.DATA_DIR || './data';
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
logger.info('Initializing database layer');

let users,
  lists,
  listItems,
  albums,
  listGroups,
  usersAsync,
  listsAsync,
  listItemsAsync,
  albumsAsync,
  listGroupsAsync,
  db,
  pool;
let ready;

if (process.env.DATABASE_URL) {
  logger.info('Using PostgreSQL backend');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 30, // Maximum connections for burst capacity
    min: 2, // Keep fewer connections warm to reduce idle resource usage
    idleTimeoutMillis: 300000, // 5 minutes - release idle connections sooner
    connectionTimeoutMillis: 5000, // 5 seconds - more reasonable for production
    // Note: acquireTimeoutMillis was previously here but is not a valid pg
    // PoolConfig option — pg uses connectionTimeoutMillis for both connect
    // and acquire. Silently ignored by node-pg, removed for correctness.
    keepAlive: true, // Enable TCP keep-alive
    keepAliveInitialDelayMillis: 60000, // 60 seconds - less aggressive keep-alive probing
    statement_timeout: 60000, // 60 seconds for complex queries
    query_timeout: 60000, // 60 seconds query timeout
    allowExitOnIdle: false, // Don't exit when idle
    application_name: process.env.PG_APP_NAME || 'sushe-online',
  });
  const usersMap = {
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
  const listsMap = {
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
  // Simplified list_items: junction table + user-specific data (comments, track picks)
  // All album metadata comes from canonical albums table
  const listItemsMap = {
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
  const albumsMap = {
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
  // track_picks table removed - track picks now stored in list_items
  const listGroupsMap = {
    _id: '_id',
    userId: 'user_id',
    name: 'name',
    year: 'year',
    sortOrder: 'sort_order',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  };
  users = new PgDatastore(pool, 'users', usersMap);
  lists = new PgDatastore(pool, 'lists', listsMap);
  listItems = new PgDatastore(pool, 'list_items', listItemsMap);
  albums = new PgDatastore(pool, 'albums', albumsMap);
  listGroups = new PgDatastore(pool, 'list_groups', listGroupsMap);
  usersAsync = users;
  listsAsync = lists;
  listItemsAsync = listItems;
  albumsAsync = albums;
  listGroupsAsync = listGroups;
  // Canonical tableless datastore. Exposes only raw/withClient/withTransaction;
  // all services that don't need tabled helpers (findOne/insert/update/...)
  // should receive this via deps.db. Shares the pool with the tabled instances,
  // so logging, metrics, drain-check, and retry apply uniformly.
  db = new PgDatastore(pool);
  async function ensureAdminUser() {
    try {
      logger.info('Checking for admin user...');
      const existingAdmin = await users.findOne({ role: 'admin' });
      logger.info('Existing admin user check', { exists: !!existingAdmin });

      if (!existingAdmin) {
        logger.info('Creating admin user...');
        const hash = await bcrypt.hash('admin', 12);
        const newUser = await users.insert({
          username: 'admin',
          email: 'admin@localhost.com',
          hash: hash,
          accent_color: '#dc2626',
          time_format: '24h',
          date_format: 'MM/DD/YYYY',
          role: 'admin',
          admin_granted_at: new Date(),
          music_service: null,
          created_at: new Date(),
          updated_at: new Date(),
          last_activity: new Date(),
        });
        logger.info('Created admin user successfully', { userId: newUser._id });
        logger.info('Admin login: email=admin@localhost.com, password=admin');

        // Verify we can find the user by email
        const verifyUser = await users.findOne({
          email: 'admin@localhost.com',
        });
        logger.debug('Verification - can find admin by email', {
          found: !!verifyUser,
        });
      } else {
        logger.debug('Admin user already exists', {
          email: existingAdmin.email,
          username: existingAdmin.username,
        });
      }
    } catch (err) {
      logger.error('Error creating admin user', {
        error: err.message,
        stack: err.stack,
      });
    }
  }

  ready = waitForPostgres(pool)
    .then(async () => {
      logger.info('Warming database connections...');
      await warmConnections(pool);
      logger.info('Running database migrations...');
      const migrationManager = new MigrationManager(pool);
      await migrationManager.runMigrations();
      return migrationManager;
    })
    .then(() => {
      logger.info('Ensuring admin user...');
      return ensureAdminUser();
    })
    .then(() => {
      logger.info('Database ready');
      // Register pool reference for pull-based metrics (collected on /metrics scrape)
      setPoolReference(pool);
    })
    .catch((err) => {
      logger.error('Database initialization error', {
        error: err.message,
        stack: err.stack,
      });
      throw err;
    });
} else {
  throw new Error('DATABASE_URL must be set');
}

/**
 * Drain and close the singleton database pool. Idempotent.
 * @param {Object} [opts] - Forwarded to drainPool (e.g. { timeoutMs }).
 * @returns {Promise<{ drained: boolean }>}
 */
let _closed = false;
async function closePool(opts = {}) {
  if (_closed) {
    return { drained: true };
  }
  _closed = true;
  return drainPool(pool, opts);
}

module.exports = {
  users,
  lists,
  listItems,
  albums,
  listGroups,
  usersAsync,
  listsAsync,
  listItemsAsync,
  albumsAsync,
  listGroupsAsync,
  db,
  dataDir,
  ready,
  pool,
  closePool,
};
