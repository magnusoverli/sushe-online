module.exports = {
  async up(pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS session (
      sid VARCHAR NOT NULL PRIMARY KEY, sess JSON NOT NULL, expire TIMESTAMP(6) NOT NULL
    )`);
    await pool.query(
      'CREATE INDEX IF NOT EXISTS session_expire ON session (expire)'
    );
  },
  irreversible: true,
};
