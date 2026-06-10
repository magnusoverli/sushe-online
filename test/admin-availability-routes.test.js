const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');

const registerAvailabilityRoutes = require('../routes/admin/availability');

function createApp(job) {
  const app = express();
  app.use(express.json());

  const ensureAuth = (req, _res, next) => {
    req.user = {
      _id: 'admin-1',
      username: 'adminuser',
      role: 'admin',
    };
    next();
  };
  const ensureAdmin = (_req, _res, next) => next();

  registerAvailabilityRoutes(app, {
    ensureAuth,
    ensureAdmin,
    db: { raw: mock.fn() },
    logger: {
      error: mock.fn(),
      info: mock.fn(),
      warn: mock.fn(),
      debug: mock.fn(),
    },
    availabilityResolutionService: job,
  });

  return app;
}

describe('admin availability routes', () => {
  it('starts resolution in the background and returns immediately', async () => {
    let finishJob;
    const jobPromise = new Promise((resolve) => {
      finishJob = resolve;
    });
    const job = {
      getStats: mock.fn(async () => ({})),
      isJobRunning: mock.fn(() => false),
      getProgress: mock.fn(() => null),
      getLastSummary: mock.fn(() => null),
      resolveAll: mock.fn(() => jobPromise),
      stopJob: mock.fn(() => false),
    };

    const responsePromise = request(createApp(job))
      .post('/api/admin/availability/resolve')
      .send({ all: true });
    let raceTimer;
    const response = await Promise.race([
      responsePromise,
      new Promise((resolve) => {
        raceTimer = setTimeout(() => resolve(null), 2000);
      }),
    ]);
    clearTimeout(raceTimer);

    assert.notStrictEqual(response, null);
    assert.strictEqual(response.status, 202);
    assert.deepStrictEqual(response.body, { success: true, started: true });
    assert.strictEqual(job.resolveAll.mock.calls.length, 1);
    assert.deepStrictEqual(job.resolveAll.mock.calls[0].arguments[0], {
      all: true,
    });

    finishJob({ total: 1 });
    await jobPromise;
  });

  it('returns the last summary once the job is no longer running', async () => {
    const lastSummary = {
      total: 2,
      resolved: 1,
      skipped: 1,
      failed: 0,
      durationSeconds: 3,
      stoppedEarly: false,
    };
    const job = {
      getStats: mock.fn(async () => ({})),
      isJobRunning: mock.fn(() => false),
      getProgress: mock.fn(() => null),
      getLastSummary: mock.fn(() => lastSummary),
      resolveAll: mock.fn(async () => ({})),
      stopJob: mock.fn(() => false),
    };

    const response = await request(createApp(job)).get(
      '/api/admin/availability/progress'
    );

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(response.body, {
      isRunning: false,
      progress: null,
      lastSummary,
    });
  });
});
