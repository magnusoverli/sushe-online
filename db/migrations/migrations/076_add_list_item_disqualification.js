const logger = require('../../../utils/logger');

async function up(pool) {
  logger.info('Adding list-item disqualification state...');
  await pool.query(`
    ALTER TABLE list_items
      ADD COLUMN is_disqualified BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN disqualification_reason TEXT
  `);
  await pool.query(`
    ALTER TABLE list_items
      ADD CONSTRAINT list_items_disqualification_reason_length_check
      CHECK (
        disqualification_reason IS NULL
        OR char_length(disqualification_reason) <= 1000
      ) NOT VALID
  `);
  await pool.query(`
    ALTER TABLE list_items
      VALIDATE CONSTRAINT list_items_disqualification_reason_length_check
  `);
  logger.info('List-item disqualification state added');
}

async function down(pool) {
  await pool.query(`
    ALTER TABLE list_items
      DROP CONSTRAINT IF EXISTS list_items_disqualification_reason_length_check,
      DROP COLUMN IF EXISTS disqualification_reason,
      DROP COLUMN IF EXISTS is_disqualified
  `);
}

module.exports = { up, down };
