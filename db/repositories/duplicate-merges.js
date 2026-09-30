const DEPENDENT_MERGE_TABLES = [
  'recommendations',
  'album_service_mappings',
  'artist_service_aliases',
  'user_album_stats',
  'album_distinct_pairs',
];

/** @param {Pick<import('pg').PoolClient, 'query'>} client */
async function getExistingDependentMergeTables(client) {
  const result = await client.query(
    `SELECT tablename
    FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
    [DEPENDENT_MERGE_TABLES]
  );
  return new Set(result.rows.map((row) => row.tablename));
}

/** Locks must be acquired with the caller's transaction client, in stable order.
 * @param {Pick<import('pg').PoolClient, 'query'>} client @param {string[]} albumIds */
async function acquireMergeLocks(client, albumIds) {
  const lockIds = [
    ...new Set(albumIds.map((id) => id?.trim() || '').filter(Boolean)),
  ]
    .sort()
    .slice(0, 1000);
  for (const id of lockIds)
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
  if (lockIds.length)
    await client.query(
      `SELECT album_id, album_taxonomy, taxonomy_updated_at
    FROM albums WHERE album_id = ANY($1::text[]) ORDER BY album_id FOR UPDATE`,
      [lockIds]
    );
}

module.exports = { getExistingDependentMergeTables, acquireMergeLocks };
