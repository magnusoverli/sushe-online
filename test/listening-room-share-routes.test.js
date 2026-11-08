const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const {
  createListeningRoomShareService,
} = require('../services/listening-room-share-service');
const {
  createListeningRoomShareRepository,
} = require('../db/repositories/listening-room-share-repository');
const registerPublic = require('../routes/listening-room-share');
const registerSignedIn = require('../routes/api/listening-room-shares');

const token = 'abcdefghijklmnopqrstuv';
const expiry = '2026-11-15T13:32:00.000Z';
const logger = { error() {} };

function harness({
  owner = 'owner',
  working = true,
  user = 'owner',
  baseUrl = '',
} = {}) {
  const data = {
    list: { name: '<script>alert("private")</script>', year: 2025 },
    items: [{ artist: 'Artist', album: 'Album', primary_track: 'First' }],
  };
  const repository = {
    findListOwner: mock.fn(async () => owner),
    createOrRenew: mock.fn(async () => ({ token, expires_at: expiry })),
    findWorking: mock.fn(async () =>
      working ? { list_id: 'list', user_id: 'owner', expires_at: expiry } : null
    ),
    stop: mock.fn(async () => {}),
  };
  const fetchers = { getListByIdWithItems: mock.fn(async () => data) };
  const service = createListeningRoomShareService({ repository, fetchers });
  const app = express();
  app.set('trust proxy', 'loopback');
  registerPublic(app, { listeningRoomShareService: service, logger });
  // A response cookie here detects any public route leaking into session work.
  app.use((_req, res, next) => {
    res.cookie('session', 'not-public');
    next();
  });
  registerSignedIn(app, {
    listeningRoomShareService: service,
    logger,
    baseUrl,
    ensureAuthAPI: (req, res, next) => {
      if (!user) return res.status(401).end();
      req.user = { _id: user };
      next();
    },
  });
  return { app, repository, data, fetchers, service };
}

describe('Listening Room HTTP routes', () => {
  it(
    'limits public requests per IP without entering the session stack',
    { skip: process.env.DISABLE_RATE_LIMITING === 'true' },
    async () => {
      const { app } = harness();
      for (let i = 0; i < 60; i++)
        await request(app).get(`/lr/${token}`).expect(200);
      const response = await request(app).get(`/lr/${token}`).expect(429);
      assert.equal(response.headers['set-cookie'], undefined);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow');
      assert.equal(response.headers['referrer-policy'], 'no-referrer');
      assert.ok(response.headers['retry-after']);
    }
  );

  it('returns live JSON directly with privacy headers and no cookie, session or CORS', async () => {
    const { app, data } = harness();
    const first = await request(app)
      .get(`/lr/${token}`)
      .set('Accept', 'application/json')
      .set('Origin', 'https://arbitrary-instance.test')
      .set('Cookie', 'session=ignore')
      .expect(200);
    assert.equal(
      first.headers['content-type'],
      'application/json; charset=utf-8'
    );
    assert.equal(first.headers['cache-control'], 'no-store');
    assert.equal(first.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal(first.headers['referrer-policy'], 'no-referrer');
    assert.equal(first.headers['set-cookie'], undefined);
    assert.equal(first.headers['access-control-allow-origin'], undefined);
    assert.equal(first.headers.location, undefined);
    assert.equal(first.body.format, 'sushe-listening-room');
    data.items[0].primary_track = 'Changed since sharing';
    const second = await request(app)
      .get(`/lr/${token}`)
      .set('Accept', 'application/json')
      .expect(200);
    assert.equal(second.body.songs[0].title, 'Changed since sharing');
  });

  it('renders a small escaped HTML page with a neutral title and no preview metadata', async () => {
    const { app } = harness();
    const response = await request(app)
      .get(`/lr/${token}`)
      .set('Accept', 'text/html,application/xhtml+xml,*/*;q=0.8')
      .expect(200);
    assert.match(response.headers['content-type'], /text\/html/);
    assert.match(response.text, /<title>Shared list · SuShe Online<\/title>/);
    assert.match(response.text, /&lt;script&gt;/);
    assert.ok(!response.text.includes('<script>'));
    assert.ok(!response.text.includes('og:'));
    assert.match(response.text, /Your playlist → Import list/);
    assert.match(response.text, /1 song/);
  });

  it('uses an indistinguishable 404 for every nonworking share', async () => {
    for (const _reason of [
      'unknown',
      'expired',
      'stopped',
      'deleted-list',
      'unapproved-owner',
      'deleted-owner',
    ]) {
      const { app } = harness({ working: false });
      const response = await request(app)
        .get(`/lr/${token}`)
        .set('Accept', 'application/json')
        .expect(404);
      assert.deepEqual(response.body, { error: 'not_found' });
      assert.equal(response.headers['set-cookie'], undefined);
      assert.equal(response.headers['cache-control'], 'no-store');
      const browser = await request(app).get(`/lr/${token}`).expect(404);
      assert.match(
        browser.text,
        /This link no longer works. Ask the owner to share the list again./
      );
    }
  });

  it('rejects malformed tokens without any database lookup', async () => {
    const { app, repository } = harness();
    for (const invalid of [
      'short',
      'a'.repeat(23),
      'a'.repeat(21) + '!',
      token + '%0A',
      '%E0%A4%A',
    ]) {
      await request(app)
        .get(`/lr/${invalid}`)
        .set('Accept', 'application/json')
        .expect(404);
    }
    assert.equal(repository.findWorking.mock.callCount(), 0);
  });

  it('never reaches sessions for other public methods or paths', async () => {
    const { app } = harness();
    for (const response of [
      await request(app).post(`/lr/${token}`),
      await request(app).get('/lr/'),
      await request(app).head(`/lr/${token}`),
    ]) {
      assert.equal(response.headers['set-cookie'], undefined);
      assert.equal(response.headers['referrer-policy'], 'no-referrer');
      assert.notEqual(response.status, 200);
    }
  });

  it('requires authentication for create and stop', async () => {
    const { app } = harness({ user: null });
    await request(app).post('/api/lists/list/listening-room-share').expect(401);
    await request(app)
      .delete('/api/lists/list/listening-room-share')
      .expect(401);
  });

  it('returns 403 for another owner and 404 for a missing list, without writing', async () => {
    for (const [owner, status] of [
      ['other', 403],
      [null, 404],
    ]) {
      const { app, repository } = harness({ owner });
      await request(app)
        .post('/api/lists/list/listening-room-share')
        .expect(status);
      await request(app)
        .delete('/api/lists/list/listening-room-share')
        .expect(status);
      assert.equal(repository.createOrRenew.mock.callCount(), 0);
      assert.equal(repository.stop.mock.callCount(), 0);
    }
  });

  it('creates a final BASE_URL link and returns only the signed-in summary', async () => {
    const { app, repository } = harness({ baseUrl: 'https://sushe.example/' });
    const response = await request(app)
      .post('/api/lists/list/listening-room-share')
      .expect(200);
    assert.deepEqual(response.body, {
      url: `https://sushe.example/lr/${token}`,
      expiresAt: expiry,
      songCount: 1,
      leftOut: { noPick: 0, disqualified: 0 },
    });
    const generated = repository.createOrRenew.mock.calls[0].arguments[2];
    assert.match(generated, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(Buffer.from(generated, 'base64url').length, 16);
  });

  it('uses the trusted request protocol when BASE_URL is unset, and stop is idempotent', async () => {
    const { app } = harness();
    const response = await request(app)
      .post('/api/lists/list/listening-room-share')
      .set('Host', 'sushe.test')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);
    assert.equal(response.body.url, `https://sushe.test/lr/${token}`);
    await request(app)
      .delete('/api/lists/list/listening-room-share')
      .expect(204);
    await request(app)
      .delete('/api/lists/list/listening-room-share')
      .expect(204);
  });
});

describe('Listening Room repository SQL boundaries', () => {
  it('migrates one share per list with owner/list cascades and an expiry index', async () => {
    const migration = require('../db/migrations/migrations/084_listening_room_shares');
    const query = mock.fn(async () => {});
    await migration.up({ query });
    const sql = query.mock.calls.map((call) => call.arguments[0]).join('\n');
    assert.match(sql, /token TEXT PRIMARY KEY/);
    assert.match(
      sql,
      /list_id TEXT NOT NULL UNIQUE REFERENCES lists\(_id\) ON DELETE CASCADE/
    );
    assert.match(
      sql,
      /user_id TEXT NOT NULL REFERENCES users\(_id\) ON DELETE CASCADE/
    );
    assert.match(
      sql,
      /CREATE INDEX IF NOT EXISTS idx_listening_room_shares_expires_at/
    );
    await migration.down({ query });
    assert.equal(
      query.mock.calls[2].arguments[0],
      'DROP TABLE IF EXISTS listening_room_shares'
    );
  });

  it('loads current track/pick/availability data without cover image bytes or the export path', async () => {
    const raw = mock.fn(async () => ({ rows: [] }));
    const service = createListeningRoomShareService({
      db: { raw },
      repository: {
        findListOwner: async () => 'owner',
        findWorking: async () => ({
          list_id: 'list',
          user_id: 'owner',
          expires_at: expiry,
        }),
      },
    });
    assert.equal(await service.getPublicPayload(token), null);
    const [sql] = raw.mock.calls[0].arguments;
    assert.match(sql, /a.tracks/);
    assert.match(sql, /li.primary_track/);
    assert.match(sql, /li.secondary_track/);
    assert.match(sql, /li.is_disqualified/);
    assert.match(sql, /availability_links/);
    assert.doesNotMatch(sql, /a\.cover_image\b/);
  });

  it('redacts bearer links in URLs, paths and free-text log messages', () => {
    const { logSafeUrl } = require('../utils/log-url');
    const { redactLogValue } = require('../utils/log-redaction');
    assert.equal(
      logSafeUrl(`https://example.test/lr/${token}`),
      '/lr/[redacted]'
    );
    assert.equal(logSafeUrl(`/lr/${token}`), '/lr/[redacted]');
    assert.ok(
      !redactLogValue(`Request GET /lr/${token} failed`).includes(token)
    );
    assert.ok(
      !redactLogValue(`Read https://example.test/lr/${token}`).includes(token)
    );
  });

  it('uses one atomic upsert with a fixed 168-hour lifetime and never logs a token', async () => {
    const raw = mock.fn(async () => ({
      rows: [{ token, expires_at: expiry }],
    }));
    const repository = createListeningRoomShareRepository({ db: { raw } });
    await repository.createOrRenew('list', 'owner', token);
    assert.equal(raw.mock.callCount(), 1);
    const [sql, params] = raw.mock.calls[0].arguments;
    assert.match(sql, /ON CONFLICT \(list_id\) DO UPDATE/);
    assert.match(sql, /INTERVAL '168 hours'/);
    assert.match(sql, /THEN listening_room_shares.token ELSE EXCLUDED.token/);
    assert.deepEqual(params, [token, 'list', 'owner']);
    assert.ok(!sql.includes(token));
  });

  it('checks expiry, list ownership and approved owner in every public lookup', async () => {
    const raw = mock.fn(async () => ({ rows: [] }));
    const repository = createListeningRoomShareRepository({ db: { raw } });
    assert.equal(await repository.findWorking(token), null);
    const [sql] = raw.mock.calls[0].arguments;
    assert.match(sql, /JOIN lists/);
    assert.match(sql, /l.user_id = s.user_id/);
    assert.match(sql, /approval_status = 'approved'/);
    assert.match(sql, /expires_at > statement_timestamp\(\)/);
  });
});
