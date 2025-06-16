const path = require('path');
const fs = require('fs');
const Datastore = require('@seald-io/nedb');
const promisifyDatastore = require('../db-utils');
const { PgDatastore, Pool, waitForPostgres } = require('./postgres');
const { migrateIfNeeded } = require('../scripts/migrate-to-postgres');

const dataDir = process.env.DATA_DIR || './data';
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
console.log('Initializing database layer');

let users, lists, usersAsync, listsAsync;
let ready = Promise.resolve();

if (process.env.DATABASE_URL) {
  console.log('Using PostgreSQL backend');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const usersMap = {
    _id: '_id',
    email: 'email',
    username: 'username',
    hash: 'hash',
    accentColor: 'accent_color',
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
    .then(() => migrateIfNeeded({ pool, dataDir }))
    .then(() => console.log('Database ready')); 
} else {
  console.log('Using NeDB data directory:', dataDir);
  users = new Datastore({ filename: path.join(dataDir, 'users.db'), autoload: true });
  lists = new Datastore({ filename: path.join(dataDir, 'lists.db'), autoload: true });
  usersAsync = promisifyDatastore(users);
  listsAsync = promisifyDatastore(lists);
  lists.ensureIndex({ fieldName: 'userId' });
  lists.ensureIndex({ fieldName: 'name' });
}

module.exports = { users, lists, usersAsync, listsAsync, dataDir, ready };
