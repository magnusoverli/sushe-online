const logger = require('../../../utils/logger');

/**
 * Migration: Add recommendations feature tables
 *
 * Creates three tables:
 * - recommendations: Stores recommended albums per year (shared across all users)
 * - recommendation_settings: Lock state per year for recommendations
 * - recommendation_access: Custom access control (when empty = all authenticated users)
 */

async function up(pool) {
  logger.info('Creating recommendations tables...');

  // Main recommendations table - stores recommended albums per year
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recommendations (
      id SERIAL PRIMARY KEY,
      _id TEXT UNIQUE NOT NULL,
      year INTEGER NOT NULL CHECK (year >= 1000 AND year <= 9999),
      album_id TEXT NOT NULL REFERENCES albums(album_id) ON DELETE CASCADE,
      recommended_by TEXT NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(year, album_id)
    )
  `);

  // Index for fast lookups by year
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_recommendations_year
    ON recommendations(year)
  `);

  // Index for lookups by album
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_recommendations_album_id
    ON recommendations(album_id)
  `);

  // Index for lookups by recommender
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_recommendations_recommended_by
    ON recommendations(recommended_by)
  `);

  // Composite index for year + created_at (for sorting by date within a year)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_recommendations_year_created
    ON recommendations(year, created_at DESC)
  `);

  logger.info('recommendations table created successfully');

  // Recommendation settings table - lock state per year
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recommendation_settings (
      id SERIAL PRIMARY KEY,
      year INTEGER UNIQUE NOT NULL CHECK (year >= 1000 AND year <= 9999),
      locked BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Partial index for efficient lookup of locked years
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_recommendation_settings_locked
    ON recommendation_settings(locked)
    WHERE locked = TRUE
  `);

  logger.info('recommendation_settings table created successfully');

  // Recommendation access table - custom access control
  // When empty for a year = all authenticated users have access
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recommendation_access (
      id SERIAL PRIMARY KEY,
      year INTEGER NOT NULL CHECK (year >= 1000 AND year <= 9999),
      user_id TEXT NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
      added_by TEXT NOT NULL REFERENCES users(_id),
      added_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(year, user_id)
    )
  `);

  // Index for fast lookups by year
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_recommendation_access_year
    ON recommendation_access(year)
  `);

  // Index for lookups by user
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_recommendation_access_user_id
    ON recommendation_access(user_id)
  `);

  logger.info('recommendation_access table created successfully');
  logger.info('All recommendations tables created successfully');
}

async function down(pool) {
  logger.info('Dropping recommendations tables...');

  await pool.query('DROP TABLE IF EXISTS recommendation_access CASCADE');
  await pool.query('DROP TABLE IF EXISTS recommendation_settings CASCADE');
  await pool.query('DROP TABLE IF EXISTS recommendations CASCADE');

  logger.info('Recommendations tables dropped successfully');
}

module.exports = { up, down };
