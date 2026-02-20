module.exports = {
  async up(pool) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS preferred_ui TEXT
    `);
  },

  async down(pool) {
    await pool.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS preferred_ui
    `);
  },
};
