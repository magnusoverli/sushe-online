module.exports = {
  async up(pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS listening_room_shares (
      token TEXT PRIMARY KEY,
      list_id TEXT NOT NULL UNIQUE REFERENCES lists(_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_listening_room_shares_expires_at
      ON listening_room_shares (expires_at)`);
  },
  async down(pool) {
    await pool.query('DROP TABLE IF EXISTS listening_room_shares');
  },
};
