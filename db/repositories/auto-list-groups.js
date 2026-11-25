// Cache per physical client, not per process: a reconnected pool may now be
// talking to the previous major after rollback.
const conflictActions = new WeakMap();

/** @param {import('pg').PoolClient | import('pg').Pool} client */
async function conflictAction(client) {
  if (!conflictActions.has(client)) {
    const { rows } = await client.query('SHOW server_version_num');
    conflictActions.set(
      client,
      Number(rows[0].server_version_num) >= 190000
        ? 'DO SELECT'
        : 'DO UPDATE SET name = list_groups.name'
    );
  }
  return conflictActions.get(client);
}

/**
 * Caller holds the user-scoped transaction lock for sort-order allocation.
 * @param {import('pg').PoolClient | import('pg').Pool} client
 * @param {string} externalId
 * @param {string} userId
 * @param {number|null} year
 * @returns {Promise<number>}
 */
async function findOrInsertAutoGroup(client, externalId, userId, year) {
  const target =
    year === null
      ? '(user_id, name)'
      : '(user_id, year) WHERE year IS NOT NULL';
  const action = await conflictAction(client);
  const { rows } = await client.query(
    `INSERT INTO list_groups (_id, user_id, name, year, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4,
       COALESCE((SELECT MAX(sort_order) + 1 FROM list_groups WHERE user_id = $2), 0),
       NOW(), NOW())
     ON CONFLICT ${target} ${action} RETURNING id`,
    [externalId, userId, year === null ? 'Uncategorized' : String(year), year]
  );
  return rows[0].id;
}

module.exports = { findOrInsertAutoGroup };
