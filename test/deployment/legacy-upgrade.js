const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { Pool } = require('pg');
const request = require('supertest');
const { setTimeout: delay } = require('node:timers/promises');
const { createHash } = require('node:crypto');
const { databaseUrlFor } = require('../../config/database-connection');
const historicalMigrations = require('../fixtures/historical-migrations');

const api = request('http://app:3000');
const email = 'upgrade@example.test';
const password = 'synthetic-upgrade-password';
const cookies = (response) =>
  response.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
async function login() {
  const page = await api.get('/login').expect(200);
  const csrf = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const logged = await api
    .post('/login')
    .set('Cookie', cookies(page))
    .send({ email, password, _csrf: csrf })
    .expect(302);
  return cookies(logged);
}
async function fixture() {
  return JSON.parse(
    await fs.readFile('/state/application/fixture.json', 'utf8')
  );
}
async function state() {
  return JSON.parse(await fs.readFile('/state/.deployment/state.json', 'utf8'));
}
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function accessSnapshot() {
  const [privateMetrics, publicMetrics, httpsLogin, httpLogin] =
    await Promise.all([
      api.get('/metrics').set('X-Forwarded-For', '203.0.113.2, 10.1.2.3'),
      api.get('/metrics').set('X-Forwarded-For', '10.1.2.3, 203.0.113.2'),
      api.get('/login').set('X-Forwarded-Proto', 'https').expect(200),
      api.get('/login').set('X-Forwarded-Proto', 'http').expect(200),
    ]);
  return {
    privateMetrics: privateMetrics.status,
    publicMetrics: publicMetrics.status,
    httpsSecureCookie: httpsLogin.headers['set-cookie'].some((value) =>
      value.includes('; Secure')
    ),
    httpSecureCookie: httpLogin.headers['set-cookie'].some((value) =>
      value.includes('; Secure')
    ),
  };
}

async function seed() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const hash = await require('bcryptjs').hash(password, 10);
    await db.query(
      "INSERT INTO users(_id,email,username,hash,role,approval_status) VALUES ('upgrade-user',$1,'upgrade-user',$2,'admin','approved')",
      [email, hash]
    );
    await db.query(
      "INSERT INTO albums(album_id,artist,album,cover_image) VALUES ('upgrade-album','Retained Artist','Retained Album',$1)",
      [Buffer.from('retained-cover')]
    );
    const group = await db.query(
      "INSERT INTO list_groups(_id,user_id,name,sort_order) VALUES ('upgrade-group','upgrade-user','Retained group',0) RETURNING id"
    );
    await db.query(
      "INSERT INTO lists(_id,user_id,name,sort_order,group_id) VALUES ('upgrade-list','upgrade-user','Retained list',0,$1)",
      [group.rows[0].id]
    );
    await db.query(
      "INSERT INTO list_items(_id,list_id,album_id,position) VALUES ('upgrade-item','upgrade-list','upgrade-album',1)"
    );
    const cookie = await login();
    await api.get('/api/lists').set('Cookie', cookie).expect(200);
    const checksum = (
      await db.query(
        "SELECT checksum FROM schema_migrations WHERE version='081_list_revisions'"
      )
    ).rows[0].checksum;
    // Freshly seeded databases otherwise miss the historical ledger drift
    // carried by real long-lived installations of this same published image.
    for (const [version, recorded] of historicalMigrations) {
      await db.query(
        'UPDATE schema_migrations SET checksum=$1 WHERE version=$2',
        [recorded, version]
      );
    }
    await fs.writeFile(
      '/state/fixture.json',
      JSON.stringify({
        cookie,
        hash,
        checksum,
        access: await accessSnapshot(),
      }),
      { mode: 0o600 }
    );
  } finally {
    await db.end();
  }
  console.log('Published baseline seeded and authenticated');
}

async function verify(restart = false) {
  const deployment = await state();
  const saved = await fixture();
  assert.equal(deployment.verified, true);
  const owner = new Pool({
    connectionString: deployment.env.RECOVERY_DATABASE_URL,
  });
  const boot = new Pool({
    connectionString: deployment.env.PROVISION_DATABASE_URL,
  });
  let runtime;
  try {
    const active = (
      await owner.query('SELECT database_name FROM recovery_state WHERE id=1')
    ).rows[0].database_name;
    runtime = new Pool({
      connectionString: databaseUrlFor(deployment.env.DATABASE_URL, active),
    });
    const row = (
      await runtime.query(
        "SELECT u.hash,a.cover_image FROM users u JOIN lists l ON l.user_id=u._id JOIN list_items li ON li.list_id=l._id JOIN albums a ON a.album_id=li.album_id WHERE li._id='upgrade-item'"
      )
    ).rows[0];
    assert.equal(row.hash, saved.hash);
    assert.deepEqual(row.cover_image, Buffer.from('retained-cover'));
    assert.equal(
      (
        await boot.query(
          "SELECT datallowconn FROM pg_database WHERE datname='sushe'"
        )
      ).rows[0].datallowconn,
      false
    );
    assert.ok((await fs.stat('/state/.deployment/pre-upgrade.dump')).size > 0);
    assert.equal(
      (await fs.stat('/state/.deployment/state.json')).mode & 0o777,
      0o600
    );
    await assert.rejects(runtime.query('CREATE ROLE prohibited'), {
      code: '42501',
    });
    const tcp = new Pool({
      connectionString: 'postgres://postgres:example@db/sushe',
      connectionTimeoutMillis: 2000,
    });
    const oldSocket = new Pool({
      connectionString:
        'postgres://postgres:example@/postgres?host=/var/run/postgresql',
    });
    try {
      await assert.rejects(tcp.query('SELECT 1'), { code: '28000' });
      await assert.rejects(oldSocket.query('SELECT 1'), { code: '28P01' });
    } finally {
      await tcp.end();
      await oldSocket.end();
    }
    const cookie = restart ? await login() : saved.cookie;
    await api.get('/api/lists').set('Cookie', cookie).expect(200);
    await api.get('/ready').expect(200);
    assert.deepEqual(await accessSnapshot(), saved.access);
    if (saved.credentialsDigest)
      assert.equal(digest(deployment.env), saved.credentialsDigest);
    else {
      saved.credentialsDigest = digest(deployment.env);
      await fs.writeFile(
        '/state/application/fixture.json',
        JSON.stringify(saved)
      );
    }
    // Filesystem isolation is tested from the actual request-handler identity.
    assert.throws(
      () =>
        require('node:child_process').execFileSync(
          process.execPath,
          [
            '-e',
            "try { require('fs').readFileSync('/state/.deployment/state.json'); } catch(e) { if(e.code==='EACCES') process.exit(42); throw e; }",
          ],
          { uid: 1000, gid: 1000, stdio: 'ignore' }
        ),
      (error) => error.status === 42
    );
    console.log(
      restart
        ? 'Restart preserved active data and credentials'
        : 'Image-only upgrade preserved accounts, sessions, data and least privilege'
    );
  } finally {
    await runtime?.end();
    await owner.end();
    await boot.end();
  }
}

async function damage(repair = false) {
  const deployment = await state();
  const saved = await fixture();
  const control = new Pool({
    connectionString: deployment.env.RECOVERY_DATABASE_URL,
  });
  let db;
  try {
    const active = (
      await control.query('SELECT database_name FROM recovery_state WHERE id=1')
    ).rows[0].database_name;
    db = new Pool({
      connectionString: databaseUrlFor(
        deployment.env.MIGRATION_DATABASE_URL,
        active
      ),
    });
    await db.query(
      "UPDATE schema_migrations SET checksum=$1 WHERE version='081_list_revisions'",
      [repair ? saved.checksum : 'injected-checksum-failure']
    );
  } finally {
    await db?.end();
    await control.end();
  }
}

async function failed() {
  await delay(5000);
  await assert.rejects(api.get('/ready').timeout(2000).expect(200));
  assert.ok((await fs.stat('/state/.deployment/pre-upgrade.dump')).size);
  console.log(
    'Injected migration failure withheld readiness and retained the backup'
  );
}

async function initialDamage() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await db.query(
      "UPDATE schema_migrations SET checksum='injected-adoption-failure' WHERE version='081_list_revisions'"
    );
  } finally {
    await db.end();
  }
}

async function initialFailed() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const deployment = await state();
      if (deployment.backedUp) {
        await delay(2000);
        assert.equal((await state()).provisioned, undefined);
        await failed();
        return;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(500);
  }
  assert.fail('Initial adoption did not reach the injected failure');
}

async function initialRepair() {
  const deployment = await state();
  const saved = await fixture();
  const db = new Pool({
    connectionString: databaseUrlFor(
      deployment.env.PROVISION_DATABASE_URL,
      deployment.candidate
    ),
  });
  try {
    await db.query(
      "UPDATE schema_migrations SET checksum=$1 WHERE version='081_list_revisions'",
      [saved.checksum]
    );
    saved.credentialsDigest = digest(deployment.env);
    await fs.writeFile(
      '/state/application/fixture.json',
      JSON.stringify(saved)
    );
  } finally {
    await db.end();
  }
}

async function restore() {
  const deployment = await state();
  const service =
    require('../../services/admin-backup-service').createAdminBackupService({
      env: { ...process.env, ...deployment.env, DATA_DIR: '/tmp' },
    });
  const artifact = await service.createBackup();
  try {
    const cookie = await login();
    const csrf = (
      await api.get('/api/auth/csrf').set('Cookie', cookie).expect(200)
    ).body.csrfToken;
    const uploaded = await api
      .post('/admin/restore')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .attach('backup', artifact.filePath)
      .expect(202);
    const token = cookies(uploaded);
    for (let attempt = 0; attempt < 240; attempt++) {
      const status = (
        await api
          .get(`/admin/restore/${uploaded.body.restoreId}/status`)
          .set('Cookie', token)
          .expect(200)
      ).body;
      if (status.status === 'failed') assert.fail(JSON.stringify(status));
      if (status.status === 'completed') {
        console.log(
          'Admin restore completed through the compatibility supervisor'
        );
        return;
      }
      await delay(500);
    }
    assert.fail('Restore deadline exceeded');
  } finally {
    await artifact.cleanup();
  }
}

async function main() {
  assert.equal(process.env.DEPLOYMENT_REHEARSAL, 'disposable');
  const actions = {
    'initial-damage': initialDamage,
    'initial-failed': initialFailed,
    'initial-repair': initialRepair,
    seed,
    verify,
    restart: () => verify(true),
    damage,
    repair: () => damage(true),
    failed,
    restore,
  };
  await actions[process.argv[2]]();
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
