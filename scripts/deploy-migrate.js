const { createControlStore } = require('../services/recovery/control-store');
const { RECOVERY_LOCK } = require('../services/recovery/constants');
const { databaseUrlFor } = require('../config/database-connection');
const { positiveInteger } = require('../config/limits');
const { runProcess } = require('../utils/subprocess');

async function main(env = process.env) {
  const control = createControlStore(env.CONTROL_DATABASE_URL);
  if (!control) throw new Error('CONTROL_DATABASE_URL is required');
  let client;
  let locked = false;
  const abort = new AbortController();
  const lost = () => abort.abort();
  try {
    client = await control.pool.connect();
    client.on('error', lost);
    // Serialize deploys and restores across their separate database connections.
    await client.query('SELECT pg_advisory_lock($1)', [RECOVERY_LOCK]);
    locked = true;
    const state = (
      await client.query('SELECT * FROM recovery_state WHERE id=1')
    ).rows[0];
    if (
      !state ||
      state.operation_id ||
      state.maintenance ||
      (await control.active())
    )
      throw new Error('Cannot deploy migrations during recovery');
    await runProcess(
      process.execPath,
      ['scripts/migrate.js', process.argv[2] || 'up'],
      {
        env: {
          ...env,
          MIGRATION_DATABASE_URL: databaseUrlFor(
            env.MIGRATION_DATABASE_URL,
            state.database_name
          ),
        },
        signal: abort.signal,
        timeoutMs: positiveInteger(
          env.MIGRATION_DEADLINE_MS,
          1800000,
          'MIGRATION_DEADLINE_MS'
        ),
      }
    );
    console.log('Deployment migrations completed');
  } finally {
    if (client) {
      if (locked && !abort.signal.aborted)
        await client
          .query('SELECT pg_advisory_unlock($1)', [RECOVERY_LOCK])
          .catch(() => abort.abort());
      client.removeListener('error', lost);
      client.release(
        abort.signal.aborted ? new Error('Deployment lease lost') : undefined
      );
    }
    await control.close();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error('Deployment migration failed');
    process.exitCode = 1;
  });
module.exports = { main };
