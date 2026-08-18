const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { Pool } = require('pg');

describe('GET /api/lists/presence', () => {
  const ids = {
    user: crypto.randomBytes(12).toString('hex'),
    group: crypto.randomBytes(12).toString('hex'),
    list: crypto.randomBytes(12).toString('hex'),
    album: crypto.randomUUID(),
    item: crypto.randomBytes(12).toString('hex'),
  };
  const email = `presence-${ids.user}@test.com`;
  let pool;

  before(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    const hash = await bcrypt.hash('password', 12);
    await pool.query(
      `INSERT INTO users (_id, email, username, hash, role, approval_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'user', 'approved', NOW(), NOW())`,
      [ids.user, email, `presence-${ids.user}`, hash]
    );
    await pool.query(
      `INSERT INTO albums (album_id, artist, album, release_date, created_at, updated_at)
       VALUES ($1, 'Presence Artist', 'Presence Album', '2026', NOW(), NOW())`,
      [ids.album]
    );
    const group = await pool.query(
      `INSERT INTO list_groups (_id, user_id, name, year, sort_order)
       VALUES ($1, $2, 'Presence Group', 2026, 0)
       RETURNING id`,
      [ids.group, ids.user]
    );
    await pool.query(
      `INSERT INTO lists (_id, user_id, name, year, is_main, group_id, sort_order)
       VALUES ($1, $2, 'Presence List', 2026, FALSE, $3, 0)`,
      [ids.list, ids.user, group.rows[0].id]
    );
    await pool.query(
      `INSERT INTO list_items (_id, list_id, album_id, position)
       VALUES ($1, $2, $3, 1)`,
      [ids.item, ids.list, ids.album]
    );
  });

  after(async () => {
    await pool.query('DELETE FROM users WHERE _id = $1', [ids.user]);
    await pool.query('DELETE FROM albums WHERE album_id = $1', [ids.album]);
    await pool.end();
  });

  it('joins a list group by its numeric primary key', async () => {
    const agent = request.agent('http://localhost:3000');
    const loginPage = await agent.get('/login');
    const csrfToken = loginPage.text.match(/name="_csrf" value="([^"]+)"/)?.[1];
    await agent.post('/login').send({
      _csrf: csrfToken,
      email,
      password: 'password',
    });

    const response = await agent.get('/api/lists/presence').expect(200);

    assert.deepStrictEqual(response.body.items, [
      {
        listId: ids.list,
        listName: 'Presence List',
        year: 2026,
        isMain: false,
        albumId: ids.album,
        artist: 'Presence Artist',
        album: 'Presence Album',
        rymNumericId: null,
        rymCanonicalUrl: null,
      },
    ]);
  });
});
