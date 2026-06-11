const logger = require('../../../utils/logger');

/**
 * Admin re-identification changes albums.album_id in place. Every FK that
 * references albums(album_id) defaults to ON UPDATE NO ACTION, so the update
 * fails with a foreign-key violation the moment the album is referenced
 * anywhere (list_items, mappings, recommendations, ...). Recreate each of
 * those FKs with ON UPDATE CASCADE, preserving its existing ON DELETE action,
 * so the rename propagates atomically.
 *
 * Constraints are discovered from pg_constraint rather than hardcoded names,
 * which keeps this correct on databases whose constraint names drifted from
 * the migration suite.
 */
async function up(pool) {
  logger.info('Recreating albums(album_id) FKs with ON UPDATE CASCADE...');

  await pool.query(`
    DO $$
    DECLARE
      fk RECORD;
    BEGIN
      FOR fk IN
        SELECT con.oid,
               con.conname,
               con.conrelid::regclass AS child_table,
               pg_get_constraintdef(con.oid) AS def
        FROM pg_constraint con
        WHERE con.contype = 'f'
          AND con.confrelid = 'albums'::regclass
          AND con.confupdtype <> 'c'
          AND EXISTS (
            SELECT 1
            FROM unnest(con.confkey) AS ck
            JOIN pg_attribute a
              ON a.attrelid = con.confrelid AND a.attnum = ck
            WHERE a.attname = 'album_id'
          )
      LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.child_table, fk.conname);
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s ON UPDATE CASCADE',
                       fk.child_table, fk.conname, fk.def);
        RAISE NOTICE 'Recreated % on % with ON UPDATE CASCADE', fk.conname, fk.child_table;
      END LOOP;
    END $$;
  `);

  logger.info('albums(album_id) FKs now cascade on update');
}

async function down(pool) {
  logger.info('Removing ON UPDATE CASCADE from albums(album_id) FKs...');

  await pool.query(`
    DO $$
    DECLARE
      fk RECORD;
    BEGIN
      FOR fk IN
        SELECT con.conname,
               con.conrelid::regclass AS child_table,
               replace(pg_get_constraintdef(con.oid), ' ON UPDATE CASCADE', '') AS def
        FROM pg_constraint con
        WHERE con.contype = 'f'
          AND con.confrelid = 'albums'::regclass
          AND con.confupdtype = 'c'
          AND EXISTS (
            SELECT 1
            FROM unnest(con.confkey) AS ck
            JOIN pg_attribute a
              ON a.attrelid = con.confrelid AND a.attnum = ck
            WHERE a.attname = 'album_id'
          )
      LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.child_table, fk.conname);
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', fk.child_table, fk.conname, fk.def);
      END LOOP;
    END $$;
  `);
}

module.exports = { up, down };
