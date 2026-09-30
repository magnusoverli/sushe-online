const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const {
  hashExtensionToken,
  extensionTokenLookup,
} = require('../../services/auth-utils-service');

test(
  'authenticated API contracts enforce payloads, ownership, credentials, CSRF and concurrent revisions',
  { timeout: 30000 },
  async () => {
    assert.ok(process.env.DATABASE_URL);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const ids = [randomUUID(), randomUUID()];
    const tokens = [
      randomBytes(32).toString('base64url'),
      randomBytes(32).toString('base64url'),
    ];
    const api = request('http://localhost:3000');
    try {
      for (let i = 0; i < ids.length; i++) {
        await pool.query(
          "INSERT INTO users (_id,email,username,hash,role,approval_status) VALUES ($1,$2,$1,$3,'user','approved')",
          [
            ids[i],
            `${ids[i]}@contract.test`,
            await bcrypt.hash('synthetic-contract-password', 4),
          ]
        );
        await pool.query(
          "INSERT INTO extension_tokens(user_id,token_hash,token_lookup,expires_at) VALUES ($1,$2,$3,NOW()+INTERVAL '1 hour')",
          [
            ids[i],
            hashExtensionToken(tokens[i]),
            extensionTokenLookup(tokens[i]),
          ]
        );
      }
      const auth = `Bearer ${tokens[0]}`;
      await api
        .post('/api/lists')
        .send({ name: 'Anonymous', data: [] })
        .expect(401);
      for (const data of [
        { name: 'Wrong field', albums: [] },
        { name: 'Wrong type', data: {} },
      ])
        await api
          .post('/api/lists')
          .set('Authorization', auth)
          .send(data)
          .expect(400);
      const created = await api
        .post('/api/lists')
        .set('Authorization', auth)
        .send({ name: 'Contract', data: [] })
        .expect(201);
      assert.equal(created.body.success, true);
      assert.equal(created.body.count, 0);
      const id = created.body._id;
      assert.equal(
        (await pool.query('SELECT user_id FROM lists WHERE _id=$1', [id]))
          .rows[0].user_id,
        ids[0]
      );
      const read = await api
        .get(`/api/lists/${id}`)
        .set('Authorization', auth)
        .expect(200);
      assert.deepEqual(read.body, []);
      const revision = read.headers['x-list-revision'];
      assert.ok(revision);
      await api
        .put(`/api/lists/${id}`)
        .set('Authorization', auth)
        .send({ data: [] })
        .expect(428);
      await api
        .put(`/api/lists/${id}`)
        .set('Authorization', `Bearer ${tokens[1]}`)
        .set('If-Match', revision)
        .send({ data: [] })
        .expect(404);
      const results = await Promise.all(
        [0, 1].map((index) =>
          request(
            index === 0
              ? 'http://localhost:3000'
              : process.env.SECOND_APP_URL || 'http://localhost:3000'
          )
            .put(`/api/lists/${id}`)
            .set('Authorization', auth)
            .set('If-Match', revision)
            .send({ data: [] })
        )
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 412]);
      await api
        .get('/admin/restore/missing/status')
        .set('Authorization', auth)
        .expect(403);
      const agent = request.agent('http://localhost:3000');
      const page = await agent.get('/login');
      await agent
        .post('/login')
        .send({
          _csrf: page.text.match(/name="_csrf" value="([^"]+)"/)[1],
          email: `${ids[0]}@contract.test`,
          password: 'synthetic-contract-password',
        })
        .expect(302);
      await agent.get('/api/lists').expect(200);
      await agent
        .get('/api/lists')
        .set('Authorization', 'Bearer invalid')
        .expect(401);
      await agent
        .post('/api/lists')
        .send({ name: 'No CSRF', data: [] })
        .expect(403);
      const sessionCsrf = await agent.get('/api/auth/csrf').expect(200);
      await agent
        .post('/api/lists')
        .set('X-CSRF-Token', sessionCsrf.body.csrfToken)
        .send({ name: 'Valid session write', data: [] })
        .expect(201);
      const bearerOverSession = await agent
        .get('/api/lists')
        .set('Authorization', `Bearer ${tokens[1]}`)
        .expect(200);
      assert.ok(!JSON.stringify(bearerOverSession.body).includes(id));
    } finally {
      await pool.query('DELETE FROM extension_tokens WHERE user_id=ANY($1)', [
        ids,
      ]);
      await pool.query('DELETE FROM users WHERE _id=ANY($1)', [ids]);
      await pool.end();
    }
  }
);
