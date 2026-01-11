const logger = require('../../../utils/logger');

/**
 * Migration to create album_distinct_pairs table
 *
 * This table stores pairs of albums that users have confirmed are DIFFERENT albums,
 * even though fuzzy matching suggested they might be duplicates.
 *
 * Use case: When adding an album, if it fuzzy-matches an existing album, we show
 * a "Did you mean this album?" modal. If the user says "No, these are different",
 * we record that pair here so we don't ask again.
 *
 * The pair is stored with album_id_1 < album_id_2 (lexicographically) to ensure
 * uniqueness regardless of which album was the "new" one vs the "existing" one.
 */

async function up(pool) {
  logger.info('Creating album_distinct_pairs table...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS album_distinct_pairs (
      id SERIAL PRIMARY KEY,
      album_id_1 VARCHAR(255) NOT NULL,
      album_id_2 VARCHAR(255) NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      
      -- Ensure pairs are stored in consistent order (id_1 < id_2)
      CONSTRAINT album_distinct_pairs_ordered CHECK (album_id_1 < album_id_2),
      
      -- Ensure unique pairs
      CONSTRAINT album_distinct_pairs_unique UNIQUE (album_id_1, album_id_2)
    )
  `);

  // Index for efficient lookups when checking if a pair exists
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_album_distinct_pairs_album_1 
    ON album_distinct_pairs(album_id_1)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_album_distinct_pairs_album_2 
    ON album_distinct_pairs(album_id_2)
  `);

  logger.info('album_distinct_pairs table created successfully');

  // Verify table was created
  const tableCheck = await pool.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_name = 'album_distinct_pairs'
  `);

  if (tableCheck.rows.length === 0) {
    throw new Error('Failed to create album_distinct_pairs table');
  }

  logger.info('Verified: album_distinct_pairs table exists');
}

async function down(pool) {
  logger.info('Dropping album_distinct_pairs table...');

  await pool.query('DROP TABLE IF EXISTS album_distinct_pairs');

  logger.info('album_distinct_pairs table dropped');
}

module.exports = { up, down };
