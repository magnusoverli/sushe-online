const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function buildWhere(query) {
  if (!query || Object.keys(query).length === 0) return { clause: '1', params: {} };
  const clauses = [];
  const params = {};
  for (const [key, val] of Object.entries(query)) {
    if (val && typeof val === 'object') {
      if ('$ne' in val) {
        clauses.push(`${key} != @${key}`);
        params[key] = val.$ne;
      } else if ('$gt' in val) {
        clauses.push(`${key} > @${key}`);
        params[key] = val.$gt;
      } else if ('$exists' in val) {
        clauses.push(val.$exists ? `${key} IS NOT NULL` : `${key} IS NULL`);
      }
    } else {
      clauses.push(`${key} = @${key}`);
      params[key] = val;
    }
  }
  return { clause: clauses.join(' AND '), params };
}

class SQLiteStore {
  constructor(db, table, columns, jsonFields=[]) {
    this.db = db;
    this.table = table;
    this.columns = columns;
    this.jsonFields = new Set(jsonFields);
  }

  parseRow(row) {
    if (!row) return null;
    for (const f of this.jsonFields) {
      if (row[f]) {
        try { row[f] = JSON.parse(row[f]); } catch {}
      }
    }
    return row;
  }

  rowFromDoc(doc) {
    const row = {};
    for (const col of this.columns) {
      let val = doc[col];
      if (val === undefined) val = null;
      if (val !== null && this.jsonFields.has(col)) {
        val = JSON.stringify(val);
      }
      row[col] = val;
    }
    return row;
  }

  findOne(query, cb) {
    try {
      const { clause, params } = buildWhere(query);
      const row = this.db.prepare(`SELECT * FROM ${this.table} WHERE ${clause} LIMIT 1`).get(params);
      cb(null, this.parseRow(row));
    } catch (e) { cb(e); }
  }

  find(query, cb) {
    try {
      const { clause, params } = buildWhere(query);
      const rows = this.db.prepare(`SELECT * FROM ${this.table} WHERE ${clause}`).all(params).map(r => this.parseRow(r));
      cb(null, rows);
    } catch (e) { cb(e); }
  }

  count(query, cb) {
    try {
      const { clause, params } = buildWhere(query);
      const row = this.db.prepare(`SELECT COUNT(*) as c FROM ${this.table} WHERE ${clause}`).get(params);
      cb(null, row.c);
    } catch (e) { cb(e); }
  }

  insert(doc, cb) {
    try {
      if (!doc._id) doc._id = crypto.randomBytes(12).toString('hex');
      const row = this.rowFromDoc(doc);
      const cols = Object.keys(row).join(',');
      const placeholders = Object.keys(row).map(k => '@' + k).join(',');
      this.db.prepare(`INSERT INTO ${this.table} (${cols}) VALUES (${placeholders})`).run(row);
      cb(null, doc);
    } catch (e) { cb(e); }
  }

  update(query, update, options={}, cb) {
    try {
      this.find(query, (err, docs) => {
        if (err) return cb(err);
        if (!options.multi) docs = docs.slice(0,1);
        let count = 0;
        for (let doc of docs) {
          if (update.$set) {
            for (const [k,v] of Object.entries(update.$set)) {
              doc[k] = v;
            }
          }
          if (update.$unset) {
            for (const k of Object.keys(update.$unset)) {
              doc[k] = null;
            }
          }
          const row = this.rowFromDoc(doc);
          const sets = Object.keys(row).filter(k=>k!=="_id").map(k=>`${k}=@${k}`).join(',');
          this.db.prepare(`UPDATE ${this.table} SET ${sets} WHERE _id=@_id`).run(row);
          count++;
        }
        cb(null, count);
      });
    } catch (e) { cb(e); }
  }

  remove(query, options={}, cb) {
    try {
      const { clause, params } = buildWhere(query);
      const info = this.db.prepare(`DELETE FROM ${this.table} WHERE ${clause}`).run(params);
      cb(null, info.changes);
    } catch (e) { cb(e); }
  }
}

function initSQLite(dataDir) {
  ensureDir(dataDir);
  const dbPath = path.join(dataDir, 'sushe.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`CREATE TABLE IF NOT EXISTS users (
    _id TEXT PRIMARY KEY,
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
    createdAt TEXT,
    updatedAt TEXT,
    adminGrantedAt TEXT
  );`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);`);

  db.exec(`CREATE TABLE IF NOT EXISTS lists (
    _id TEXT PRIMARY KEY,
    userId TEXT,
    name TEXT,
    data TEXT,
    createdAt TEXT,
    updatedAt TEXT
  );`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(userId);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lists_name ON lists(name);`);

  const usersStore = new SQLiteStore(db, 'users', ['_id','email','username','hash','spotifyAuth','tidalAuth','tidalCountry','accentColor','lastSelectedList','role','resetToken','resetExpires','createdAt','updatedAt','adminGrantedAt'], ['spotifyAuth','tidalAuth']);
  const listsStore = new SQLiteStore(db, 'lists', ['_id','userId','name','data','createdAt','updatedAt'], ['data']);

  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const oldUsersFile = path.join(dataDir, 'users.db');
  const oldListsFile = path.join(dataDir, 'lists.db');
  if (userCount === 0 && (fs.existsSync(oldUsersFile) || fs.existsSync(oldListsFile))) {
    console.log('Migrating NeDB data to SQLite...');
    const readNeDB = (p) =>
      fs.readFileSync(p, 'utf8').split(/\n/).filter(Boolean).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    if (fs.existsSync(oldUsersFile)) {
      for (const doc of readNeDB(oldUsersFile)) usersStore.insert(doc, ()=>{});
    }
    if (fs.existsSync(oldListsFile)) {
      for (const doc of readNeDB(oldListsFile)) listsStore.insert(doc, ()=>{});
    }
    console.log('Migration complete');
  }

  return { users: usersStore, lists: listsStore };
}

module.exports = initSQLite;
