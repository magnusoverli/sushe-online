const logger = require('../../../utils/logger');

async function up(pool) {
  logger.info('Adding independent user-list year visibility...');
  await pool.query(`
    CREATE TABLE user_list_year_visibility (
      year INTEGER PRIMARY KEY,
      revealed BOOLEAN NOT NULL DEFAULT FALSE,
      revealed_at TIMESTAMPTZ,
      revealed_by TEXT REFERENCES users(_id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT user_list_year_visibility_year_check
        CHECK (year BETWEEN 1000 AND 9999),
      CONSTRAINT user_list_year_visibility_timestamp_check
        CHECK (revealed = (revealed_at IS NOT NULL))
    )
  `);
  await pool.query(`
    INSERT INTO user_list_year_visibility (
      year,
      revealed,
      revealed_at,
      updated_at
    )
    SELECT
      year,
      TRUE,
      COALESCE(revealed_at, updated_at, NOW()),
      COALESCE(updated_at, NOW())
    FROM master_lists
    WHERE revealed = TRUE
    ON CONFLICT (year) DO NOTHING
  `);
  logger.info('Independent user-list year visibility added');
}

async function down(pool) {
  await pool.query('DROP TABLE IF EXISTS user_list_year_visibility');
}

module.exports = { up, down };
