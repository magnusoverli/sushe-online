const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { saveRefreshedToken } = require('../../db/repositories/oauth-refresh');

test('rotated OAuth persistence cannot resurrect a disconnected or reconnected provider', async () => {
  assert.ok(process.env.DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = { raw: (sql, params) => pool.query(sql, params) };
  const id = randomUUID();
  const original = { access_token: 'old', refresh_token: 'original' };
  const rotated = { access_token: 'new', refresh_token: 'rotated' };
  try {
    await pool.query(
      'INSERT INTO users (_id,email,username,hash,spotify_auth) VALUES ($1,$2,$3,$4,$5)',
      [
        id,
        `${id}@oauth.test`,
        id,
        'synthetic-non-login-hash',
        JSON.stringify(original),
      ]
    );
    assert.equal(
      await saveRefreshedToken(db, id, 'spotifyAuth', rotated, 'original'),
      true
    );
    assert.equal(
      await saveRefreshedToken(db, id, 'spotifyAuth', original, 'original'),
      false
    );
    await pool.query('UPDATE users SET spotify_auth=NULL WHERE _id=$1', [id]);
    assert.equal(
      await saveRefreshedToken(db, id, 'spotifyAuth', rotated, 'rotated'),
      false
    );
    await pool.query('UPDATE users SET spotify_auth=$2 WHERE _id=$1', [
      id,
      JSON.stringify({ refresh_token: 'reconnected' }),
    ]);
    assert.equal(
      await saveRefreshedToken(db, id, 'spotifyAuth', rotated, 'rotated'),
      false
    );
    assert.deepEqual(
      (await pool.query('SELECT spotify_auth FROM users WHERE _id=$1', [id]))
        .rows[0].spotify_auth,
      { refresh_token: 'reconnected' }
    );
  } finally {
    await pool.query('DELETE FROM users WHERE _id=$1', [id]);
    await pool.end();
  }
});
