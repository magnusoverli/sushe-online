module.exports = {
  // Deployments can have different subsets. A down migration cannot infer
  // which indexes existed before this conditional cleanup.
  irreversible: true,
  async up(client) {
    await client.query(`
      DO $$
      DECLARE candidate record;
      BEGIN
        FOR candidate IN
          SELECT spec.idx FROM (VALUES
            ('users', 'idx_users_email', 'email'),
            ('users', 'idx_users_username', 'username'),
            ('albums', 'idx_albums_album_id', 'album_id'),
            ('user_preferences', 'idx_user_preferences_user_id', 'user_id'),
            ('master_lists', 'idx_master_lists_year', 'year'),
            ('aggregate_list_contributors', 'idx_aggregate_list_contributors_year_user', 'year, user_id')
          ) AS spec(tbl, idx, cols)
          JOIN pg_index i ON i.indexrelid = to_regclass(format('public.%I', spec.idx))
          WHERE NOT i.indisclustered AND NOT i.indisreplident
            AND pg_get_indexdef(i.indexrelid) =
                format('CREATE INDEX %I ON public.%I USING btree (%s)', spec.idx, spec.tbl, spec.cols)
            AND EXISTS (
              SELECT FROM pg_constraint k
              JOIN pg_index u ON u.indexrelid = k.conindid
              JOIN pg_class c ON c.oid = u.indexrelid
              WHERE k.conrelid = i.indrelid AND k.contype IN ('p','u')
                AND u.indisvalid AND u.indisready AND u.indislive
                AND pg_get_indexdef(u.indexrelid) =
                    format('CREATE UNIQUE INDEX %I ON public.%I USING btree (%s)', c.relname, spec.tbl, spec.cols)
            )
        LOOP
          EXECUTE format('DROP INDEX public.%I', candidate.idx);
        END LOOP;
      END $$`);
  },
};
