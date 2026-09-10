/** @param {import('pg').PoolClient} client @param {string} userId */
async function revokeCredentials(client, userId) {
  await client.query(
    'UPDATE extension_tokens SET is_revoked = TRUE WHERE user_id = $1',
    [userId]
  );
  // Browser session caches can retain deleted rows temporarily. The version
  // comparison in Passport also rejects those copies and any in-flight re-save.
  await client.query(
    `DELETE FROM session WHERE sess->'passport'->>'user' = $1
    OR sess->'passport'->'user'->>'id' = $1`,
    [userId]
  );
}

/** @param {import('../types').DbFacade} db @param {string} userId @param {string} hash @param {string} expectedHash */
async function changePasswordHash(db, userId, hash, expectedHash) {
  return db.withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE users SET hash = $1, auth_version = auth_version + 1,
      reset_token = NULL, reset_expires = NULL, updated_at = NOW()
      WHERE _id = $2 AND hash = $3 RETURNING _id`,
      [hash, userId, expectedHash]
    );
    if (!result.rows.length) return false;
    await revokeCredentials(client, userId);
    return true;
  });
}

/** @param {import('../types').DbFacade} db @param {string} token @param {number} nowMs @param {string} hash */
async function resetPasswordHash(db, token, nowMs, hash) {
  return db.withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE users SET hash = $1, auth_version = auth_version + 1,
      reset_token = NULL, reset_expires = NULL, updated_at = NOW()
      WHERE reset_token = $2 AND reset_expires > $3 RETURNING _id`,
      [hash, token, nowMs]
    );
    if (!result.rows.length) return 0;
    await revokeCredentials(client, result.rows[0]._id);
    return result.rows.length;
  });
}

module.exports = { changePasswordHash, resetPasswordHash };
