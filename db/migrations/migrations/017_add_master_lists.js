const logger = require('../../../utils/logger');

// Add master_lists and master_list_confirmations tables for collaborative AOTY ranking
async function up(pool) {
  logger.info('Creating master_lists table...');

  // Master lists table - one row per year, stores aggregated ranking data
  await pool.query(`
    CREATE TABLE IF NOT EXISTS master_lists (
      id SERIAL PRIMARY KEY,
      year INTEGER UNIQUE NOT NULL,
      revealed BOOLEAN DEFAULT FALSE,
      revealed_at TIMESTAMPTZ,
      computed_at TIMESTAMPTZ,
      data JSONB,
      stats JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Index for quick lookups by year
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_master_lists_year
    ON master_lists(year)
  `);

  // Index for finding revealed lists
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_master_lists_revealed
    ON master_lists(revealed)
    WHERE revealed = TRUE
  `);

  logger.info('Creating master_list_confirmations table...');

  // Confirmations table - tracks admin approvals for reveal
  await pool.query(`
    CREATE TABLE IF NOT EXISTS master_list_confirmations (
      id SERIAL PRIMARY KEY,
      year INTEGER NOT NULL,
      admin_user_id TEXT NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
      confirmed_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(year, admin_user_id)
    )
  `);

  // Index for finding confirmations by year
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_master_list_confirmations_year
    ON master_list_confirmations(year)
  `);

  logger.info(
    'master_lists and master_list_confirmations tables created successfully'
  );
}

async function down(pool) {
  logger.info('Dropping master_list_confirmations table...');
  await pool.query('DROP TABLE IF EXISTS master_list_confirmations CASCADE');

  logger.info('Dropping master_lists table...');
  await pool.query('DROP TABLE IF EXISTS master_lists CASCADE');

  logger.info('master_lists tables dropped successfully');
}

module.exports = { up, down };
