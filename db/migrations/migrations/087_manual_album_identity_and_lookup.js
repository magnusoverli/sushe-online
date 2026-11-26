const logger = require('../../../utils/logger');

module.exports = {
  async up(client) {
    await client.query(`
      ALTER TABLE albums ADD COLUMN manual_identity_alias boolean NOT NULL DEFAULT false;
      WITH ranked AS (
        SELECT id, row_number() OVER (
          PARTITION BY lower(trim(coalesce(artist,''))), lower(trim(coalesce(album,'')))
          ORDER BY created_at NULLS LAST, id
        ) AS rank FROM albums WHERE starts_with(album_id, 'internal-')
      )
      UPDATE albums SET manual_identity_alias = true FROM ranked
      WHERE albums.id = ranked.id AND ranked.rank > 1`);
    const { rows } = await client.query(
      'SELECT count(*)::int AS aliases FROM albums WHERE manual_identity_alias'
    );
    logger.info('Existing manual album IDs retained as aliases', rows[0]);
    await client.query(`
      CREATE UNIQUE INDEX albums_manual_identity ON albums
        (lower(trim(coalesce(artist,''))), lower(trim(coalesce(album,''))))
        WHERE starts_with(album_id,'internal-') AND NOT manual_identity_alias;
      CREATE INDEX albums_normalized_lookup ON albums
        (lower(trim(coalesce(artist,''))), lower(trim(coalesce(album,''))))`);
  },
  async down(client) {
    await client.query(`
      DROP INDEX albums_normalized_lookup, albums_manual_identity;
      ALTER TABLE albums DROP COLUMN manual_identity_alias`);
  },
};
