const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const request = require('supertest');
const fs = require('node:fs/promises');
const {
  createAdminBackupService,
} = require('../../services/admin-backup-service');
const { databaseUrlFor } = require('../../config/database-connection');
const { until } = require('../../services/recovery/worker');

test(
  'production image: isolated role permissions, admin upload, automatic switch and preserved original',
  { timeout: 180000 },
  async () => {
    assert.equal(process.env.RECOVERY_REHEARSAL, 'disposable');
    const runtime = new Pool({ connectionString: process.env.DATABASE_URL });
    const owner = new Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    });
    const control = new Pool({
      connectionString: process.env.RECOVERY_DATABASE_URL,
    });
    for (const pool of [runtime, owner, control]) pool.on('error', () => {});
    let artifact;
    try {
      for (const sql of [
        'CREATE TABLE prohibited(id int)',
        'DROP TABLE users',
        'CREATE ROLE prohibited',
        "UPDATE schema_migrations SET checksum='bad'",
      ]) {
        await assert.rejects(runtime.query(sql), { code: '42501' });
      }
      await runtime.query(
        "UPDATE users SET accent_color='#112233' WHERE email='recovery@example.test'"
      );
      const adminId = (
        await runtime.query(
          "SELECT _id FROM users WHERE email='recovery@example.test'"
        )
      ).rows[0]._id;
      const albumId = require('node:crypto').randomUUID();
      const coverBytes = Buffer.from('synthetic-binary-cover');
      await runtime.query(
        "INSERT INTO albums(album_id,artist,album,cover_image) VALUES ($1,'Restore Artist','Restore Album',$2)",
        [albumId, coverBytes]
      );
      const group = await runtime.query(
        "INSERT INTO list_groups(_id,user_id,name,sort_order) VALUES ('restore-fixture-group',$1,'Restore fixture',0) RETURNING id",
        [adminId]
      );
      await runtime.query(
        "INSERT INTO lists(_id,user_id,name,sort_order,group_id) VALUES ('restore-fixture-list',$1,'Restore fixture',0,$2)",
        [adminId, group.rows[0].id]
      );
      await runtime.query(
        "INSERT INTO list_items(_id,list_id,album_id,position) VALUES ('restore-fixture-item','restore-fixture-list',$1,1)",
        [albumId]
      );
      const backup = createAdminBackupService();
      artifact = await backup.createBackup();
      await runtime.query(
        "UPDATE users SET accent_color='#445566' WHERE email='recovery@example.test'"
      );
      const api = request('http://recovery:3000');
      const loginPage = await api
        .get('/login')
        .set('X-Forwarded-Proto', 'https')
        .expect(200);
      let cookie = loginPage.headers['set-cookie']
        .map((v) => v.split(';')[0])
        .join('; ');
      const csrf = loginPage.text.match(/name="_csrf" value="([^"]+)"/)[1];
      const login = await api
        .post('/login')
        .set('Cookie', cookie)
        .set('X-Forwarded-Proto', 'https')
        .send({
          _csrf: csrf,
          email: process.env.BOOTSTRAP_ADMIN_EMAIL,
          password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
        })
        .expect(302);
      cookie = login.headers['set-cookie']
        .map((v) => v.split(';')[0])
        .join('; ');
      const page = await api
        .get('/api/auth/csrf')
        .set('Cookie', cookie)
        .set('X-Forwarded-Proto', 'https')
        .expect(200);
      const csrf2 = page.body.csrfToken;
      assert.ok(csrf2, 'Authenticated page must expose the real CSRF token');
      const uploaded = await api
        .post('/admin/restore')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrf2)
        .set('X-Forwarded-Proto', 'https')
        .attach('backup', artifact.filePath)
        .expect(202);
      const id = uploaded.body.restoreId;
      const statusCookie = uploaded.headers['set-cookie']
        .map((v) => v.split(';')[0])
        .join('; ');
      await api.get(`/admin/restore/${id}/status`).expect(403);
      let status;
      await until(
        async () => {
          const response = await api
            .get(`/admin/restore/${id}/status`)
            .set('Cookie', statusCookie)
            .expect(200);
          status = response.body;
          return ['completed', 'failed'].includes(status.status);
        },
        undefined,
        120000
      );
      assert.equal(status.status, 'completed', JSON.stringify(status));
      const state = (await control.query('SELECT * FROM recovery_state'))
        .rows[0];
      assert.notEqual(state.database_name, 'sushe');
      const restored = new Pool({
        connectionString: databaseUrlFor(
          process.env.DATABASE_URL,
          state.database_name
        ),
      });
      try {
        const user = (
          await restored.query(
            "SELECT * FROM users WHERE email='recovery@example.test'"
          )
        ).rows[0];
        assert.equal(user.accent_color, '#112233');
        assert.ok(Number(user.auth_version) > 0);
        const item = (
          await restored.query(
            "SELECT l.user_id,a.album_id,a.cover_image FROM list_items li JOIN lists l ON l._id=li.list_id JOIN albums a ON a.album_id=li.album_id WHERE li._id='restore-fixture-item'"
          )
        ).rows[0];
        assert.equal(item.user_id, adminId);
        assert.equal(item.album_id, albumId);
        assert.deepEqual(item.cover_image, coverBytes);
        assert.equal(
          Number(
            (await restored.query('SELECT COUNT(*) FROM session')).rows[0].count
          ),
          0
        );
        assert.equal(
          Number(
            (
              await restored.query(
                'SELECT COUNT(*) FROM extension_tokens WHERE NOT is_revoked'
              )
            ).rows[0].count
          ),
          0
        );
      } finally {
        await restored.end();
      }
      await api.get('/api/lists').set('Cookie', cookie).expect(401);
      const retained = await control.query(
        "SELECT datallowconn FROM pg_database WHERE datname='sushe'"
      );
      assert.equal(retained.rows[0].datallowconn, false);
      assert.equal(
        (
          await control.query('SELECT status FROM recovery_jobs WHERE id=$1', [
            id,
          ])
        ).rows[0].status,
        'completed'
      );
      assert.ok((await fs.stat(artifact.filePath)).size > 0);
    } finally {
      if (artifact) await artifact.cleanup();
      await Promise.all([runtime.end(), owner.end(), control.end()]);
    }
  }
);
