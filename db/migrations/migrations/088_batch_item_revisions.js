const original = require('./081_list_revisions');

module.exports = {
  async up(client) {
    await client.query(`
      DROP TRIGGER list_items_revision_changed ON list_items;
      DROP FUNCTION touch_item_list_revision();
      CREATE OR REPLACE FUNCTION bump_list_revision() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF pg_trigger_depth() = 1 OR NEW.revision <= OLD.revision THEN
          NEW.revision := OLD.revision + 1;
        END IF;
        RETURN NEW;
      END $$`);
    for (const [event, transition, affected] of [
      ['insert', 'NEW TABLE AS n', 'SELECT list_id FROM n'],
      ['delete', 'OLD TABLE AS o', 'SELECT list_id FROM o'],
      [
        'update',
        'OLD TABLE AS o NEW TABLE AS n',
        `SELECT list_id FROM o UNION ALL
         SELECT n.list_id FROM n JOIN o USING (id) WHERE n.list_id <> o.list_id`,
      ],
    ]) {
      await client.query(`
        CREATE FUNCTION touch_lists_after_${event}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          WITH touched AS (${affected}),
          counts AS (SELECT list_id, count(*) AS delta FROM touched GROUP BY list_id)
          UPDATE lists SET updated_at = clock_timestamp(), revision = revision + counts.delta
          FROM counts WHERE lists._id = counts.list_id;
          RETURN NULL;
        END $$;
        CREATE TRIGGER list_items_revision_${event} AFTER ${event} ON list_items
        REFERENCING ${transition} FOR EACH STATEMENT EXECUTE FUNCTION touch_lists_after_${event}()`);
    }
  },
  async down(client) {
    for (const event of ['insert', 'delete', 'update']) {
      await client.query(`DROP TRIGGER list_items_revision_${event} ON list_items;
        DROP FUNCTION touch_lists_after_${event}()`);
    }
    await client.query('DROP TRIGGER lists_revision_changed ON lists');
    await original.up(client);
  },
};
