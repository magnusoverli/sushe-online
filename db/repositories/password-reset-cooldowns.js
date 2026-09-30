const { createHash } = require('node:crypto');
const COOLDOWN_SECONDS = 300;

/** @param {import('../types').DbFacade} db @param {string} email */
async function acquirePasswordResetCooldown(db, email) {
  if (typeof email !== 'string' || !email || email.length > 320) return false;
  // Login identities are case-sensitive and untrimmed. Preserve those semantics.
  const key = createHash('sha256').update(email).digest('hex');
  // Bound retention to one day beyond expiry, without storing an email or user FK.
  await db.raw(
    "DELETE FROM password_reset_cooldowns WHERE expires_at < NOW() - INTERVAL '1 day'"
  );
  const result = await db.raw(
    `INSERT INTO password_reset_cooldowns (account_key, expires_at)
     VALUES ($1, clock_timestamp() + $2 * INTERVAL '1 second')
     ON CONFLICT (account_key) DO UPDATE SET expires_at = EXCLUDED.expires_at
     WHERE password_reset_cooldowns.expires_at <= clock_timestamp()
     RETURNING account_key`,
    [key, COOLDOWN_SECONDS]
  );
  return result.rows.length === 1;
}

module.exports = { acquirePasswordResetCooldown };
