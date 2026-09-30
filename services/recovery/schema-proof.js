// Compare executable database objects before granting the restored database any
// application privileges. Catalog reads do not execute uploaded functions/views.
async function executableSchema(pool) {
  const result = await pool.query(`
    SELECT 'function' AS kind, p.oid::regprocedure::text AS name, pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND NOT EXISTS
      (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
    UNION ALL
    SELECT 'trigger', c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal
    UNION ALL
    SELECT 'default', c.relname || '.' || a.attname, pg_get_expr(d.adbin,d.adrelid)
    FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
    JOIN pg_class c ON c.oid=d.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    UNION ALL
    SELECT 'constraint', c.relname || '.' || k.conname, pg_get_constraintdef(k.oid)
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
    UNION ALL
    SELECT 'view', c.relname, pg_get_viewdef(c.oid)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('v','m')
    UNION ALL
    SELECT 'policy', c.relname || '.' || p.polname, COALESCE(pg_get_expr(p.polqual,p.polrelid),'') || COALESCE(pg_get_expr(p.polwithcheck,p.polrelid),'')
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    ORDER BY kind,name,definition`);
  return JSON.stringify(result.rows);
}

async function verifyExecutableSchema(candidate, source) {
  const grants =
    await candidate.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relacl IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') LIMIT 1`);
  if (grants.rows.length)
    throw new Error('Backup introduced unexpected object privileges');
  const databaseGrants =
    await candidate.query(`SELECT 1 FROM pg_database d, LATERAL aclexplode(d.datacl) a
    WHERE d.datname=current_database() AND a.grantee <> d.datdba LIMIT 1`);
  if (databaseGrants.rows.length)
    throw new Error('Backup introduced unexpected database privileges');
  const schemaGrants =
    await candidate.query(`SELECT 1 FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a
    WHERE n.nspname='public' AND a.grantee <> n.nspowner
    AND NOT (a.grantee=0 AND a.privilege_type='USAGE') LIMIT 1`);
  if (schemaGrants.rows.length)
    throw new Error('Backup introduced unexpected schema privileges');
  const unexpected = await candidate.query(`SELECT nspname FROM pg_namespace
    WHERE nspname NOT IN ('public','information_schema') AND nspname NOT LIKE 'pg_%'`);
  if (unexpected.rows.length)
    throw new Error('Backup contains unsupported schemas');
  if ((await executableSchema(candidate)) !== (await executableSchema(source)))
    throw new Error(
      'Restored executable schema differs from the verified application schema'
    );
}

module.exports = { verifyExecutableSchema };
