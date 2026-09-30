const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Pool, escapeLiteral } = require('pg');
const { setTimeout: delay } = require('node:timers/promises');
const {
  databaseUrlFor,
  identifier,
  pgEnvironment,
} = require('../../config/database-connection');
const { runProcess } = require('../../utils/subprocess');
const { saveState } = require('./legacy-state');
const logger = require('../../utils/logger');

const UPGRADE_LOCK = 1400072554;
const HBA =
  'local all all scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n';

async function verifyCloneCapacity(client, database) {
  const data = (await client.query('SHOW data_directory')).rows[0]
    .data_directory;
  if (
    !/^\/var\/lib\/postgresql\/[a-zA-Z0-9_./-]+$/.test(data) ||
    data.includes('/../')
  )
    throw new Error('Unexpected published database storage path');
  await client.query('CREATE TEMP TABLE upgrade_capacity(line text)');
  try {
    await client.query(
      `COPY upgrade_capacity FROM PROGRAM ${escapeLiteral(`df -B1 --output=avail '${data}'`)}`
    );
    const capacity = await client.query(
      "SELECT trim(line) AS bytes FROM upgrade_capacity WHERE trim(line) ~ '^[0-9]+$'"
    );
    const size = (
      await client.query('SELECT pg_database_size($1) AS bytes', [database])
    ).rows[0].bytes;
    if (
      capacity.rows.length !== 1 ||
      BigInt(capacity.rows[0].bytes) < BigInt(size) * 2n + 64n * 1024n * 1024n
    )
      throw new Error(
        'Insufficient database space for the retained original, candidate and clone WAL'
      );
  } finally {
    await client.query('DROP TABLE upgrade_capacity');
  }
}

async function writeHba(client, file, text) {
  const lines = text.trimEnd().split('\n');
  // COPY writes one physical line per record. Baseline/generated HBA has no
  // backslash escapes; refuse an unexpected file rather than corrupting it.
  if (lines.some((line) => line.includes('\\')))
    throw new Error('Unsupported HBA escaping');
  if (
    !/^\/var\/lib\/postgresql\/[a-zA-Z0-9_./-]+\/pg_hba\.conf$/.test(file) ||
    file.includes('/../')
  )
    throw new Error('Unexpected published database authentication path');
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  // PostgreSQL owns these files in another container. Write, sync and rename
  // there so interruption or a full disk cannot truncate the active HBA file.
  const command = `umask 077; cat > '${temporary}' && sync -f '${temporary}' && mv -f '${temporary}' '${file}' && sync -f '${path.dirname(file)}'`;
  await client.query(
    `COPY (SELECT unnest(ARRAY[${lines.map(escapeLiteral).join(',')}])) TO PROGRAM ${escapeLiteral(command)}`
  );
  const errors = await client.query(
    'SELECT 1 FROM pg_hba_file_rules WHERE error IS NOT NULL'
  );
  if (errors.rows.length)
    throw new Error('Database authentication rules failed validation');
  await client.query('SELECT pg_reload_conf()');
}

async function hardenAuthentication(client, deployment) {
  const { state, directory } = deployment;
  if (!state.hbaFile) {
    state.hbaFile = (await client.query('SHOW hba_file')).rows[0].hba_file;
    const original = (
      await client.query('SELECT pg_read_file($1,0,1048576) AS content', [
        state.hbaFile,
      ])
    ).rows[0].content;
    await fs
      .writeFile(path.join(directory, 'original-pg_hba.conf'), original, {
        flag: 'wx',
        mode: 0o600,
      })
      .catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
    const backup = await fs.open(
      path.join(directory, 'original-pg_hba.conf'),
      'r'
    );
    try {
      await backup.sync();
    } finally {
      await backup.close();
    }
    await saveState(directory, state);
  }
  const password = new URL(state.env.PROVISION_DATABASE_URL).password;
  await client.query("SET password_encryption='scram-sha-256'");
  await client.query(`ALTER ROLE postgres PASSWORD ${escapeLiteral(password)}`);
  await writeHba(client, state.hbaFile, HBA);
  for (let attempt = 0; attempt < 50; attempt++) {
    const bad = new URL(state.env.PROVISION_DATABASE_URL);
    bad.password = 'incorrect-upgrade-probe';
    const pool = new Pool({
      connectionString: bad.toString(),
      connectionTimeoutMillis: 1000,
    });
    let rejected = false;
    try {
      await pool.query('SELECT 1');
    } catch (error) {
      if (error.code === '28P01') rejected = true;
      else throw error;
    } finally {
      await pool.end();
    }
    if (rejected) {
      const valid = new Pool({
        connectionString: state.env.PROVISION_DATABASE_URL,
        connectionTimeoutMillis: 2000,
      });
      try {
        await valid.query('SELECT 1');
      } finally {
        await valid.end();
      }
      state.hardened = true;
      await saveState(directory, state);
      return;
    }
    await delay(100);
  }
  throw new Error('Database authentication reload was not confirmed');
}

async function prepareLegacyUpgrade(deployment, env, abort) {
  const signal = abort.signal;
  const { state, directory } = deployment;
  const pool = new Pool({
    connectionString: state.env.PROVISION_DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 1800000,
    query_timeout: 1805000,
    lock_timeout: 60000,
  });
  pool.on('error', () => abort.abort());
  let client;
  try {
    client = await pool.connect();
    client.on('error', () => abort.abort());
    if (
      !(
        await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [
          UPGRADE_LOCK,
        ])
      ).rows[0].acquired
    )
      throw new Error('Another managed application owns this deployment');
    const version = Number(
      (await client.query('SHOW server_version_num')).rows[0].server_version_num
    );
    if (version < 180000 || version >= 190000)
      throw new Error(
        'Automatic published-baseline upgrade requires PostgreSQL 18'
      );
    if (!state.cloned) await verifyCloneCapacity(client, state.original);
    logger.info('Automatic deployment: verifying database authentication');
    await hardenAuthentication(client, deployment);
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename=current_user AND pid<>pg_backend_pid()'
    );
    if (!state.cloned) {
      logger.info('Automatic deployment: retaining original database');
      // Fence before cloning: the retained original is the exact cutover point.
      await client.query(
        `ALTER DATABASE ${identifier(state.original)} ALLOW_CONNECTIONS false`
      );
      await client.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',
        [state.original]
      );
      const existing = await client.query(
        'SELECT 1 FROM pg_database WHERE datname=$1',
        [state.candidate]
      );
      if (!existing.rows.length)
        await client.query(
          `CREATE DATABASE ${identifier(state.candidate)} TEMPLATE ${identifier(state.original)}`
        );
      state.cloned = true;
      await saveState(directory, state);
    }
    if (!state.backedUp) {
      logger.info(
        'Automatic deployment: creating protected pre-upgrade backup'
      );
      const bytes = Number(
        (
          await client.query('SELECT pg_database_size($1) AS bytes', [
            state.candidate,
          ])
        ).rows[0].bytes
      );
      const available = await fs.statfs(directory);
      if (available.bavail * available.bsize < bytes + 64 * 1024 * 1024)
        throw new Error('Insufficient space for the pre-upgrade backup');
      const temporary = path.join(directory, 'pre-upgrade.partial');
      const backup = path.join(directory, 'pre-upgrade.dump');
      await runProcess(
        'pg_dump',
        ['--format=custom', '--no-owner', '--no-privileges'],
        {
          env: pgEnvironment(
            databaseUrlFor(state.env.PROVISION_DATABASE_URL, state.candidate),
            env
          ),
          output: createWriteStream(temporary, { mode: 0o600 }),
          signal,
          timeoutMs: 1800000,
          maxOutputBytes: Math.max(bytes * 2, 1024 * 1024 * 1024),
        }
      );
      await runProcess('pg_restore', ['--list', temporary], {
        signal,
        timeoutMs: 60000,
        maxOutputBytes: 16 * 1024 * 1024,
      });
      const handle = await fs.open(temporary, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, backup);
      state.backedUp = true;
      await saveState(directory, state);
    }
    if (!state.provisioned) {
      logger.info(
        'Automatic deployment: provisioning and migrating isolated candidate'
      );
      await runProcess(process.execPath, ['scripts/provision-database.js'], {
        env: { ...env, ...state.env, ADOPT_EXISTING_DATABASE: 'true' },
        signal,
        timeoutMs: 1800000,
      });
      state.provisioned = true;
      await saveState(directory, state);
    }
    signal.throwIfAborted();
    return {
      client,
      close: async () => {
        client.release();
        await pool.end();
      },
    };
  } catch (error) {
    client?.release();
    await pool.end();
    throw error;
  }
}

module.exports = { prepareLegacyUpgrade, hardenAuthentication, writeHba };
