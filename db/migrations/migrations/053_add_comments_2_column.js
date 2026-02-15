module.exports = {
  async up(pool) {
    await pool.query(`
      ALTER TABLE list_items 
      ADD COLUMN IF NOT EXISTS comments_2 TEXT
    `);
  },

  async down(pool) {
    await pool.query(`
      ALTER TABLE list_items 
      DROP COLUMN IF EXISTS comments_2
    `);
  },
};
