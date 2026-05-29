/**
 * Album service availability metadata.
 *
 * 1. Adds `external_url` to album_service_mappings so a per-platform deep link
 *    can be stored directly (the table previously only held an external id).
 * 2. Removes the `service IN ('spotify','tidal','lastfm')` CHECK so the set of
 *    platforms becomes an application-layer allowlist (see
 *    services/availability/platforms.js). Adding a platform then needs no
 *    migration. The repository still validates the service name on read/write.
 *
 * The CHECK is dropped by discovery (its auto-generated name is environment
 * dependent), so this is robust regardless of how Postgres named it.
 */
module.exports = {
  async up(pool) {
    await pool.query(`
      ALTER TABLE album_service_mappings
      ADD COLUMN IF NOT EXISTS external_url TEXT
    `);

    await pool.query(`
      DO $$
      DECLARE constraint_name text;
      BEGIN
        SELECT conname INTO constraint_name
        FROM pg_constraint
        WHERE conrelid = 'album_service_mappings'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%service%';
        IF constraint_name IS NOT NULL THEN
          EXECUTE format(
            'ALTER TABLE album_service_mappings DROP CONSTRAINT %I',
            constraint_name
          );
        END IF;
      END $$;
    `);
  },

  async down(pool) {
    await pool.query(`
      ALTER TABLE album_service_mappings
      DROP COLUMN IF EXISTS external_url
    `);

    // Restore the original three-service CHECK. Existing rows for services
    // outside this set must be removed first or the constraint would fail.
    await pool.query(`
      DELETE FROM album_service_mappings
      WHERE service NOT IN ('spotify', 'tidal', 'lastfm')
    `);

    await pool.query(`
      ALTER TABLE album_service_mappings
      ADD CONSTRAINT album_service_mappings_service_check
      CHECK (service IN ('spotify', 'tidal', 'lastfm'))
    `);
  },
};
