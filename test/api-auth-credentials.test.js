const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  createExtensionAuthApp,
  VALID_TOKEN,
  EXTENSION_USER,
  SESSION_USER,
} = require('./helpers/extension-auth-app');

const writes = [
  [
    'patch',
    `/api/lists/${EXTENSION_USER}-list/items`,
    { added: [{ album_id: 'album-1' }] },
  ],
  [
    'patch',
    '/api/albums/batch-update',
    { updates: [{ albumId: 'album-1', country: 'CL' }] },
  ],
  [
    'put',
    '/api/albums/album-1/source-observation',
    { sourceObservation: { schemaVersion: 1 } },
  ],
];

test('real album routes use the validated bearer identity with and without an unrelated session', async () => {
  for (const withSession of [false, true]) {
    const fixture = createExtensionAuthApp();
    const agent = request.agent(fixture.app);
    if (withSession)
      await agent.post(`/test/session/${SESSION_USER}`).expect(200);
    const lists = await agent
      .get('/api/lists')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .expect(200);
    assert.deepEqual(Object.keys(lists.body), [`${EXTENSION_USER}-list`]);
    for (const [method, path, body] of writes) {
      await agent[method](path)
        .set('Authorization', `bearer ${VALID_TOKEN}`)
        .send(body)
        .expect(200);
    }
    assert.equal(fixture.mutations.length, writes.length);
    assert.ok(
      fixture.mutations.every((entry) => entry.userId === EXTENSION_USER)
    );
    assert.equal(fixture.validatedTokens.length, writes.length + 1);
    assert.ok(fixture.requests.every((entry) => entry.authMethod === 'token'));
    assert.ok(fixture.activity.every((userId) => userId === EXTENSION_USER));
    const session = await agent.get('/test/session').expect(200);
    assert.equal(session.body.userId, withSession ? SESSION_USER : undefined);
    assert.equal(session.body.lastActivityUpdatedAt, undefined);
  }
});

test('session-only album mutations remain CSRF-protected and valid CSRF permits the write', async () => {
  const fixture = createExtensionAuthApp();
  const agent = request.agent(fixture.app);
  await agent.post(`/test/session/${SESSION_USER}`).expect(200);
  const {
    body: { csrfToken },
  } = await agent.get('/api/auth/csrf').expect(200);
  for (const [method, path, body] of writes) {
    for (const csrf of ['', 'invalid-csrf']) {
      const response = await agent[method](path)
        .set('Origin', 'chrome-extension://pretend-extension')
        .set('X-CSRF-Token', csrf)
        .send(body)
        .expect(403);
      assert.equal(response.body.code, 'CSRF_INVALID');
    }
    await agent[method](path)
      .set('X-CSRF-Token', csrfToken)
      .send(body)
      .expect(200);
  }
  assert.equal(fixture.mutations.length, writes.length);
  assert.ok(fixture.mutations.every((entry) => entry.userId === SESSION_USER));
  assert.deepEqual(fixture.validatedTokens, []);
});

test('invalid explicit credentials cannot fall back to a session, even with valid CSRF', async () => {
  const fixture = createExtensionAuthApp();
  const agent = request.agent(fixture.app);
  await agent.post(`/test/session/${SESSION_USER}`).expect(200);
  const {
    body: { csrfToken },
  } = await agent.get('/api/auth/csrf').expect(200);
  for (const authorization of [
    '',
    'Basic credentials',
    'Bearer',
    'Bearer ',
    'Bearer bad token',
    'Bearer invalid-token',
  ]) {
    await agent
      .get('/api/lists')
      .set('Authorization', authorization)
      .expect(401);
    for (const [method, path, body] of writes) {
      await agent[method](path)
        .set('Authorization', authorization)
        .set('X-CSRF-Token', csrfToken)
        .send(body)
        .expect(401);
    }
  }
  assert.deepEqual(fixture.mutations, []);
  const session = await agent.get('/test/session').expect(200);
  assert.equal(session.body.userId, SESSION_USER);
});

test('failed token validation and unavailable or unapproved users never inherit the cookie identity', async () => {
  const outcomes = [
    { validateExtensionToken: async () => null },
    {
      validateExtensionToken: async () => {
        throw new Error('validation unavailable');
      },
    },
    { authService: { getUserById: async () => null } },
    {
      authService: {
        getUserById: async () => ({
          _id: EXTENSION_USER,
          approvalStatus: 'pending',
        }),
      },
    },
    {
      authService: {
        getUserById: async () => ({
          _id: EXTENSION_USER,
          approvalStatus: 'rejected',
        }),
      },
    },
  ];
  for (const overrides of outcomes) {
    const fixture = createExtensionAuthApp(overrides);
    const agent = request.agent(fixture.app);
    await agent.post(`/test/session/${SESSION_USER}`).expect(200);
    await agent
      .patch(writes[0][1])
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send(writes[0][2])
      .expect(401);
    assert.deepEqual(fixture.mutations, []);
    assert.deepEqual(fixture.activity, []);
  }
});

test('no credentials returns 401, and a bearer cannot obtain a browser CSRF token', async () => {
  const { app } = createExtensionAuthApp();
  await request(app).patch(writes[0][1]).send(writes[0][2]).expect(401);
  await request(app)
    .get('/api/auth/csrf')
    .set('Authorization', `Bearer ${VALID_TOKEN}`)
    .expect(400);
});
