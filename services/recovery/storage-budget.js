const fs = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
const { positiveInteger } = require('../../config/limits');

async function withStorageBudget(client, database, env, signal, work) {
  const reserve = 256 * 1024 * 1024;
  const maximum = positiveInteger(
    env.RECOVERY_MAX_DATABASE_BYTES,
    2 * 1024 * 1024 * 1024,
    'RECOVERY_MAX_DATABASE_BYTES'
  );
  const abort = new AbortController();
  const monitorDone = new AbortController();
  let budgetError;
  const monitor = (async () => {
    try {
      while (!monitorDone.signal.aborted) {
        const capacity = await fs.statfs(
          env.RECOVERY_CAPACITY_PATH || '/database-capacity'
        );
        const result = await client.query(
          'SELECT pg_database_size($1) AS bytes',
          [database]
        );
        if (
          capacity.bavail * capacity.bsize < reserve ||
          Number(result.rows[0].bytes) > maximum
        )
          throw new Error('Recovery storage budget exceeded');
        await delay(250, undefined, { signal: monitorDone.signal });
      }
    } catch (error) {
      if (!monitorDone.signal.aborted) {
        budgetError = error;
        abort.abort();
      }
    }
  })();
  let result;
  let workError;
  try {
    result = await work(AbortSignal.any([signal, abort.signal]));
  } catch (error) {
    workError = error;
  } finally {
    monitorDone.abort();
    await monitor;
  }
  if (budgetError || workError) throw budgetError || workError;
  return result;
}

module.exports = { withStorageBudget };
