const logger = require('../../../utils/logger');

function optionalStringCheck(field) {
  return `(
    NOT (album_taxonomy->'rym' ? '${field}')
    OR jsonb_typeof(album_taxonomy->'rym'->'${field}') = 'string'
  )`;
}

function optionalObjectArrayCheck(field, limit) {
  return `(
    NOT (album_taxonomy->'rym' ? '${field}')
    OR (
      jsonb_typeof(album_taxonomy->'rym'->'${field}') = 'array'
      AND jsonb_array_length(album_taxonomy->'rym'->'${field}') <= ${limit}
      AND NOT jsonb_path_exists(
        album_taxonomy->'rym'->'${field}',
        '$[*] ? (@.type() != "object")'
      )
    )
  )`;
}

async function up(pool) {
  logger.info('Adding RYM release metadata validation...');
  const fieldChecks = [
    optionalStringCheck('release_type'),
    optionalObjectArrayCheck('labels', 64),
    optionalObjectArrayCheck('credits', 256),
  ].join('\nAND ');

  await pool.query(`
    ALTER TABLE albums
    ADD CONSTRAINT albums_rym_release_metadata_shape_check
    CHECK (
      NOT (album_taxonomy ? 'rym')
      OR (${fieldChecks})
    ) NOT VALID
  `);
  await pool.query(`
    ALTER TABLE albums
    VALIDATE CONSTRAINT albums_rym_release_metadata_shape_check
  `);
  logger.info('RYM release metadata validation added');
}

async function down(pool) {
  await pool.query(`
    ALTER TABLE albums
    DROP CONSTRAINT IF EXISTS albums_rym_release_metadata_shape_check
  `);
}

module.exports = { up, down };
