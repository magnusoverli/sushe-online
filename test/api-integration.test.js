const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');

// Mock logger to avoid file operations
const mockLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

// Mock the logger module
require.cache[require.resolve('../utils/logger')] = {
  exports: mockLogger,
};

test('Express app should handle basic JSON requests', async () => {
  const app = express();
  app.use(express.json());

  app.post('/test', (req, res) => {
    res.json({ received: req.body });
  });

  const response = await request(app)
    .post('/test')
    .send({ message: 'hello' })
    .expect(200);

  assert.strictEqual(response.body.received.message, 'hello');
});

test('Express app should handle invalid JSON gracefully', async () => {
  const app = express();
  app.use(express.json());

  // Add error handling middleware
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    next(err);
  });

  app.post('/test', (req, res) => {
    res.json({ received: req.body });
  });

  const response = await request(app)
    .post('/test')
    .set('Content-Type', 'application/json')
    .send('{"invalid": json}')
    .expect(400);

  assert.strictEqual(response.body.error, 'Invalid JSON');
});

test('Express app should handle authentication middleware', async () => {
  const app = express();
  app.use(express.json());

  // Mock authentication middleware
  const requireAuth = (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = { id: 1, username: 'testuser' };
    next();
  };

  app.get('/protected', requireAuth, (req, res) => {
    res.json({ message: 'Protected data', user: req.user.username });
  });

  // Test without auth
  await request(app).get('/protected').expect(401);

  // Test with auth
  const response = await request(app)
    .get('/protected')
    .set('Authorization', 'Bearer token')
    .expect(200);

  assert.strictEqual(response.body.user, 'testuser');
});

test('Express app should handle query parameters', async () => {
  const app = express();

  app.get('/search', (req, res) => {
    const { q, limit = 10 } = req.query;
    res.json({
      query: q,
      limit: parseInt(limit),
      results: [],
    });
  });

  const response = await request(app).get('/search?q=test&limit=5').expect(200);

  assert.strictEqual(response.body.query, 'test');
  assert.strictEqual(response.body.limit, 5);
});

test('Express app should handle URL parameters', async () => {
  const app = express();

  app.get('/users/:id', (req, res) => {
    const { id } = req.params;
    res.json({
      userId: parseInt(id),
      found: true,
    });
  });

  const response = await request(app).get('/users/123').expect(200);

  assert.strictEqual(response.body.userId, 123);
  assert.strictEqual(response.body.found, true);
});
