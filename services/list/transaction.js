const { acquireTransactionLocks } = require('../../db/advisory-locks');

const USER_MUTATION_NAMESPACE = 104;
const publishers = new WeakMap();
const mutationScopes = new WeakMap();

function recordListContentChange(client, list) {
  mutationScopes
    .get(client)
    ?.set(list._id, { listId: list._id, revision: list.revision });
}

function registerListMutationPublisher(db, publisher) {
  publishers.set(db, publisher);
}

async function mainYears(client, userId) {
  const result = await client.query(
    'SELECT DISTINCT year FROM lists WHERE user_id = $1 AND is_main = TRUE AND year IS NOT NULL',
    [userId]
  );
  return result.rows.map((row) => row.year);
}

// All owned-list/group mutations acquire this lock before any row or year
// locks. It prevents cross-operation row/year cycles while unrelated users
// remain concurrent. Administrative year flips never acquire user locks.
async function withListTransaction(db, userId, callback) {
  const publisher = publishers.get(db);
  let years = [];
  let changes = [];
  const result = await db.withTransaction(async (client) => {
    await acquireTransactionLocks(client, USER_MUTATION_NAMESPACE, [userId]);
    if (publisher) years = await mainYears(client, userId);
    const scope = new Map();
    mutationScopes.set(client, scope);
    let value;
    try {
      value = await callback(client);
      changes = [...scope.values()];
    } finally {
      mutationScopes.delete(client);
    }
    if (publisher) years.push(...(await mainYears(client, userId)));
    return value;
  });
  // Publication is owned by composition and occurs only after COMMIT succeeds.
  if (publisher)
    await publisher({
      userId,
      years: [...new Set(years)],
      ...(changes.length ? { changes } : {}),
    });
  return result;
}

module.exports = {
  withListTransaction,
  registerListMutationPublisher,
  recordListContentChange,
};
