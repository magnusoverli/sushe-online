const path = require('path');
const fs = require('fs');
const { PgDatastore, Pool, waitForPostgres } = require('./postgres');

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
    reset_token TEXT,
    reset_expires BIGINT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    last_activity TIMESTAMPTZ
  )`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_granted_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS time_format TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS date_format TEXT`);
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
    cover_image TEXT,
    cover_image_format TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
  )`);
  await pool.query(`ALTER TABLE list_items ADD COLUMN IF NOT EXISTS tracks JSONB`);

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
}

const dataDir = process.env.DATA_DIR || './data';
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
console.log('Initializing database layer');

let users, lists, listItems, albums, usersAsync, listsAsync, listItemsAsync, albumsAsync, pool;
let ready = Promise.resolve();

if (process.env.DATABASE_URL) {
  console.log('Using PostgreSQL backend');
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
    resetToken: 'reset_token',
    resetExpires: 'reset_expires',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    lastActivity: 'last_activity'
  };
  const listsMap = {
    _id: '_id',
    userId: 'user_id',
    name: 'name',
    data: 'data',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
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
    coverImage: 'cover_image',
    coverImageFormat: 'cover_image_format',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  };
  const albumsMap = {
    _id: 'album_id',
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
    updatedAt: 'updated_at'
  };
  users = new PgDatastore(pool, 'users', usersMap);
  lists = new PgDatastore(pool, 'lists', listsMap);
  listItems = new PgDatastore(pool, 'list_items', listItemsMap);
  albums = new PgDatastore(pool, 'albums', albumsMap);
  usersAsync = users;
  listsAsync = lists;
  listItemsAsync = listItems;
  albumsAsync = albums;
  async function migrateUsers() {
    try {
      await users.update(
        { accentColor: { $exists: false } },
        { $set: { accentColor: '#dc2626' } },
        { multi: true }
      );

      await users.update(
        { timeFormat: { $exists: false } },
        { $set: { timeFormat: '24h' } },
        { multi: true }
      );

      await users.update(
        { dateFormat: { $exists: false } },
        { $set: { dateFormat: 'MM/DD/YYYY' } },
        { multi: true }
      );

      await users.update(
        { spotifyAuth: { $exists: false } },
        { $set: { spotifyAuth: null } },
        { multi: true }
      );

      await users.update(
        { tidalAuth: { $exists: false } },
        { $set: { tidalAuth: null } },
        { multi: true }
      );

      await users.update(
        { tidalCountry: { $exists: false } },
        { $set: { tidalCountry: null } },
        { multi: true }
      );
    } catch (err) {
      console.error('User migration error:', err);
    }
  }
  async function migrateLists() {
    const listsRes = await pool.query('SELECT _id, data FROM lists');
    for (const row of listsRes.rows) {
      const countRes = await pool.query('SELECT COUNT(*) FROM list_items WHERE list_id=$1', [row._id]);
      if (parseInt(countRes.rows[0].count, 10) === 0 && Array.isArray(row.data)) {
        for (let i = 0; i < row.data.length; i++) {
          const album = row.data[i];
          await pool.query(
            `INSERT INTO list_items (_id, list_id, position, artist, album, album_id, release_date, country, genre_1, genre_2, comments, tracks, cover_image, cover_image_format, created_at, updated_at)
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
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
              album.cover_image || '',
              album.cover_image_format || ''
            ]
          );
        }
        await pool.query('UPDATE lists SET data = NULL WHERE _id=$1', [row._id]);
      }
    }
  }

  async function migrateAlbums() {
    const itemsRes = await pool.query('SELECT DISTINCT album_id, artist, album, release_date, country, genre_1, genre_2, tracks, cover_image, cover_image_format FROM list_items');
    for (const row of itemsRes.rows) {
      if (!row.album_id) continue;
      const existing = await albums.findOne({ _id: row.album_id });
      if (!existing) {
        await albums.insert({
          _id: row.album_id,
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
          updatedAt: new Date()
        });
      }
    }
  }

  ready = waitForPostgres(pool)
    .then(() => ensureTables(pool))
    .then(() => migrateLists())
    .then(() => migrateAlbums())
    .then(() => migrateUsers())
    .then(() => console.log('Database ready'));
} else {
  throw new Error('DATABASE_URL must be set');
}

module.exports = { users, lists, listItems, albums, usersAsync, listsAsync, listItemsAsync, albumsAsync, dataDir, ready, pool };
