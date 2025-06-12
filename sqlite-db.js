const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR || './data';
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'database.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  username TEXT,
  hash TEXT,
  spotifyAuth TEXT,
  tidalAuth TEXT,
  tidalCountry TEXT,
  accentColor TEXT,
  lastSelectedList TEXT,
  role TEXT,
  resetToken TEXT,
  resetExpires INTEGER,
  adminGrantedAt TEXT,
  createdAt TEXT,
  updatedAt TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  userId TEXT,
  name TEXT,
  data TEXT,
  createdAt TEXT,
  updatedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_lists_userId ON lists(userId);
CREATE INDEX IF NOT EXISTS idx_lists_name ON lists(name);
`);

function parseRow(row, table) {
  if (!row) return null;
  const obj = { ...row, _id: row.id };
  delete obj.id;
  if (obj.spotifyAuth) try { obj.spotifyAuth = JSON.parse(obj.spotifyAuth); } catch {}
  if (obj.tidalAuth) try { obj.tidalAuth = JSON.parse(obj.tidalAuth); } catch {}
  if (table === 'lists' && obj.data) try { obj.data = JSON.parse(obj.data); } catch {}
  return obj;
}

function buildWhere(query) {
  const clauses = [];
  const params = {};
  let i = 0;
  for (const [key, val] of Object.entries(query || {})) {
    const column = key === '_id' ? 'id' : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if ('$gt' in val) {
        i++; const p = 'p' + i; clauses.push(`${column} > @${p}`); params[p] = val.$gt;
      } else if ('$exists' in val) {
        clauses.push(val.$exists ? `${column} IS NOT NULL` : `${column} IS NULL`);
      } else {
        i++; const p = 'p' + i; clauses.push(`${column} = @${p}`); params[p] = JSON.stringify(val);
      }
    } else {
      i++; const p = 'p' + i; clauses.push(`${column} = @${p}`); params[p] = val;
    }
  }
  if (!clauses.length) return { where: '1', params: {} };
  return { where: clauses.join(' AND '), params };
}

class Collection {
  constructor(table) { this.table = table; }
  findOne(query, cb) {
    try {
      const { where, params } = buildWhere(query);
      const row = db.prepare(`SELECT * FROM ${this.table} WHERE ${where} LIMIT 1`).get(params);
      cb(null, parseRow(row, this.table));
    } catch (e) { cb(e); }
  }
  find(query, cb) {
    try {
      const { where, params } = buildWhere(query);
      const rows = db.prepare(`SELECT * FROM ${this.table} WHERE ${where}`).all(params).map(r => parseRow(r, this.table));
      cb(null, rows);
    } catch (e) { cb(e); }
  }
  count(query, cb) {
    try {
      const { where, params } = buildWhere(query);
      const c = db.prepare(`SELECT COUNT(*) as c FROM ${this.table} WHERE ${where}`).get(params).c;
      cb(null, c);
    } catch (e) { cb(e); }
  }
  insert(doc, cb) {
    try {
      if (!doc._id) doc._id = crypto.randomUUID();
      const row = { ...doc, id: doc._id };
      delete row._id;
      if (row.spotifyAuth) row.spotifyAuth = JSON.stringify(row.spotifyAuth);
      if (row.tidalAuth) row.tidalAuth = JSON.stringify(row.tidalAuth);
      if (this.table === 'lists') row.data = JSON.stringify(row.data || []);
      const cols = Object.keys(row);
      const placeholders = cols.map(c => `@${c}`).join(',');
      const stmt = db.prepare(`INSERT INTO ${this.table} (${cols.join(',')}) VALUES (${placeholders})`);
      stmt.run(row);
      cb(null, doc);
    } catch (e) { cb(e); }
  }
  update(query, update, options, cb) {
    try {
      const { where, params } = buildWhere(query);
      const sets = [];
      const runParams = { ...params };
      if (update.$set) {
        for (const [k, v] of Object.entries(update.$set)) {
          sets.push(`${k}=@set_${k}`);
          runParams[`set_${k}`] = (k === 'spotifyAuth' || k === 'tidalAuth' || k === 'data') ? JSON.stringify(v) : v;
        }
      }
      if (update.$unset) {
        for (const k of Object.keys(update.$unset)) {
          sets.push(`${k}=NULL`);
        }
      }
      const sql = `UPDATE ${this.table} SET ${sets.join(', ')} WHERE ${where}`;
      const info = db.prepare(sql).run(runParams);
      cb(null, info.changes);
    } catch (e) { cb(e); }
  }
  remove(query, options, cb) {
    try {
      const { where, params } = buildWhere(query);
      const info = db.prepare(`DELETE FROM ${this.table} WHERE ${where}`).run(params);
      cb(null, info.changes);
    } catch (e) { cb(e); }
  }
}

function insertUser(doc) { new Collection('users').insert(doc, () => {}); }
function insertList(doc) { new Collection('lists').insert(doc, () => {}); }

function migrateFromNeDB() {
  try {
    const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const usersDb = path.join(dataDir, 'users.db');
    const listsDb = path.join(dataDir, 'lists.db');
    if (count > 0 || !fs.existsSync(usersDb) || !fs.existsSync(listsDb)) return;
    console.log('Migrating NeDB data to SQLite...');
    const userLines = fs.readFileSync(usersDb, 'utf8').split('\n').filter(Boolean);
    for (const line of userLines) {
      if (line.startsWith('{"$$indexCreated"')) continue;
      const doc = JSON.parse(line);
      insertUser(doc);
    }
    const listLines = fs.readFileSync(listsDb, 'utf8').split('\n').filter(Boolean);
    for (const line of listLines) {
      if (line.startsWith('{"$$indexCreated"')) continue;
      const doc = JSON.parse(line);
      insertList(doc);
    }
    fs.renameSync(usersDb, usersDb + '.bak');
    fs.renameSync(listsDb, listsDb + '.bak');
    console.log('Migration complete. Original NeDB files renamed with .bak');
  } catch (err) {
    console.error('Migration from NeDB failed:', err);
  }
}

migrateFromNeDB();

module.exports = {
  users: new Collection('users'),
  lists: new Collection('lists')
};
