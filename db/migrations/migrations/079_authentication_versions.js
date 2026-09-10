module.exports = {
  async up(client) {
    await client.query(
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version BIGINT NOT NULL DEFAULT 0'
    );
    await client.query(
      'ALTER TABLE extension_tokens ADD COLUMN IF NOT EXISTS auth_version BIGINT NOT NULL DEFAULT 0'
    );
  },
  irreversible: true,
};
