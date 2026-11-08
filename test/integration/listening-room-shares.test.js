const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const express = require('express');
const request = require('supertest');
const {
  createListeningRoomShareService,
} = require('../../services/listening-room-share-service');
const registerPublic = require('../../routes/listening-room-share');

test('PostgreSQL share lifetime, concurrent upserts, live picks, approval and cascades', async () => {
  assert.ok(process.env.DATABASE_URL);
  const pools = [0, 1].map(
    () => new Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
  );
  const services = pools.map((pool) =>
    createListeningRoomShareService({
      db: { raw: (sql, params) => pool.query(sql, params) },
    })
  );
  const pool = pools[0];
  const userId = randomUUID();
  const listId = randomUUID();
  const albumId = randomUUID();
  const itemId = randomUUID();
  const logger = { error() {} };
  const app = express();
  registerPublic(app, { listeningRoomShareService: services[0], logger });
  const read = (token) =>
    request(app).get(`/lr/${token}`).set('Accept', 'application/json');
  try {
    await pool.query(
      "INSERT INTO users (_id,email,username,hash,role,approval_status) VALUES ($1,$2,$1,'unused','user','approved')",
      [userId, `${userId}@lr.test`]
    );
    const group = (
      await pool.query(
        "INSERT INTO list_groups (_id,user_id,name) VALUES ($1,$2,'Listening Room fixture') RETURNING id",
        [randomUUID(), userId]
      )
    ).rows[0];
    await pool.query(
      "INSERT INTO lists (_id,user_id,name,year,is_main,group_id) VALUES ($1,$2,'Shared picks',2025,FALSE,$3)",
      [listId, userId, group.id]
    );
    await pool.query(
      "INSERT INTO albums (album_id,artist,album,tracks) VALUES ($1,'Artist','Album',$2)",
      [
        albumId,
        JSON.stringify([
          { name: 'One', length: 245600 },
          { name: 'Two', length: 200000 },
        ]),
      ]
    );
    await pool.query(
      "INSERT INTO list_items (_id,list_id,album_id,position,primary_track) VALUES ($1,$2,$3,1,'#1')",
      [itemId, listId, albumId]
    );

    const first = await services[0].createOrRenew(listId, userId);
    assert.match(first.token, /^[A-Za-z0-9_-]{22}$/);
    const stored = (
      await pool.query(
        'SELECT *, EXTRACT(EPOCH FROM (expires_at - created_at)) AS seconds FROM listening_room_shares WHERE list_id=$1',
        [listId]
      )
    ).rows[0];
    assert.ok(Math.abs(Number(stored.seconds) - 7 * 24 * 60 * 60) < 0.1);
    // Force a measurable prior deadline without wall-clock sleeps or relying
    // on sub-millisecond PostgreSQL precision surviving JS Date serialization.
    await pool.query(
      "UPDATE listening_room_shares SET expires_at=expires_at-INTERVAL '1 minute' WHERE list_id=$1",
      [listId]
    );
    const second = await services[1].createOrRenew(listId, userId);
    assert.equal(second.token, first.token);
    assert.ok(
      new Date(second.expiresAt).getTime() >
        new Date(first.expiresAt).getTime() - 60 * 1000
    );
    assert.equal(
      (await read(first.token).expect(200)).body.songs[0].title,
      'One'
    );
    await pool.query("UPDATE list_items SET primary_track='#2' WHERE _id=$1", [
      itemId,
    ]);
    await pool.query(
      "UPDATE lists SET name='Changed name',year=2026 WHERE _id=$1",
      [listId]
    );
    const changed = (await read(first.token).expect(200)).body;
    assert.equal(changed.songs[0].title, 'Two');
    assert.deepEqual(changed.list, { name: 'Changed name', year: 2026 });

    await pool.query(
      "UPDATE listening_room_shares SET expires_at=NOW()-INTERVAL '1 second' WHERE list_id=$1",
      [listId]
    );
    await read(first.token).expect(404, { error: 'not_found' });
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        services[i % 2].createOrRenew(listId, userId)
      )
    );
    assert.equal(new Set(concurrent.map((share) => share.token)).size, 1);
    const renewed = concurrent[0];
    assert.notEqual(renewed.token, first.token);
    await read(first.token).expect(404, { error: 'not_found' });
    await services[0].stop(listId, userId);
    await read(renewed.token).expect(404, { error: 'not_found' });
    await services[0].stop(listId, userId);
    const freshConcurrent = await Promise.all(
      services.map((service) => service.createOrRenew(listId, userId))
    );
    assert.equal(new Set(freshConcurrent.map((share) => share.token)).size, 1);
    const restarted = freshConcurrent[0];
    assert.notEqual(restarted.token, renewed.token);
    await pool.query(
      "UPDATE users SET approval_status='pending' WHERE _id=$1",
      [userId]
    );
    await read(restarted.token).expect(404, { error: 'not_found' });
    await pool.query(
      "UPDATE users SET approval_status='approved' WHERE _id=$1",
      [userId]
    );
    await pool.query('DELETE FROM lists WHERE _id=$1', [listId]);
    await read(restarted.token).expect(404, { error: 'not_found' });
    assert.equal(
      (
        await pool.query(
          'SELECT * FROM listening_room_shares WHERE list_id=$1',
          [listId]
        )
      ).rowCount,
      0
    );

    await pool.query(
      "INSERT INTO lists (_id,user_id,name,group_id) VALUES ($1,$2,'Another',$3)",
      [listId, userId, group.id]
    );
    const last = await services[0].createOrRenew(listId, userId);
    await pool.query('DELETE FROM users WHERE _id=$1', [userId]);
    await read(last.token).expect(404, { error: 'not_found' });
    assert.equal(
      (
        await pool.query(
          'SELECT * FROM listening_room_shares WHERE user_id=$1',
          [userId]
        )
      ).rowCount,
      0
    );
  } finally {
    await pool.query('DELETE FROM users WHERE _id=$1', [userId]);
    await pool.query('DELETE FROM albums WHERE album_id=$1', [albumId]);
    await Promise.all(pools.map((p) => p.end()));
  }
});
