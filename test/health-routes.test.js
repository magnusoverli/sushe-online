const { test, mock } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');

const mockLogger = {
  info: mock.fn(),
  warn: mock.fn(),
  error: mock.fn(),
  debug: mock.fn(),
};

require.cache[require.resolve('../utils/logger')] = {
  exports: mockLogger,
};

require.cache[require.resolve('../utils/metrics')] = {
  exports: {
    getMetrics: async () => '',
    getContentType: () => 'text/plain; version=0.0.4',
  },
};

const { registerHealthRoutes } = require('../routes/health.js');

function createTestApp(healthResult) {
  const app = express();
  const pool = {
    query: mock.fn(async () => ({ rows: [{ health_check: 1 }] })),
    totalCount: 2,
    idleCount: 2,
    waitingCount: 0,
  };

  registerHealthRoutes(app, pool, {
    ready: Promise.resolve(),
    healthCheck: async () => healthResult,
    createMigrationManager: () => ({
      getMigrationStatus: async () => [],
    }),
  });

  return app;
}

test('GET /api/health returns healthy when db response time is 0ms', async () => {
  const app = createTestApp({
    status: 'healthy',
    database: 'connected',
    responseTime: 0,
    timestamp: new Date().toISOString(),
  });

  await new Promise((resolve) => setImmediate(resolve));

  const response = await request(app).get('/api/health');

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.status, 'healthy');
  assert.strictEqual(response.body.readiness.responseTimeMs, 0);
  assert.strictEqual(response.body.readiness.latencyHealthy, true);
});

test('GET /api/health reports unhealthy when db response time is missing', async () => {
  const app = createTestApp({
    status: 'healthy',
    database: 'connected',
    timestamp: new Date().toISOString(),
  });

  await new Promise((resolve) => setImmediate(resolve));

  const response = await request(app).get('/api/health');

  assert.strictEqual(response.status, 503);
  assert.strictEqual(response.body.status, 'unhealthy');
  assert.strictEqual(response.body.readiness.responseTimeMs, null);
  assert.strictEqual(response.body.readiness.latencyHealthy, false);
});
