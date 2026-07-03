const crypto = require('crypto');
const logger = require('../../../utils/logger');

const LOOKUP_LEN = 8;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Move extension tokens from plaintext storage to hashed storage.
 *
 * Adds `token_hash` (SHA-256 hex) and `token_lookup` (short non-secret prefix)
 * columns, backfills them from the existing plaintext tokens, indexes the
 * lookup prefix, and makes the plaintext `token` column optional so new tokens
 * are stored hashed-only. The plaintext column is intentionally NOT dropped in
 * this migration so existing rows remain reversible and a rollback keeps
 * working; a follow-up migration can drop it once the change has baked.
 */
async function up(pool) {
  logger.info('Adding hashed extension-token columns...');

  await pool.query(`
    ALTER TABLE extension_tokens
    ADD COLUMN IF NOT EXISTS token_hash TEXT,
    ADD COLUMN IF NOT EXISTS token_lookup TEXT
  `);

  // Backfill hash + lookup from existing plaintext tokens. Done in JS (rather
  // than pgcrypto's digest()) to avoid depending on the pgcrypto extension.
  const { rows } = await pool.query(
    `SELECT id, token FROM extension_tokens
     WHERE token IS NOT NULL AND token_hash IS NULL`
  );

  for (const row of rows) {
    await pool.query(
      `UPDATE extension_tokens SET token_hash = $1, token_lookup = $2 WHERE id = $3`,
      [hashToken(row.token), row.token.slice(0, LOOKUP_LEN), row.id]
    );
  }

  logger.info(`Backfilled ${rows.length} extension token hash(es)`);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_extension_tokens_lookup
    ON extension_tokens(token_lookup)
    WHERE is_revoked = FALSE
  `);

  // New tokens are stored hashed-only, so plaintext token is no longer required.
  await pool.query(`
    ALTER TABLE extension_tokens ALTER COLUMN token DROP NOT NULL
  `);
}

async function down(pool) {
  logger.info('Reverting hashed extension-token columns...');

  // Restore NOT NULL only if every row still has a plaintext token (rows
  // created after the up-migration have token = NULL and cannot be restored).
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS missing FROM extension_tokens WHERE token IS NULL`
  );
  if (rows[0].missing === 0) {
    await pool.query(
      `ALTER TABLE extension_tokens ALTER COLUMN token SET NOT NULL`
    );
  } else {
    logger.warn(
      `Leaving extension_tokens.token nullable: ${rows[0].missing} row(s) have no plaintext token`
    );
  }

  await pool.query(`DROP INDEX IF EXISTS idx_extension_tokens_lookup`);

  await pool.query(`
    ALTER TABLE extension_tokens
    DROP COLUMN IF EXISTS token_hash,
    DROP COLUMN IF EXISTS token_lookup
  `);
}

module.exports = { up, down };
