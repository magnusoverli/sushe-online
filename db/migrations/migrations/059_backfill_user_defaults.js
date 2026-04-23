const logger = require('../../../utils/logger');

async function up(pool) {
  logger.info('Backfilling nullable user defaults...');

  await pool.query(`
    UPDATE users
    SET accent_color = COALESCE(accent_color, '#dc2626'),
        time_format = COALESCE(time_format, '24h'),
        date_format = COALESCE(date_format, 'MM/DD/YYYY'),
        spotify_auth = COALESCE(spotify_auth, 'null'::jsonb),
        tidal_auth = COALESCE(tidal_auth, 'null'::jsonb),
        tidal_country = COALESCE(tidal_country, NULL),
        music_service = COALESCE(music_service, NULL),
        updated_at = NOW()
    WHERE accent_color IS NULL
       OR time_format IS NULL
       OR date_format IS NULL
       OR spotify_auth IS NULL
       OR tidal_auth IS NULL
  `);
}

async function down() {
  logger.info('059_backfill_user_defaults is data-only and does not roll back');
}

module.exports = { up, down };
