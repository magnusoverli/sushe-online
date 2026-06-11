const defaultLogger = require('../../utils/logger');
const { observeStartupPrewarm } = require('../../utils/metrics');

const HOT_TABLES = [
  'users',
  'session',
  'lists',
  'list_items',
  'list_groups',
  'albums',
  'album_service_mappings',
  'recommendations',
  'master_lists',
];

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function getExistingTables(db, tableNames) {
  const result = await db.raw(
    `SELECT c.relname
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relname = ANY($1)`,
    [tableNames]
  );
  return result.rows.map((row) => row.relname);
}

async function getIndexesForTables(db, tableNames) {
  if (tableNames.length === 0) return [];

  const result = await db.raw(
    `SELECT indexname
     FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = ANY($1)
     ORDER BY tablename, indexname`,
    [tableNames]
  );
  return result.rows.map((row) => row.indexname);
}

async function prewarmRelation(db, relation, log) {
  const start = Date.now();
  try {
    const result = await db.raw(
      `SELECT COALESCE(pg_prewarm($1::regclass, 'buffer'), 0)::int AS blocks`,
      [relation]
    );
    const durationMs = Date.now() - start;
    observeStartupPrewarm('db_prewarm_relation', durationMs, 'success');
    return {
      relation,
      blocks: result.rows[0]?.blocks || 0,
      durationMs,
      success: true,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    observeStartupPrewarm('db_prewarm_relation', durationMs, 'error');
    log.warn('PostgreSQL relation prewarm failed', {
      relation,
      error: error.message,
    });
    return { relation, blocks: 0, durationMs, success: false };
  }
}

async function runDbPrewarm({ db, config, logger = defaultLogger }) {
  if (!config?.dbPrewarmEnabled) {
    logger.info('PostgreSQL prewarm skipped');
    return { skipped: true, relations: [] };
  }

  const startedAt = Date.now();
  logger.info('PostgreSQL prewarm starting', { mode: config.dbPrewarmMode });

  try {
    const tables = await getExistingTables(db, HOT_TABLES);
    const indexes = await getIndexesForTables(db, tables);
    const relations = unique(
      config.dbPrewarmMode === 'full' ? [...indexes, ...tables] : indexes
    );

    const warmed = [];
    for (const relation of relations) {
      warmed.push(await prewarmRelation(db, relation, logger));
    }

    const durationMs = Date.now() - startedAt;
    observeStartupPrewarm('db_prewarm', durationMs, 'success');
    logger.info('PostgreSQL prewarm completed', {
      mode: config.dbPrewarmMode,
      relations: warmed.length,
      successful: warmed.filter((item) => item.success).length,
      blocks: warmed.reduce((sum, item) => sum + item.blocks, 0),
      duration_ms: durationMs,
    });

    return { skipped: false, relations: warmed };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    observeStartupPrewarm('db_prewarm', durationMs, 'error');
    logger.warn('PostgreSQL prewarm failed; continuing with cold DB cache', {
      error: error.message,
      duration_ms: durationMs,
    });
    return { skipped: false, error };
  }
}

module.exports = {
  HOT_TABLES,
  getExistingTables,
  getIndexesForTables,
  runDbPrewarm,
};
