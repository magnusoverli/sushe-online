module.exports = {
  async up(pool) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS column_visibility JSONB
    `);
  },

  async down(pool) {
    await pool.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS column_visibility
    `);
  },
};
