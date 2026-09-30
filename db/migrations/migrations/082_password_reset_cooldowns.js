module.exports = {
  async up(pool) {
    await pool.query(`CREATE TABLE password_reset_cooldowns (
      account_key TEXT PRIMARY KEY,
      expires_at TIMESTAMPTZ NOT NULL
    )`);
    await pool.query(
      'CREATE INDEX password_reset_cooldowns_expiry ON password_reset_cooldowns (expires_at)'
    );
  },
  async down(pool) {
    await pool.query('DROP TABLE password_reset_cooldowns');
  },
};
