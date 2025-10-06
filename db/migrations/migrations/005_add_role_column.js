// Add role column to users table
module.exports = {
  async up(pool) {
    // Add role column if it doesn't exist
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS role TEXT
    `);

    // Create index for role column for faster admin lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)
    `);
  },

  async down(pool) {
    // Remove the index
    await pool.query(`
      DROP INDEX IF EXISTS idx_users_role
    `);

    // Remove the column
    await pool.query(`
      ALTER TABLE users 
      DROP COLUMN IF EXISTS role
    `);
  },
};

