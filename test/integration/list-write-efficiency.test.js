const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const {
  findOrInsertAutoGroup,
} = require('../../db/repositories/auto-list-groups');
const { reorderItems } = require('../../services/list/write/reorder-items');
const { TransactionAbort } = require('../../db/transaction');

test('auto-group conflicts reuse the id; reorders only version moved items', async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const user = randomUUID();
  const listId = randomUUID();
  const albums = Array.from({ length: 3 }, () => randomUUID());
  try {
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO users (_id, email, username, hash) VALUES ($1,$2,$1,'synthetic')",
      [user, `${user}@example.test`]
    );
    const major = Number(
      (await client.query('SHOW server_version_num')).rows[0].server_version_num
    );
    const tuple = async (id) =>
      (
        await client.query('SELECT ctid::text FROM list_groups WHERE id=$1', [
          id,
        ])
      ).rows[0].ctid;
    for (const year of [null, 2026]) {
      const get = () => findOrInsertAutoGroup(client, randomUUID(), user, year);
      const id = await get();
      const before = await tuple(id);
      assert.equal(await get(), id);
      if (major >= 190000) assert.equal(await tuple(id), before);
    }
    await client.query(
      "INSERT INTO lists (_id,user_id,name,sort_order,group_id) SELECT $1,$2,'Order',0,id FROM list_groups WHERE user_id=$2 AND year=2026",
      [listId, user]
    );
    for (const [i, album] of albums.entries()) {
      await client.query(
        'INSERT INTO albums(album_id,artist,album) VALUES ($1,$1,$1)',
        [album]
      );
      await client.query(
        'INSERT INTO list_items(_id,list_id,album_id,position) VALUES ($1,$2,$1,$3)',
        [album, listId, i + 1]
      );
    }
    const readList = async () =>
      (
        await client.query('SELECT _id,revision FROM lists WHERE _id=$1', [
          listId,
        ])
      ).rows[0];
    const reorder = (order, rev) =>
      reorderItems(
        {
          db: { withTransaction: (fn) => fn(client) },
          TransactionAbort,
          findListByIdOrThrow: readList,
        },
        listId,
        user,
        order,
        rev
      );
    const unchangedTuple = async () =>
      (
        await client.query('SELECT ctid::text FROM list_items WHERE _id=$1', [
          albums[2],
        ])
      ).rows[0].ctid;
    const before = await unchangedTuple();
    const original = (await readList()).revision;
    const swapped = [albums[1], albums[0], albums[2]];
    const moved = await reorder(swapped, original);
    assert.equal(BigInt(moved.list.revision) - BigInt(original), 2n);
    const replay = await reorder(swapped, moved.list.revision);
    assert.equal(replay.list.revision, moved.list.revision);
    assert.equal(replay.itemCount, albums.length);
    assert.equal(await unchangedTuple(), before);
    await assert.rejects(reorder(albums, original), { statusCode: 412 });
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  }
});
