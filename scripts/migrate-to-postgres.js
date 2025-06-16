const path = require('path');
const fs = require('fs');
const Datastore = require('@seald-io/nedb');
const { Pool } = require('../db/postgres');
const promisifyDatastore = require('../db-utils');

async function ensureTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    _id TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    username TEXT UNIQUE,
    hash TEXT,
    accent_color TEXT,
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

async function migrate({ pool, dataDir }) {
  const usersDb = new Datastore({ filename: path.join(dataDir, 'users.db'), autoload: true });
  const listsDb = new Datastore({ filename: path.join(dataDir, 'lists.db'), autoload: true });
  const usersAsync = promisifyDatastore(usersDb);
  const listsAsync = promisifyDatastore(listsDb);

  await ensureTables(pool);
  const users = await usersAsync.find({});
  for (const user of users) {
    await pool.query(
      `INSERT INTO users (_id,email,username,hash,accent_color,last_selected_list,role,spotify_auth,tidal_auth,tidal_country,reset_token,reset_expires,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (_id) DO NOTHING`,
      [
        user._id,
        user.email,
        user.username,
        user.hash,
        user.accentColor,
        user.lastSelectedList,
        user.role || null,
        JSON.stringify(user.spotifyAuth),
        JSON.stringify(user.tidalAuth),
        user.tidalCountry,
        user.resetToken,
        user.resetExpires,
        user.createdAt ? new Date(user.createdAt) : null,
        user.updatedAt ? new Date(user.updatedAt) : null
      ]
    );
  }

  const lists = await listsAsync.find({});
  for (const list of lists) {
    await pool.query(
      `INSERT INTO lists (_id,user_id,name,data,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (_id) DO NOTHING`,
      [
        list._id,
        list.userId,
        list.name,
        JSON.stringify(list.data),
        list.createdAt ? new Date(list.createdAt) : null,
        list.updatedAt ? new Date(list.updatedAt) : null
      ]
    );
  }
}

async function migrateIfNeeded({ pool, dataDir }) {
  await ensureTables(pool);
  const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM users');
  const pgCount = parseInt(rows[0].cnt, 10);
  if (pgCount > 0) {
    return; // already migrated
  }

  // Check if NeDB has any users to migrate
  if (!fs.existsSync(path.join(dataDir, 'users.db'))) return;
  const usersDb = new Datastore({ filename: path.join(dataDir, 'users.db'), autoload: true });
  const usersAsync = promisifyDatastore(usersDb);
  const nedbCount = await usersAsync.count({});
  if (nedbCount === 0) return;

  await migrate({ pool, dataDir });
  console.log('Migration complete');
}

module.exports = { migrateIfNeeded };

if (require.main === module) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const pool = new Pool({ connectionString });
  migrateIfNeeded({ pool, dataDir: process.env.DATA_DIR || './data' })
    .then(() => pool.end())
    .catch(err => {
      console.error('Migration failed', err);
      pool.end().finally(() => process.exit(1));
    });
}
