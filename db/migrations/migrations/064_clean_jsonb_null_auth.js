const logger = require('../../../utils/logger');

/**
 * Migration 059 backfilled spotify_auth/tidal_auth with 'null'::jsonb, which
 * passes SQL IS NOT NULL checks and made the preference-sync job re-select
 * never-connected users forever. Restore the SQL NULL convention so jsonb
 * null never means "disconnected" again.
 */
async function up(pool) {
  logger.info('Clearing jsonb-null auth blobs back to SQL NULL...');

  const result = await pool.query(`
    UPDATE users
    SET spotify_auth = CASE WHEN spotify_auth = 'null'::jsonb THEN NULL ELSE spotify_auth END,
        tidal_auth = CASE WHEN tidal_auth = 'null'::jsonb THEN NULL ELSE tidal_auth END,
        updated_at = NOW()
    WHERE spotify_auth = 'null'::jsonb
       OR tidal_auth = 'null'::jsonb
  `);

  logger.info(`Cleared jsonb-null auth on ${result.rowCount} users`);
}

async function down() {
  logger.info('064_clean_jsonb_null_auth is data-only and does not roll back');
}

module.exports = { up, down };
