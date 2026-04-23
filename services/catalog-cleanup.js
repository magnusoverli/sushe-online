const logger = require('../utils/logger');
const { withTransaction } = require('../db/transaction');

const DEFAULT_MIN_AGE_DAYS = 90;
const MAX_MIN_AGE_DAYS = 3650;
const DEFAULT_SAMPLE_LIMIT = 8;
const REFERENCE_CHECKS = {
  list_items: 'SELECT 1 FROM list_items li WHERE li.album_id = a.album_id',
  recommendations:
    'SELECT 1 FROM recommendations r WHERE r.album_id = a.album_id',
  album_service_mappings:
    'SELECT 1 FROM album_service_mappings asm WHERE asm.album_id = a.album_id',
  artist_service_aliases:
    'SELECT 1 FROM artist_service_aliases asa WHERE asa.source_album_id = a.album_id',
};

function normalizeMinAgeDays(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MIN_AGE_DAYS;
  }

  return Math.min(Math.max(parsed, 0), MAX_MIN_AGE_DAYS);
}

function normalizeSampleLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SAMPLE_LIMIT;
  }

  return Math.min(Math.max(parsed, 1), 50);
}

async function getExistingTableSet(queryable, tableNames) {
  const result = await queryable.query(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename = ANY($1::text[])`,
    [tableNames]
  );

  return new Set(result.rows.map((row) => row.tablename));
}

function buildOrphanReferenceClause(existingTables) {
  const checks = [];

  for (const [tableName, query] of Object.entries(REFERENCE_CHECKS)) {
    if (existingTables.has(tableName)) {
      checks.push(`NOT EXISTS (${query})`);
    }
  }

  if (checks.length === 0) {
    return 'FALSE';
  }

  return checks.join('\n    AND ');
}

function buildOrphanWhereClause(orphanReferenceClause, ageParamIndex = 1) {
  return `
    (a.created_at IS NULL OR a.created_at < NOW() - ($${ageParamIndex}::int * INTERVAL '1 day'))
    AND ${orphanReferenceClause}
  `;
}
function toRowCount(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function createCatalogCleanupService(deps = {}) {
  const pool = deps.pool;
  const db =
    deps.db ||
    (pool ? { raw: (sql, params) => pool.query(sql, params) } : null);
  const log = deps.logger || logger;

  if (!db) {
    throw new Error('catalog-cleanup requires deps.db (or legacy deps.pool)');
  }

  async function getPreview(options = {}) {
    const minAgeDays = normalizeMinAgeDays(options.minAgeDays);
    const sampleLimit = normalizeSampleLimit(options.sampleLimit);

    const existingTables = await getExistingTableSet(pool, [
      ...Object.keys(REFERENCE_CHECKS),
      'user_album_stats',
      'album_distinct_pairs',
    ]);
    const orphanReferenceClause = buildOrphanReferenceClause(existingTables);
    const orphanWhereClause = buildOrphanWhereClause(orphanReferenceClause, 1);

    const coverageResult = await db.raw(
      `SELECT
         COUNT(*)::int AS total_albums,
         COUNT(*) FILTER (WHERE ${orphanReferenceClause})::int AS orphan_albums_total,
         COUNT(*) FILTER (WHERE ${orphanWhereClause})::int AS orphan_albums_eligible,
         COUNT(*) FILTER (
           WHERE ${orphanReferenceClause}
             AND a.created_at IS NOT NULL
             AND a.created_at >= NOW() - ($1::int * INTERVAL '1 day')
         )::int AS orphan_albums_too_young
       FROM albums a`,
      [minAgeDays]
    );

    let userAlbumStatsReferences = 0;
    if (existingTables.has('user_album_stats')) {
      const statsRefResult = await db.raw(
        `SELECT COUNT(*)::int AS count
         FROM user_album_stats uas
         WHERE uas.album_id IS NOT NULL
           AND EXISTS (
             SELECT 1
             FROM albums a
             WHERE a.album_id = uas.album_id
               AND ${orphanWhereClause}
           )`,
        [minAgeDays]
      );
      userAlbumStatsReferences = toRowCount(statsRefResult.rows[0]?.count);
    }

    let distinctPairReferences = 0;
    if (existingTables.has('album_distinct_pairs')) {
      const pairRefResult = await db.raw(
        `SELECT COUNT(*)::int AS count
         FROM album_distinct_pairs adp
         WHERE EXISTS (
           SELECT 1
           FROM albums a
           WHERE a.album_id IS NOT NULL
             AND ${orphanWhereClause}
             AND (a.album_id = adp.album_id_1 OR a.album_id = adp.album_id_2)
         )`,
        [minAgeDays]
      );
      distinctPairReferences = toRowCount(pairRefResult.rows[0]?.count);
    }

    const sampleResult = await db.raw(
      `SELECT a.album_id, a.artist, a.album, a.created_at
       FROM albums a
       WHERE ${orphanWhereClause}
       ORDER BY a.created_at ASC NULLS FIRST, a.artist ASC, a.album ASC
       LIMIT $2`,
      [minAgeDays, sampleLimit]
    );

    return {
      minAgeDays,
      totalAlbums: toRowCount(coverageResult.rows[0]?.total_albums),
      orphanAlbumsTotal: toRowCount(
        coverageResult.rows[0]?.orphan_albums_total
      ),
      orphanAlbums: toRowCount(coverageResult.rows[0]?.orphan_albums_eligible),
      orphanAlbumsTooYoung: toRowCount(
        coverageResult.rows[0]?.orphan_albums_too_young
      ),
      userAlbumStatsReferences,
      distinctPairReferences,
      sampleAlbums: sampleResult.rows,
      generatedAt: new Date().toISOString(),
    };
  }

  async function executeCleanup(options = {}) {
    const minAgeDays = normalizeMinAgeDays(options.minAgeDays);
    const expectedDeleteCount =
      options.expectedDeleteCount === undefined ||
      options.expectedDeleteCount === null
        ? null
        : toRowCount(options.expectedDeleteCount);
    const sampleLimit = normalizeSampleLimit(options.sampleLimit);

    const executionResult = await withTransaction(pool, async (client) => {
      const existingTables = await getExistingTableSet(client, [
        ...Object.keys(REFERENCE_CHECKS),
        'user_album_stats',
        'album_distinct_pairs',
      ]);
      const orphanReferenceClause = buildOrphanReferenceClause(existingTables);
      const orphanWhereClause = buildOrphanWhereClause(
        orphanReferenceClause,
        1
      );

      await client.query(`DROP TABLE IF EXISTS cleanup_album_targets`);
      await client.query(
        `CREATE TEMP TABLE cleanup_album_targets ON COMMIT DROP AS
         SELECT a.id, a.album_id, a.artist, a.album
         FROM albums a
         WHERE ${orphanWhereClause}
         FOR UPDATE`,
        [minAgeDays]
      );

      const targetCountResult = await client.query(
        `SELECT COUNT(*)::int AS count FROM cleanup_album_targets`
      );
      const targetCount = toRowCount(targetCountResult.rows[0]?.count);

      if (expectedDeleteCount !== null && expectedDeleteCount !== targetCount) {
        const mismatchError = new Error(
          'Cleanup preview is stale. Please refresh preview and try again.'
        );
        mismatchError.statusCode = 409;
        mismatchError.code = 'CATALOG_CLEANUP_STALE_PREVIEW';
        mismatchError.details = {
          expectedDeleteCount,
          currentDeleteCount: targetCount,
        };
        throw mismatchError;
      }

      if (targetCount === 0) {
        return {
          minAgeDays,
          deletedAlbums: 0,
          nullifiedUserAlbumStats: 0,
          deletedDistinctPairs: 0,
          sampleDeletedAlbums: [],
        };
      }

      let deletedDistinctPairs = 0;
      if (existingTables.has('album_distinct_pairs')) {
        const pairDeleteResult = await client.query(
          `DELETE FROM album_distinct_pairs adp
           WHERE EXISTS (
             SELECT 1
             FROM cleanup_album_targets t
             WHERE t.album_id IS NOT NULL
               AND (adp.album_id_1 = t.album_id OR adp.album_id_2 = t.album_id)
           )`
        );
        deletedDistinctPairs = pairDeleteResult.rowCount;
      }

      const sampleDeletedResult = await client.query(
        `SELECT album_id, artist, album
         FROM cleanup_album_targets
         ORDER BY artist ASC, album ASC
         LIMIT $1`,
        [sampleLimit]
      );

      const deleteResult = await client.query(
        `DELETE FROM albums a
         USING cleanup_album_targets t
         WHERE a.id = t.id`
      );

      let nullifiedUserAlbumStats = 0;
      if (existingTables.has('user_album_stats')) {
        const nullifyStatsResult = await client.query(
          `UPDATE user_album_stats uas
           SET album_id = NULL
           WHERE uas.album_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1
               FROM albums a
               WHERE a.album_id = uas.album_id
             )`
        );
        nullifiedUserAlbumStats = nullifyStatsResult.rowCount;
      }

      log.info('Catalog cleanup removed orphan albums', {
        deletedAlbums: deleteResult.rowCount,
        nullifiedUserAlbumStats,
        deletedDistinctPairs,
        minAgeDays,
      });

      return {
        minAgeDays,
        deletedAlbums: deleteResult.rowCount,
        nullifiedUserAlbumStats,
        deletedDistinctPairs,
        sampleDeletedAlbums: sampleDeletedResult.rows,
      };
    });

    const postCleanupPreview = await getPreview({ minAgeDays, sampleLimit });
    return { ...executionResult, postCleanupPreview };
  }

  return { getPreview, executeCleanup, normalizeMinAgeDays };
}

module.exports = { createCatalogCleanupService, DEFAULT_MIN_AGE_DAYS };
