const RYM_SERVICE = 'rateyourmusic';

async function up(pool) {
  await pool.query(`
    ALTER TABLE albums
      ADD COLUMN IF NOT EXISTS availability_checked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS availability_resolution_version INTEGER NOT NULL DEFAULT 0
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'albums_availability_resolution_version_nonnegative'
          AND conrelid = 'albums'::regclass
      ) THEN
        ALTER TABLE albums
          ADD CONSTRAINT albums_availability_resolution_version_nonnegative
          CHECK (availability_resolution_version >= 0);
      END IF;
    END $$
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'album_service_mappings_rym_numeric_id'
          AND conrelid = 'album_service_mappings'::regclass
      ) THEN
        ALTER TABLE album_service_mappings
          ADD CONSTRAINT album_service_mappings_rym_numeric_id
          CHECK (
            service <> '${RYM_SERVICE}'
            OR external_album_id IS NULL
            OR external_album_id ~ '^[1-9][0-9]*$'
          );
      END IF;
    END $$
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_album_service_mappings_rym_numeric_id
      ON album_service_mappings (external_album_id)
      WHERE service = '${RYM_SERVICE}' AND external_album_id IS NOT NULL
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_album_service_mappings_rym_external_url
      ON album_service_mappings (external_url)
      WHERE service = '${RYM_SERVICE}' AND external_url IS NOT NULL
  `);
}

async function down(pool) {
  await pool.query(
    'DROP INDEX IF EXISTS idx_album_service_mappings_rym_external_url'
  );
  await pool.query(
    'DROP INDEX IF EXISTS idx_album_service_mappings_rym_numeric_id'
  );
  await pool.query(`
    ALTER TABLE album_service_mappings
      DROP CONSTRAINT IF EXISTS album_service_mappings_rym_numeric_id
  `);
  await pool.query(`
    ALTER TABLE albums
      DROP CONSTRAINT IF EXISTS albums_availability_resolution_version_nonnegative,
      DROP COLUMN IF EXISTS availability_resolution_version,
      DROP COLUMN IF EXISTS availability_checked_at
  `);
}

module.exports = { up, down };
