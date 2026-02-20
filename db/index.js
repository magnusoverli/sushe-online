const MigrationManager = require('./migrations');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const {
  PgDatastore,
  Pool,
  waitForPostgres,
  warmConnections,
} = require('./postgres');
const logger = require('../utils/logger');
const { setPoolReference } = require('../utils/metrics');

async function ensureTables(pool) {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    _id TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    username TEXT UNIQUE,
    hash TEXT,
    accent_color TEXT,
    time_format TEXT,
    date_format TEXT,
    last_selected_list TEXT,
    role TEXT,
    admin_granted_at TIMESTAMPTZ,
    spotify_auth JSONB,
    tidal_auth JSONB,
    tidal_country TEXT,
    music_service TEXT,
    reset_token TEXT,
    reset_expires BIGINT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    last_activity TIMESTAMPTZ
  )`);
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_granted_at TIMESTAMPTZ`
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ`
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS time_format TEXT`
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS date_format TEXT`
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS music_service TEXT`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_users_reset_token_expires ON users(reset_token, reset_expires)`
  );
  await pool.query(`CREATE TABLE IF NOT EXISTS lists (
    id SERIAL PRIMARY KEY,
    _id TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data JSONB,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    CONSTRAINT unique_user_name UNIQUE(user_id, name)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS list_items (
    id SERIAL PRIMARY KEY,
    _id TEXT UNIQUE NOT NULL,
    list_id TEXT NOT NULL REFERENCES lists(_id) ON DELETE CASCADE,
    position INT,
    artist TEXT,
    album TEXT,
    album_id TEXT,
    release_date TEXT,
    country TEXT,
    genre_1 TEXT,
    genre_2 TEXT,
    comments TEXT,
    tracks JSONB,
    track_pick TEXT,
    cover_image TEXT,
    cover_image_format TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
  )`);
  await pool.query(
    `ALTER TABLE list_items ADD COLUMN IF NOT EXISTS tracks JSONB`
  );
  await pool.query(
    `ALTER TABLE list_items ADD COLUMN IF NOT EXISTS track_pick TEXT`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_list_items_list_id ON list_items(list_id)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_list_items_album_id ON list_items(album_id)`
  );

  await pool.query(`CREATE TABLE IF NOT EXISTS albums (
    id SERIAL PRIMARY KEY,
    album_id TEXT UNIQUE NOT NULL,
    artist TEXT,
    album TEXT,
    release_date TEXT,
    country TEXT,
    genre_1 TEXT,
    genre_2 TEXT,
    tracks JSONB,
    cover_image TEXT,
    cover_image_format TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
  )`);
  // Handle legacy column from early migrations
  const legacyCheck = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='albums' AND column_name='_id'`
  );
  if (legacyCheck.rowCount) {
    const albumIdExists = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='albums' AND column_name='album_id'`
    );
    if (!albumIdExists.rowCount) {
      await pool.query('ALTER TABLE albums RENAME COLUMN _id TO album_id');
    } else {
      await pool.query('ALTER TABLE albums DROP COLUMN _id');
    }
  }
  await pool.query(
    `ALTER TABLE albums ADD COLUMN IF NOT EXISTS album_id TEXT UNIQUE`
  );
  await pool.query(`ALTER TABLE albums ADD COLUMN IF NOT EXISTS artist TEXT`);
  await pool.query(`ALTER TABLE albums ADD COLUMN IF NOT EXISTS album TEXT`);
  await pool.query(
    `ALTER TABLE albums ADD COLUMN IF NOT EXISTS release_date TEXT`
  );
  await pool.query(`ALTER TABLE albums ADD COLUMN IF NOT EXISTS country TEXT`);
  await pool.query(`ALTER TABLE albums ADD COLUMN IF NOT EXISTS genre_1 TEXT`);
  await pool.query(`ALTER TABLE albums ADD COLUMN IF NOT EXISTS genre_2 TEXT`);
  await pool.query(`ALTER TABLE albums ADD COLUMN IF NOT EXISTS tracks JSONB`);
  await pool.query(
    `ALTER TABLE albums ADD COLUMN IF NOT EXISTS cover_image TEXT`
  );
  await pool.query(
    `ALTER TABLE albums ADD COLUMN IF NOT EXISTS cover_image_format TEXT`
  );
  await pool.query(
    `ALTER TABLE albums ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`
  );
  await pool.query(
    `ALTER TABLE albums ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`
  );
}

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
    acquireTimeoutMillis: 5000, // 5 seconds - prevent cascade failures
    keepAlive: true, // Enable TCP keep-alive
    keepAliveInitialDelayMillis: 60000, // 60 seconds - less aggressive keep-alive probing
    statement_timeout: 60000, // 60 seconds for complex queries
    query_timeout: 60000, // 60 seconds query timeout
    allowExitOnIdle: false, // Don't exit when idle
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
    preferredUi: 'preferred_ui',
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
  async function migrateUsers() {
    try {
      // Run user migrations in parallel for better performance
      await Promise.all([
        users.update(
          { accentColor: { $exists: false } },
          { $set: { accentColor: '#dc2626' } },
          { multi: true }
        ),
        users.update(
          { timeFormat: { $exists: false } },
          { $set: { timeFormat: '24h' } },
          { multi: true }
        ),
        users.update(
          { dateFormat: { $exists: false } },
          { $set: { dateFormat: 'MM/DD/YYYY' } },
          { multi: true }
        ),
        users.update(
          { spotifyAuth: { $exists: false } },
          { $set: { spotifyAuth: null } },
          { multi: true }
        ),
        users.update(
          { tidalAuth: { $exists: false } },
          { $set: { tidalAuth: null } },
          { multi: true }
        ),
        users.update(
          { tidalCountry: { $exists: false } },
          { $set: { tidalCountry: null } },
          { multi: true }
        ),
        users.update(
          { musicService: { $exists: false } },
          { $set: { musicService: null } },
          { multi: true }
        ),
      ]);
    } catch (err) {
      logger.error('User migration error', {
        error: err.message,
        stack: err.stack,
      });
    }
  }
  async function migrateLists() {
    // Legacy migration function - no longer needed.
    // This used to migrate data from lists.data JSONB column to list_items table.
    // Album metadata columns have been removed from list_items (migration 042).
    // This function is kept as a no-op for backward compatibility.
  }

  async function migrateAlbums() {
    // Legacy migration function - no longer needed.
    // Album metadata columns have been removed from list_items (migration 042).
    // All album data now lives exclusively in the albums table.
    // This function is kept as a no-op for backward compatibility.
  }

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
      logger.info('Creating tables (legacy)...');
      return ensureTables(pool);
    })
    .then(() => {
      logger.info('Migrating lists...');
      return migrateLists();
    })
    .then(() => {
      logger.info('Migrating albums...');
      return migrateAlbums();
    })
    .then(() => {
      logger.info('Migrating users...');
      return migrateUsers();
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
  dataDir,
  ready,
  pool,
};
