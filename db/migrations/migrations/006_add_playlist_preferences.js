module.exports = {
  async up(pool) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS playlist_preferences JSONB DEFAULT '{}'::jsonb
    `);
  },

  async down(pool) {
    await pool.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS playlist_preferences
    `);
  },
};
