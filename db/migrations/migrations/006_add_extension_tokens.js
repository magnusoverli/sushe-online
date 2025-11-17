// Add extension_tokens table for browser extension authentication
module.exports = {
  async up(pool) {
    // Create extension_tokens table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS extension_tokens (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW(),
        last_used_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        user_agent TEXT,
        is_revoked BOOLEAN DEFAULT FALSE
      )
    `);

    // Create indexes for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_extension_tokens_token 
      ON extension_tokens(token) 
      WHERE is_revoked = FALSE
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_extension_tokens_user_id 
      ON extension_tokens(user_id)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_extension_tokens_expires_at 
      ON extension_tokens(expires_at)
    `);
  },

  async down(pool) {
    // Drop indexes
    await pool.query(`
      DROP INDEX IF EXISTS idx_extension_tokens_expires_at
    `);

    await pool.query(`
      DROP INDEX IF EXISTS idx_extension_tokens_user_id
    `);

    await pool.query(`
      DROP INDEX IF EXISTS idx_extension_tokens_token
    `);

    // Drop table
    await pool.query(`
      DROP TABLE IF EXISTS extension_tokens
    `);
  },
};
