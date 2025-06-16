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
    date_format TEXT,
    last_selected_list TEXT,
    role TEXT,
    spotify_auth JSONB,
    tidal_auth JSONB,
    tidal_country TEXT,
    reset_token TEXT,
    reset_expires BIGINT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
  )`);
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS date_format TEXT');
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
}

const dataDir = process.env.DATA_DIR || './data';
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
console.log('Initializing database layer');

let users, lists, usersAsync, listsAsync, pool;
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
    dateFormat: 'date_format',
    lastSelectedList: 'last_selected_list',
    role: 'role',
    spotifyAuth: 'spotify_auth',
    tidalAuth: 'tidal_auth',
    tidalCountry: 'tidal_country',
    resetToken: 'reset_token',
    resetExpires: 'reset_expires',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  };
  const listsMap = {
    _id: '_id',
    userId: 'user_id',
    name: 'name',
    data: 'data',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  };
  users = new PgDatastore(pool, 'users', usersMap);
  lists = new PgDatastore(pool, 'lists', listsMap);
  usersAsync = users;
  listsAsync = lists;
  ready = waitForPostgres(pool)
    .then(() => ensureTables(pool))
    .then(() => console.log('Database ready'));
} else {
  throw new Error('DATABASE_URL must be set');
}

module.exports = { users, lists, usersAsync, listsAsync, dataDir, ready, pool };
