const logger = require('../../../utils/logger');

const OPTIONAL_ARRAY_FIELDS = [
  ['languages', 32],
  ['scenes', 32],
  ['movements', 32],
];

function optionalArrayCheck(field, limit) {
  return `(
    NOT (album_taxonomy->'rym' ? '${field}')
    OR (
      jsonb_typeof(album_taxonomy->'rym'->'${field}') = 'array'
      AND jsonb_array_length(album_taxonomy->'rym'->'${field}') <= ${limit}
      AND NOT jsonb_path_exists(
        album_taxonomy->'rym'->'${field}',
        '$[*] ? (@.type() != "string")'
      )
    )
  )`;
}

async function up(pool) {
  logger.info('Adding extended RYM taxonomy validation...');
  const fieldChecks = OPTIONAL_ARRAY_FIELDS.map(([field, limit]) =>
    optionalArrayCheck(field, limit)
  ).join('\nAND ');

  await pool.query(`
    ALTER TABLE albums
    ADD CONSTRAINT albums_rym_extended_taxonomy_shape_check
    CHECK (
      NOT (album_taxonomy ? 'rym')
      OR (${fieldChecks})
    ) NOT VALID
  `);
  await pool.query(`
    ALTER TABLE albums
    VALIDATE CONSTRAINT albums_rym_extended_taxonomy_shape_check
  `);
  logger.info('Extended RYM taxonomy validation added');
}

async function down(pool) {
  await pool.query(`
    ALTER TABLE albums
    DROP CONSTRAINT IF EXISTS albums_rym_extended_taxonomy_shape_check
  `);
}

module.exports = { up, down };
