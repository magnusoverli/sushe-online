module.exports = {
  async up(pool) {
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS last_selected_list TEXT
    `);
  },

  async down(pool) {
    await pool.query(`
      ALTER TABLE users 
      DROP COLUMN IF EXISTS last_selected_list
    `);
  },
};
