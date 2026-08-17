const logger = require('../../../utils/logger');

const TAXONOMY_DEFAULT = `'{"schema_version":1,"manual_overrides":{}}'::jsonb`;

async function up(pool) {
  logger.info('Adding structured album taxonomy storage...');

  await pool.query(`
    ALTER TABLE albums
    ADD COLUMN IF NOT EXISTS album_taxonomy JSONB NOT NULL DEFAULT ${TAXONOMY_DEFAULT},
    ADD COLUMN IF NOT EXISTS taxonomy_updated_at TIMESTAMPTZ
  `);

  // Existing scalar genres are user-visible data with unknown provenance. Keep
  // them authoritative until a user resets them or an identical RYM value
  // proves that the legacy override is no longer needed.
  await pool.query(`
    UPDATE albums
    SET album_taxonomy = jsonb_set(
          album_taxonomy,
          '{manual_overrides}',
          album_taxonomy->'manual_overrides'
          || CASE
               WHEN btrim(COALESCE(genre_1, '')) <> ''
                 AND NOT (album_taxonomy->'manual_overrides' ? 'genre_1')
               THEN jsonb_build_object(
                 'genre_1',
                 jsonb_build_object('value', genre_1, 'source', 'legacy_backfill')
               )
               ELSE '{}'::jsonb
             END
          || CASE
               WHEN btrim(COALESCE(genre_2, '')) <> ''
                 AND NOT (album_taxonomy->'manual_overrides' ? 'genre_2')
               THEN jsonb_build_object(
                 'genre_2',
                 jsonb_build_object('value', genre_2, 'source', 'legacy_backfill')
               )
               ELSE '{}'::jsonb
             END
        ),
        taxonomy_updated_at = NOW()
    WHERE (
        btrim(COALESCE(genre_1, '')) <> ''
        AND NOT (album_taxonomy->'manual_overrides' ? 'genre_1')
      ) OR (
        btrim(COALESCE(genre_2, '')) <> ''
        AND NOT (album_taxonomy->'manual_overrides' ? 'genre_2')
      )
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'albums_album_taxonomy_shape_check'
          AND conrelid = 'albums'::regclass
      ) THEN
        ALTER TABLE albums
        ADD CONSTRAINT albums_album_taxonomy_shape_check
        CHECK (
          jsonb_typeof(album_taxonomy) = 'object'
          AND album_taxonomy ? 'schema_version'
          AND album_taxonomy->'schema_version' = '1'::jsonb
          AND album_taxonomy ? 'manual_overrides'
          AND jsonb_typeof(album_taxonomy->'manual_overrides') = 'object'
          AND (
            (album_taxonomy->'manual_overrides')
              - 'genre_1'::text
              - 'genre_2'::text
          ) = '{}'::jsonb
          AND (
            NOT (album_taxonomy->'manual_overrides' ? 'genre_1')
            OR (
              jsonb_typeof(album_taxonomy->'manual_overrides'->'genre_1') = 'object'
               AND album_taxonomy->'manual_overrides'->'genre_1' ? 'value'
               AND jsonb_typeof(album_taxonomy->'manual_overrides'->'genre_1'->'value')
                 IN ('string', 'null')
              AND album_taxonomy->'manual_overrides'->'genre_1' ? 'source'
              AND album_taxonomy->'manual_overrides'->'genre_1'->>'source'
                IN ('manual', 'legacy_backfill')
              AND (
                NOT (album_taxonomy->'manual_overrides'->'genre_1' ? 'updated_by')
                OR jsonb_typeof(album_taxonomy->'manual_overrides'->'genre_1'->'updated_by')
                  IN ('string', 'null')
              )
            )
          )
          AND (
            NOT (album_taxonomy->'manual_overrides' ? 'genre_2')
            OR (
              jsonb_typeof(album_taxonomy->'manual_overrides'->'genre_2') = 'object'
               AND album_taxonomy->'manual_overrides'->'genre_2' ? 'value'
               AND jsonb_typeof(album_taxonomy->'manual_overrides'->'genre_2'->'value')
                 IN ('string', 'null')
              AND album_taxonomy->'manual_overrides'->'genre_2' ? 'source'
              AND album_taxonomy->'manual_overrides'->'genre_2'->>'source'
                IN ('manual', 'legacy_backfill')
              AND (
                NOT (album_taxonomy->'manual_overrides'->'genre_2' ? 'updated_by')
                OR jsonb_typeof(album_taxonomy->'manual_overrides'->'genre_2'->'updated_by')
                  IN ('string', 'null')
              )
            )
          )
          AND (
            NOT (album_taxonomy ? 'rym')
            OR (
              jsonb_typeof(album_taxonomy->'rym') = 'object'
              AND album_taxonomy->'rym' ? 'primary_genres'
              AND jsonb_typeof(album_taxonomy->'rym'->'primary_genres') = 'array'
              AND jsonb_array_length(album_taxonomy->'rym'->'primary_genres') <= 32
              AND NOT jsonb_path_exists(
                album_taxonomy->'rym'->'primary_genres',
                '$[*] ? (@.type() != "string")'
              )
              AND album_taxonomy->'rym' ? 'secondary_genres'
              AND jsonb_typeof(album_taxonomy->'rym'->'secondary_genres') = 'array'
              AND jsonb_array_length(album_taxonomy->'rym'->'secondary_genres') <= 32
              AND NOT jsonb_path_exists(
                album_taxonomy->'rym'->'secondary_genres',
                '$[*] ? (@.type() != "string")'
              )
              AND album_taxonomy->'rym' ? 'descriptors'
              AND jsonb_typeof(album_taxonomy->'rym'->'descriptors') = 'array'
              AND jsonb_array_length(album_taxonomy->'rym'->'descriptors') <= 128
              AND NOT jsonb_path_exists(
                album_taxonomy->'rym'->'descriptors',
                '$[*] ? (@.type() != "string")'
              )
              AND album_taxonomy->'rym' ? 'source_url'
              AND jsonb_typeof(album_taxonomy->'rym'->'source_url') = 'string'
              AND char_length(album_taxonomy->'rym'->>'source_url') BETWEEN 1 AND 2048
              AND album_taxonomy->'rym' ? 'extractor_version'
              AND jsonb_typeof(album_taxonomy->'rym'->'extractor_version') = 'string'
              AND char_length(album_taxonomy->'rym'->>'extractor_version') BETWEEN 1 AND 64
               AND album_taxonomy->'rym' ? 'complete'
               AND album_taxonomy->'rym'->'complete' = 'true'::jsonb
               AND album_taxonomy->'rym' ? 'received_at'
               AND jsonb_typeof(album_taxonomy->'rym'->'received_at') = 'string'
               AND (
                 NOT (album_taxonomy->'rym' ? 'captured_at')
                 OR album_taxonomy->'rym'->'captured_at' = 'null'::jsonb
                 OR jsonb_typeof(album_taxonomy->'rym'->'captured_at') = 'string'
               )
             )
          )
        ) NOT VALID;

        ALTER TABLE albums
        VALIDATE CONSTRAINT albums_album_taxonomy_shape_check;
      END IF;
    END $$;
  `);

  logger.info('Structured album taxonomy storage added');
}

async function down(pool) {
  logger.info('Removing structured album taxonomy storage...');

  await pool.query(`
    ALTER TABLE albums
    DROP CONSTRAINT IF EXISTS albums_album_taxonomy_shape_check,
    DROP COLUMN IF EXISTS taxonomy_updated_at,
    DROP COLUMN IF EXISTS album_taxonomy
  `);
}

module.exports = { up, down };
