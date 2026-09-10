module.exports = {
  async up(client) {
    await client.query(`CREATE TABLE IF NOT EXISTS playlist_bindings (
      user_id TEXT NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
      list_id TEXT NOT NULL REFERENCES lists(_id) ON DELETE CASCADE,
      service TEXT NOT NULL CHECK (service IN ('spotify', 'tidal')),
      provider_account_id TEXT NOT NULL,
      playlist_id TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, list_id, service, provider_account_id)
    )`);
  },
  async down(client) {
    await client.query('DROP TABLE IF EXISTS playlist_bindings');
  },
};
