// Add approval_status column to users table for registration approval workflow
// Existing users are defaulted to 'approved' to ensure backwards compatibility
module.exports = {
  async up(pool) {
    // Add approval_status column with default 'approved' for existing users
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'approved'
    `);

    // Update any NULL values to 'approved' (belt and suspenders)
    await pool.query(`
      UPDATE users 
      SET approval_status = 'approved' 
      WHERE approval_status IS NULL
    `);

    // Add index for filtering by approval status (useful for admin queries)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_approval_status ON users(approval_status)
    `);

    // Add index for finding pending approvals efficiently
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_pending_approval 
      ON users(created_at DESC) 
      WHERE approval_status = 'pending'
    `);
  },

  async down(pool) {
    await pool.query('DROP INDEX IF EXISTS idx_users_pending_approval');
    await pool.query('DROP INDEX IF EXISTS idx_users_approval_status');
    await pool.query('ALTER TABLE users DROP COLUMN IF EXISTS approval_status');
  },
};
