const logger = require('../../../utils/logger');

/**
 * Add persistent external identity mappings for cross-platform name variants.
 *
 * Tables:
 * - album_service_mappings: canonical album_id -> external service album id/name
 * - artist_service_aliases: canonical artist -> external service artist alias
 */
async function up(pool) {
  logger.info('Creating external identity mapping tables...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS album_service_mappings (
      album_id TEXT NOT NULL REFERENCES albums(album_id) ON DELETE CASCADE,
      service TEXT NOT NULL,
      external_album_id TEXT,
      external_artist TEXT,
      external_album TEXT,
      confidence NUMERIC(5,4),
      strategy TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      last_used_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (album_id, service),
      CHECK (service IN ('spotify', 'tidal', 'lastfm'))
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_album_service_mappings_service_external
    ON album_service_mappings(service, external_album_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS artist_service_aliases (
      canonical_artist_key TEXT NOT NULL,
      canonical_artist TEXT NOT NULL,
      service TEXT NOT NULL,
      service_artist_key TEXT NOT NULL,
      service_artist TEXT NOT NULL,
      confidence NUMERIC(5,4),
      source_album_id TEXT REFERENCES albums(album_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      last_used_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (canonical_artist_key, service),
      CHECK (service IN ('spotify', 'tidal', 'lastfm'))
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_artist_service_aliases_lookup
    ON artist_service_aliases(service, canonical_artist_key)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_artist_service_aliases_reverse_lookup
    ON artist_service_aliases(service, service_artist_key)
  `);

  logger.info('External identity mapping tables created');
}

async function down(pool) {
  logger.info('Dropping external identity mapping tables...');

  await pool.query('DROP TABLE IF EXISTS artist_service_aliases');
  await pool.query('DROP TABLE IF EXISTS album_service_mappings');

  logger.info('External identity mapping tables dropped');
}

module.exports = { up, down };
