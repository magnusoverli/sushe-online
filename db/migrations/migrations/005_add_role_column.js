
module.exports = {
  async up(pool) {
    
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS role TEXT
    `);

    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)
    `);
  },

  async down(pool) {
    
    await pool.query(`
      DROP INDEX IF EXISTS idx_users_role
    `);

    
    await pool.query(`
      ALTER TABLE users 
      DROP COLUMN IF EXISTS role
    `);
  },
};
