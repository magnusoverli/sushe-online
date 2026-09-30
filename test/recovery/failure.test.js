const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { createControlStore } = require('../../services/recovery/control-store');
const {
  createAdminBackupService,
} = require('../../services/admin-backup-service');
const { createRecoveryWorker } = require('../../services/recovery/worker');
const { databaseUrlFor } = require('../../config/database-connection');

test(
  'corrupt archives preserve live data; failed authenticated post-switch probe automatically rolls back',
  { timeout: 120000 },
  async () => {
    assert.equal(process.env.RECOVERY_REHEARSAL, 'disposable');
    const control = createControlStore(process.env.RECOVERY_DATABASE_URL);
    const lease = await control.pool.connect();
    const source = (await control.state()).database_name;
    let artifact;
    let server;
    try {
      // Hold the real lease so this injected-probe worker owns the operation.
      await lease.query('SELECT pg_advisory_lock($1)', [1400072553]);
      const leasedControl = {
        ...control,
        pool: {
          connect: async () => ({
            query: lease.query.bind(lease),
            on: lease.on.bind(lease),
            removeListener: lease.removeListener.bind(lease),
            release() {},
          }),
        },
      };
      const queue = async (file) => {
        const job = await control.begin(
          'synthetic-admin',
          randomBytes(32).toString('hex')
        );
        assert.ok(job);
        const directory = path.join(process.env.RECOVERY_UPLOAD_DIR, job.id);
        await fs.mkdir(directory);
        const destination = path.join(directory, 'backup.dump');
        if (file) await fs.copyFile(file, destination);
        else await fs.writeFile(destination, 'PGDMPcorrupt');
        await control.uploaded(job.id, (await fs.stat(destination)).size);
        return job;
      };
      const corrupt = await queue();
      await createRecoveryWorker(leasedControl).processNext();
      assert.equal((await control.get(corrupt.id)).status, 'failed');
      assert.equal((await control.state()).database_name, source);
      artifact = await createAdminBackupService({
        env: {
          ...process.env,
          BACKUP_DATABASE_URL: databaseUrlFor(
            process.env.BACKUP_DATABASE_URL,
            source
          ),
        },
      }).createBackup();
      let probeCalls = 0;
      server = http.createServer(async (req, res) => {
        if (req.url === '/api/lists') {
          probeCalls++;
          res.writeHead(500).end();
          return;
        }
        const response = await fetch('http://app:3000/ready');
        res.writeHead(response.status, { 'content-type': 'application/json' });
        res.end(await response.text());
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const failedProbe = await queue(artifact.filePath);
      const workerEnv = {
        ...process.env,
        RECOVERY_APP_URL: `http://127.0.0.1:${server.address().port}`,
        RECOVERY_CAPACITY_PATH: '/tmp',
      };
      await createRecoveryWorker(leasedControl, workerEnv).processNext();
      assert.equal(
        probeCalls,
        1,
        'Failure must reach the authenticated post-cutover probe'
      );
      assert.equal((await control.get(failedProbe.id)).status, 'rolled-back');
      const state = await control.state();
      assert.equal(state.database_name, source);
      assert.equal(state.operation_id, null);
      assert.equal(state.maintenance, false);
      const ready = await fetch('http://recovery:3000/ready');
      assert.ok(ready.ok);
      await ready.body.cancel();
    } finally {
      if (artifact) await artifact.cleanup();
      if (server) await new Promise((resolve) => server.close(resolve));
      await lease.query('SELECT pg_advisory_unlock($1)', [1400072553]);
      lease.release();
      await control.close();
    }
  }
);
