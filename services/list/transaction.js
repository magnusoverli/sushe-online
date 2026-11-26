const { acquireTransactionLocks } = require('../../db/advisory-locks');

const USER_MUTATION_NAMESPACE = 104;
const publishers = new WeakMap();
const mutationScopes = new WeakMap();

function recordListContentChange(client, list) {
  mutationScopes
    .get(client)
    ?.changes.set(list._id, { listId: list._id, revision: list.revision });
}

function registerListMutationPublisher(db, publisher) {
  publishers.set(db, publisher);
}

function recordAggregateYears(client, ...years) {
  const scope = mutationScopes.get(client);
  if (scope) for (const year of years) if (year != null) scope.years.add(year);
}

function recordChangedAlbum(client, albumId) {
  mutationScopes.get(client)?.albumIds.add(albumId);
}

// All owned-list/group mutations acquire this lock before any row or year
// locks. It prevents cross-operation row/year cycles while unrelated users
// remain concurrent. Administrative year flips never acquire user locks.
async function withListTransaction(db, userId, callback) {
  const publisher = publishers.get(db);
  const scope = { years: new Set(), changes: new Map(), albumIds: new Set() };
  const result = await db.withTransaction(async (client) => {
    await acquireTransactionLocks(client, USER_MUTATION_NAMESPACE, [userId]);
    if (publisher) mutationScopes.set(client, scope);
    let value;
    try {
      value = await callback(client);
      if (scope.albumIds.size) {
        const { rows } = await client.query(
          `SELECT DISTINCT l.year FROM list_items li
          JOIN lists l ON l._id=li.list_id
          JOIN aggregate_list_contributors c ON c.year=l.year AND c.user_id=l.user_id
          WHERE l.is_main AND li.position <= 40 AND NOT COALESCE(li.is_disqualified,false)
            AND li.album_id=ANY($1::text[])`,
          [[...scope.albumIds]]
        );
        for (const { year } of rows) scope.years.add(year);
      }
    } finally {
      mutationScopes.delete(client);
    }
    return value;
  });
  // Publication is owned by composition and occurs only after COMMIT succeeds.
  if (publisher)
    await publisher({
      userId,
      years: [...scope.years],
      ...(scope.changes.size ? { changes: [...scope.changes.values()] } : {}),
    });
  return result;
}

module.exports = {
  withListTransaction,
  registerListMutationPublisher,
  recordListContentChange,
  recordAggregateYears,
  recordChangedAlbum,
};
