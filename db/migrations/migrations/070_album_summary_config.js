/**
 * Album summary model configuration.
 *
 * The model and its parameters were environment-only, which meant a host-side
 * compose file could silently pin an old model while the image shipped a new
 * one. That is not hypothetical: production sat on claude-sonnet-4-5 with a
 * stale override and every summary failed, because the code sent an `effort`
 * parameter that model rejects.
 *
 * Making this a stored setting moves the source of truth somewhere an admin can
 * see and change, and somewhere a stale deploy cannot contradict.
 *
 * Singleton row, following the telegram_config idiom already in the schema.
 */

async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS album_summary_config (
      id SERIAL PRIMARY KEY,
      model TEXT NOT NULL,
      effort TEXT,
      max_tokens INTEGER,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by TEXT REFERENCES users(_id) ON DELETE SET NULL
    )
  `);

  // One row, enforced in the schema rather than by convention: a second row
  // would make "the" configuration ambiguous and the reader would silently
  // pick whichever came back first.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS album_summary_config_singleton
    ON album_summary_config ((true))
  `);
}

async function down(pool) {
  await pool.query('DROP TABLE IF EXISTS album_summary_config');
}

module.exports = { up, down };
