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
  masterLists,
  usersAsync,
  listsAsync,
  listItemsAsync,
  albumsAsync,
  masterListsAsync,
  pool;
let ready = Promise.resolve();

if (process.env.DATABASE_URL) {
  logger.info('Using PostgreSQL backend');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 30, // Increase max connections for better performance with more resources
    min: 10, // Keep more connections warm for faster response
    idleTimeoutMillis: 600000, // 10 minutes - longer idle timeout for stability
    connectionTimeoutMillis: 5000, // 5 seconds - more reasonable for production
    acquireTimeoutMillis: 5000, // 5 seconds - prevent cascade failures
    keepAlive: true, // Enable TCP keep-alive
    keepAliveInitialDelayMillis: 10000, // 10 second initial delay for keep-alive
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
  };
  const listsMap = {
    _id: '_id',
    userId: 'user_id',
    name: 'name',
    data: 'data',
    year: 'year',
    isOfficial: 'is_official',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  };
  const listItemsMap = {
    _id: '_id',
    listId: 'list_id',
    position: 'position',
    artist: 'artist',
    album: 'album',
    albumId: 'album_id',
    releaseDate: 'release_date',
    country: 'country',
    genre1: 'genre_1',
    genre2: 'genre_2',
    comments: 'comments',
    tracks: 'tracks',
    trackPick: 'track_pick',
    coverImage: 'cover_image',
    coverImageFormat: 'cover_image_format',
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
  const masterListsMap = {
    _id: 'id',
    year: 'year',
    revealed: 'revealed',
    revealedAt: 'revealed_at',
    computedAt: 'computed_at',
    data: 'data',
    stats: 'stats',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  };
  users = new PgDatastore(pool, 'users', usersMap);
  lists = new PgDatastore(pool, 'lists', listsMap);
  listItems = new PgDatastore(pool, 'list_items', listItemsMap);
  albums = new PgDatastore(pool, 'albums', albumsMap);
  masterLists = new PgDatastore(pool, 'master_lists', masterListsMap);
  usersAsync = users;
  listsAsync = lists;
  listItemsAsync = listItems;
  albumsAsync = albums;
  masterListsAsync = masterLists;
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
      logger.error('User migration error:', err);
    }
  }
  async function migrateLists() {
    try {
      // Check if data column exists (for legacy migration)
      const columnCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'lists' AND column_name = 'data'
      `);

      if (columnCheck.rows.length === 0) {
        logger.info(
          'No legacy data column found in lists table, skipping migration'
        );
        return;
      }

      const listsRes = await pool.query('SELECT _id, data FROM lists');
      for (const row of listsRes.rows) {
        const countRes = await pool.query(
          'SELECT COUNT(*) FROM list_items WHERE list_id=$1',
          [row._id]
        );
        if (
          parseInt(countRes.rows[0].count, 10) === 0 &&
          Array.isArray(row.data)
        ) {
          for (let i = 0; i < row.data.length; i++) {
            const album = row.data[i];
            await pool.query(
              `INSERT INTO list_items (_id, list_id, position, artist, album, album_id, release_date, country, genre_1, genre_2, comments, tracks, track_pick, cover_image, cover_image_format, created_at, updated_at)
               VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())`,
              [
                row._id,
                i + 1,
                album.artist || '',
                album.album || '',
                album.album_id || '',
                album.release_date || '',
                album.country || '',
                album.genre_1 || album.genre || '',
                album.genre_2 || '',
                album.comments || album.comment || '',
                Array.isArray(album.tracks) ? album.tracks : null,
                album.track_pick || null,
                album.cover_image || '',
                album.cover_image_format || '',
              ]
            );
          }
          await pool.query('UPDATE lists SET data = NULL WHERE _id=$1', [
            row._id,
          ]);
        }
      }
    } catch (err) {
      logger.error('List migration error:', err);
    }
  }

  async function migrateAlbums() {
    const itemsRes = await pool.query(
      'SELECT DISTINCT album_id, artist, album, release_date, country, genre_1, genre_2, tracks, cover_image, cover_image_format FROM list_items'
    );
    for (const row of itemsRes.rows) {
      if (!row.album_id) continue;
      const existing = await albums.findOne({ albumId: row.album_id });
      if (!existing) {
        await albums.insert({
          albumId: row.album_id,
          artist: row.artist || '',
          album: row.album || '',
          releaseDate: row.release_date || '',
          country: row.country || '',
          genre1: row.genre_1 || '',
          genre2: row.genre_2 || '',
          tracks: row.tracks || null,
          coverImage: row.cover_image || '',
          coverImageFormat: row.cover_image_format || '',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }
  }

  async function ensureAdminUser() {
    try {
      logger.info('Checking for admin user...');
      const existingAdmin = await users.findOne({ username: 'admin' });
      logger.info('Existing admin user found:', { exists: !!existingAdmin });

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
          admin_granted_at: new Date(),
          music_service: null,
          created_at: new Date(),
          updated_at: new Date(),
          last_activity: new Date(),
        });
        logger.info('Created admin user successfully:', {
          userId: newUser._id,
        });
        logger.info('Admin login: email=admin@localhost.com, password=admin');

        // Verify we can find the user by email
        const verifyUser = await users.findOne({
          email: 'admin@localhost.com',
        });
        logger.info('Verification - can find admin by email:', {
          found: !!verifyUser,
        });
      } else {
        logger.info('Admin user already exists with email:', {
          email: existingAdmin.email,
        });
      }
    } catch (err) {
      logger.error('Error creating admin user:', err);
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
    .then(() => logger.info('Database ready'))
    .catch((err) => {
      logger.error('Database initialization error:', err);
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
  masterLists,
  usersAsync,
  listsAsync,
  listItemsAsync,
  albumsAsync,
  masterListsAsync,
  dataDir,
  ready,
  pool,
};
