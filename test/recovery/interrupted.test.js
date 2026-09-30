const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { createControlStore } = require('../../services/recovery/control-store');
const { until } = require('../../services/recovery/worker');

test(
  'durable recovery fencing survives interrupted phases and exclusive admission spans independent clients',
  { timeout: 180000 },
  async () => {
    assert.equal(process.env.RECOVERY_REHEARSAL, 'disposable');
    const controls = [
      createControlStore(process.env.CONTROL_DATABASE_URL),
      createControlStore(process.env.CONTROL_DATABASE_URL),
    ];
    const privileged = new Pool({
      connectionString: process.env.RECOVERY_DATABASE_URL,
    });
    const lock = await privileged.connect();
    let locked = false;
    try {
      const source = (await controls[0].state()).database_name;
      await lock.query('SELECT pg_advisory_lock($1)', [1400072553]);
      locked = true;
      const attempts = await Promise.all(
        controls.map((control) =>
          control.begin('synthetic-admin', randomBytes(32).toString('hex'))
        )
      );
      assert.equal(attempts.filter(Boolean).length, 1);
      await lock.query(
        "UPDATE recovery_jobs SET updated_at=NOW()-INTERVAL '1 hour' WHERE id=$1",
        [attempts.find(Boolean).id]
      );
      await lock.query('SELECT pg_advisory_unlock($1)', [1400072553]);
      locked = false;
      await until(
        async () =>
          (await controls[0].get(attempts.find(Boolean).id)).status === 'failed'
      );
      const phases = [
        'validating',
        'staging',
        'verifying',
        'quiescing',
        'switching',
        'verifying-live',
        'recovery-required',
      ];
      for (const phase of phases) {
        await lock.query('SELECT pg_advisory_lock($1)', [1400072553]);
        locked = true;
        const id = randomUUID();
        await lock.query(
          `INSERT INTO recovery_jobs(id,actor,status,source_db,candidate_db,status_key)
        VALUES ($1,'synthetic-admin',$2,$3,$4,'test')`,
          [id, phase, source, `restore_${id.replaceAll('-', '')}`]
        );
        const cutoverStarted = [
          'quiescing',
          'switching',
          'verifying-live',
          'recovery-required',
        ].includes(phase);
        if (cutoverStarted)
          await lock.query(
            'UPDATE recovery_state SET operation_id=$1,maintenance=true,epoch=epoch+1 WHERE id=1',
            [id]
          );
        await lock.query('SELECT pg_advisory_unlock($1)', [1400072553]);
        locked = false;
        await until(
          async () =>
            ['failed', 'rolled-back'].includes(
              (await controls[0].get(id)).status
            ),
          undefined,
          20000
        );
        const job = await controls[0].get(id);
        assert.equal(
          job.status,
          cutoverStarted ? 'rolled-back' : 'failed',
          phase
        );
        const state = await controls[0].state();
        assert.equal(state.database_name, source, phase);
        assert.equal(state.maintenance, false, phase);
        assert.equal(state.operation_id, null, phase);
        const response = await fetch('http://recovery:3000/ready');
        assert.ok(response.ok, phase);
        await response.body.cancel();
      }
    } finally {
      if (locked)
        await lock.query('SELECT pg_advisory_unlock($1)', [1400072553]);
      lock.release();
      await privileged.end();
      await Promise.all(controls.map((control) => control.close()));
    }
  }
);
