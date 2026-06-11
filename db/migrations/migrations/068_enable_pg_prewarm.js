const logger = require('../../../utils/logger');

async function up(pool) {
  logger.info('Enabling pg_prewarm extension...');
  await pool.query(`
    DO $$
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_prewarm;
    EXCEPTION
      WHEN insufficient_privilege OR undefined_file OR feature_not_supported THEN
        RAISE NOTICE 'pg_prewarm extension could not be enabled: %', SQLERRM;
    END $$;
  `);
}

async function down(pool) {
  logger.info(
    'Leaving pg_prewarm extension installed for shared database safety'
  );
  await pool.query('SELECT 1');
}

module.exports = { up, down };
