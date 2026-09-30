const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { Pool } = require('pg');
const {
  acquirePasswordResetCooldown,
} = require('../../db/repositories/password-reset-cooldowns');

test('independent PostgreSQL pools admit exactly one reset and allow expiry without storing email', async () => {
  assert.ok(process.env.DATABASE_URL);
  const email = `${randomUUID()}@cooldown.test`;
  const key = createHash('sha256').update(email).digest('hex');
  const pools = [0, 1].map(
    () => new Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
  );
  const dbs = pools.map((pool) => ({
    raw: (sql, params) => pool.query(sql, params),
  }));
  try {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        acquirePasswordResetCooldown(dbs[i % 2], email)
      )
    );
    assert.equal(results.filter(Boolean).length, 1);
    const rows = (
      await pools[0].query(
        'SELECT * FROM password_reset_cooldowns WHERE account_key=$1',
        [key]
      )
    ).rows;
    assert.equal(rows.length, 1);
    assert.ok(!JSON.stringify(rows).includes(email));
    assert.equal(await acquirePasswordResetCooldown(dbs[1], email), false);
    await pools[0].query(
      "UPDATE password_reset_cooldowns SET expires_at=NOW()-INTERVAL '1 second' WHERE account_key=$1",
      [key]
    );
    assert.equal(await acquirePasswordResetCooldown(dbs[1], email), true);
    assert.equal(
      await acquirePasswordResetCooldown(dbs[0], email.toUpperCase()),
      true
    );
  } finally {
    await pools[0].query(
      'DELETE FROM password_reset_cooldowns WHERE account_key=ANY($1)',
      [[key, createHash('sha256').update(email.toUpperCase()).digest('hex')]]
    );
    await Promise.all(pools.map((pool) => pool.end()));
  }
});
