module.exports = {
  irreversible: true,
  async up(client) {
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.list_items'::regclass
          AND attname='position' AND attnotnull)
        AND EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.idx_list_items_position')
          AND indisvalid AND indisready AND indislive AND pg_get_indexdef(indexrelid) =
          'CREATE INDEX idx_list_items_position ON public.list_items USING btree (list_id, "position")')
        AND EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.idx_list_items_list_position')
          AND NOT indisclustered AND NOT indisreplident AND pg_get_indexdef(indexrelid) =
          'CREATE INDEX idx_list_items_list_position ON public.list_items USING btree (list_id, "position") WHERE ("position" IS NOT NULL)')
        THEN DROP INDEX public.idx_list_items_list_position; END IF;
      END $$`);
  },
};
