// @ts-check

const LOCK_NAMESPACES = Object.freeze({
  YEAR: 101,
  LIST_GROUPS_USER: 102,
  LISTS_GROUP: 103,
});

function normalizeKeys(keys) {
  return [
    ...new Set((keys || []).filter((key) => key !== null && key !== undefined)),
  ];
}

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
