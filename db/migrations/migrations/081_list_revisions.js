module.exports = {
  async up(client) {
    await client.query(`ALTER TABLE lists ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;
      CREATE OR REPLACE FUNCTION bump_list_revision() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.revision := OLD.revision + 1; RETURN NEW; END $$;
      CREATE TRIGGER lists_revision_changed BEFORE UPDATE ON lists FOR EACH ROW EXECUTE FUNCTION bump_list_revision();
      CREATE OR REPLACE FUNCTION touch_item_list_revision() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP <> 'INSERT' THEN UPDATE lists SET updated_at = clock_timestamp() WHERE _id = OLD.list_id; END IF;
        IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.list_id <> OLD.list_id) THEN
          UPDATE lists SET updated_at = clock_timestamp() WHERE _id = NEW.list_id;
        END IF;
        RETURN NULL;
      END $$;
      CREATE TRIGGER list_items_revision_changed AFTER INSERT OR UPDATE OR DELETE ON list_items
        FOR EACH ROW EXECUTE FUNCTION touch_item_list_revision();`);
  },
  async down(client) {
    await client.query(`DROP TRIGGER IF EXISTS list_items_revision_changed ON list_items;
      DROP FUNCTION IF EXISTS touch_item_list_revision();
      DROP TRIGGER IF EXISTS lists_revision_changed ON lists;
      DROP FUNCTION IF EXISTS bump_list_revision();
      ALTER TABLE lists DROP COLUMN IF EXISTS revision;`);
  },
};
