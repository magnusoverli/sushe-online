// @ts-check

/**
 * A lock key as supplied by callers. Numeric keys (serial ids, years) are
 * passed straight to pg_advisory_xact_lock's second int4 argument; string
 * keys (hex `_id` values) are folded to int4 via hashtext().
 * @typedef {string|number} LockKey
 */

/**
 * Anything able to run the advisory-lock statement. Advisory *xact* locks are
 * only meaningful inside an open transaction, so callers pass the transaction
 * client from withTransaction(); a Pool is accepted because the route helpers
 * type their queryable as "transaction client or pool".
 * @typedef {import('pg').PoolClient|import('pg').Pool} LockQueryable
 */

const LOCK_NAMESPACES = Object.freeze({
  YEAR: 101,
  LIST_GROUPS_USER: 102,
  LISTS_GROUP: 103,
});

/**
 * Drop nullish keys and de-duplicate, preserving insertion order.
 *
 * @param {ReadonlyArray<LockKey|null|undefined>|null|undefined} keys
 * @returns {LockKey[]}
 */
function normalizeKeys(keys) {
  return [
    ...new Set((keys || []).filter((key) => key !== null && key !== undefined)),
  ];
}

/**
 * Order keys deterministically so concurrent transactions acquire the same
 * locks in the same sequence (deadlock avoidance). Numbers sort numerically,
 * everything else by locale string comparison.
 *
 * @param {ReadonlyArray<LockKey>} keys
 * @returns {LockKey[]}
 */
function sortKeys(keys) {
  return [...keys].sort((left, right) => {
    const leftIsNumber = typeof left === 'number' && Number.isFinite(left);
    const rightIsNumber = typeof right === 'number' && Number.isFinite(right);

    if (leftIsNumber && rightIsNumber) {
      return left - right;
    }

    return String(left).localeCompare(String(right));
  });
}

/**
 * Take a single transaction-scoped advisory lock. Released automatically at
 * COMMIT/ROLLBACK.
 *
 * @param {LockQueryable} client - Client running the enclosing transaction
 * @param {number} namespace - One of LOCK_NAMESPACES (the int4 classid)
 * @param {LockKey} key - Lock subject; non-safe-integer keys are hashed
 * @returns {Promise<void>}
 */
async function acquireTransactionLock(client, namespace, key) {
  if (typeof key === 'number' && Number.isSafeInteger(key)) {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
      namespace,
      key,
    ]);
    return;
  }

  await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
    namespace,
    String(key),
  ]);
}

/**
 * Take advisory locks for a set of keys in a stable, de-duplicated order.
 *
 * @param {LockQueryable} client - Client running the enclosing transaction
 * @param {number} namespace - One of LOCK_NAMESPACES (the int4 classid)
 * @param {ReadonlyArray<LockKey|null|undefined>|null|undefined} keys
 * @returns {Promise<void>}
 */
async function acquireTransactionLocks(client, namespace, keys) {
  const uniqueKeys = sortKeys(normalizeKeys(keys));
  for (const key of uniqueKeys) {
    await acquireTransactionLock(client, namespace, key);
  }
}

module.exports = {
  LOCK_NAMESPACES,
  acquireTransactionLock,
  acquireTransactionLocks,
};
