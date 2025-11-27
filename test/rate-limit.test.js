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

// Mock the logger module before requiring rate-limit
require.cache[require.resolve('../utils/logger')] = {
  exports: mockLogger,
};

test.describe('Rate Limiting Middleware', () => {
  test.afterEach(() => {
    // Clean up environment variables
    delete process.env.DISABLE_RATE_LIMITING;
    delete process.env.RATE_LIMIT_LOGIN_MAX;
    delete process.env.RATE_LIMIT_REGISTER_MAX;
    delete process.env.RATE_LIMIT_FORGOT_MAX;
    delete process.env.RATE_LIMIT_RESET_MAX;
    delete process.env.RATE_LIMIT_SETTINGS_MAX;

    // Clear require cache to get fresh instances
    delete require.cache[require.resolve('../middleware/rate-limit')];
  });

  test.describe('Login Rate Limiting', () => {
    test('should allow requests under the limit', async () => {
      const rateLimits = require('../middleware/rate-limit');
      const app = express();

      app.use(express.json());
      app.post('/login', rateLimits.loginRateLimit, (req, res) => {
        res.json({ success: true });
      });

      // First request should succeed
      const res = await request(app)
        .post('/login')
        .send({ email: 'test@test.com', password: 'pass' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });

    test('should block requests after exceeding limit', async () => {
      // Set very low limit for testing
      process.env.RATE_LIMIT_LOGIN_MAX = '3';
      delete require.cache[require.resolve('../middleware/rate-limit')];
      const rateLimits = require('../middleware/rate-limit');

      const app = express();
      app.use(express.json());
      app.post('/login', rateLimits.loginRateLimit, (req, res) => {
        res.json({ success: true });
      });

      // Make requests up to the limit
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post('/login')
          .send({ email: 'test@test.com' });
        assert.strictEqual(res.status, 200);
      }

      // Next request should be rate limited
      const blockedRes = await request(app)
        .post('/login')
        .send({ email: 'test@test.com' });

      assert.strictEqual(blockedRes.status, 429);
      assert.ok(blockedRes.body.error);
      assert.ok(blockedRes.body.error.includes('Too many login attempts'));
    });

    test('should set rate limit headers', async () => {
      const rateLimits = require('../middleware/rate-limit');
      const app = express();

      app.use(express.json());
      app.post('/login', rateLimits.loginRateLimit, (req, res) => {
        res.json({ success: true });
      });

      const res = await request(app)
        .post('/login')
        .send({ email: 'test@test.com' });

      assert.ok(res.headers['ratelimit-limit']);
      assert.ok(res.headers['ratelimit-remaining'] !== undefined);
    });

    test('should include retry-after header when rate limited', async () => {
      process.env.RATE_LIMIT_LOGIN_MAX = '1';
      delete require.cache[require.resolve('../middleware/rate-limit')];
      const rateLimits = require('../middleware/rate-limit');

      const app = express();
      app.use(express.json());
      app.post('/login', rateLimits.loginRateLimit, (req, res) => {
        res.json({ success: true });
      });

      // First request
      await request(app).post('/login').send({ email: 'test@test.com' });

      // Second request should be blocked
      const blockedRes = await request(app)
        .post('/login')
        .send({ email: 'test@test.com' });

      assert.strictEqual(blockedRes.status, 429);
      assert.ok(blockedRes.body.retryAfter);
    });
  });

  test.describe('Registration Rate Limiting', () => {
    test('should enforce stricter limits for registration', async () => {
      process.env.RATE_LIMIT_REGISTER_MAX = '2';
      delete require.cache[require.resolve('../middleware/rate-limit')];
      const rateLimits = require('../middleware/rate-limit');

      const app = express();
      app.use(express.json());
      app.post('/register', rateLimits.registerRateLimit, (req, res) => {
        res.json({ success: true });
      });

      // Make 2 requests (within limit)
      for (let i = 0; i < 2; i++) {
        const res = await request(app)
          .post('/register')
          .send({ email: `test${i}@test.com` });
        assert.strictEqual(res.status, 200);
      }

      // Third request should be blocked
      const blockedRes = await request(app)
        .post('/register')
        .send({ email: 'test3@test.com' });

      assert.strictEqual(blockedRes.status, 429);
      assert.ok(blockedRes.body.error.includes('registration'));
    });
  });

  test.describe('Password Reset Rate Limiting', () => {
    test('should allow forgot password requests under limit', async () => {
      const rateLimits = require('../middleware/rate-limit');
      const app = express();

      app.use(express.json());
      app.post(
        '/forgot-password',
        rateLimits.forgotPasswordRateLimit,
        (req, res) => {
          res.json({ success: true });
        }
      );

      const res = await request(app)
        .post('/forgot-password')
        .send({ email: 'test@test.com' });

      assert.strictEqual(res.status, 200);
    });

    test('should block excessive password reset requests', async () => {
      process.env.RATE_LIMIT_FORGOT_MAX = '2';
      delete require.cache[require.resolve('../middleware/rate-limit')];
      const rateLimits = require('../middleware/rate-limit');

      const app = express();
      app.use(express.json());
      app.post(
        '/forgot-password',
        rateLimits.forgotPasswordRateLimit,
        (req, res) => {
          // Simulate failed requests (skipSuccessfulRequests means only failures count)
          res.status(400).json({ error: 'Invalid request' });
        }
      );

      // Make 2 failed requests (these count toward the limit)
      for (let i = 0; i < 2; i++) {
        await request(app)
          .post('/forgot-password')
          .send({ email: 'test@test.com' });
      }

      // Third should be blocked by rate limiter
      const blockedRes = await request(app)
        .post('/forgot-password')
        .send({ email: 'test@test.com' });

      assert.strictEqual(blockedRes.status, 429);
      assert.ok(blockedRes.body.error.includes('password reset'));
    });

    test('should not count successful password reset requests (skipSuccessfulRequests)', async () => {
      process.env.RATE_LIMIT_FORGOT_MAX = '2';
      delete require.cache[require.resolve('../middleware/rate-limit')];
      const rateLimits = require('../middleware/rate-limit');

      const app = express();
      app.use(express.json());
      app.post(
        '/forgot-password',
        rateLimits.forgotPasswordRateLimit,
        (req, res) => {
          // Successful requests should not be counted
          res.json({ success: true });
        }
      );

      // Make many successful requests - should not be rate limited
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/forgot-password')
          .send({ email: 'test@test.com' });
        assert.strictEqual(res.status, 200);
      }
    });

    test('should enforce reset password token submission limits', async () => {
      process.env.RATE_LIMIT_RESET_MAX = '3';
      delete require.cache[require.resolve('../middleware/rate-limit')];
      const rateLimits = require('../middleware/rate-limit');

      const app = express();
      app.use(express.json());
      app.post(
        '/reset-password',
        rateLimits.resetPasswordRateLimit,
        (req, res) => {
          res.json({ success: true });
        }
      );

      // Make 3 attempts
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post('/reset-password')
          .send({ token: 'fake-token', password: 'newpass' });
        assert.strictEqual(res.status, 200);
      }

      // Fourth should be blocked
      const blockedRes = await request(app)
        .post('/reset-password')
        .send({ token: 'fake-token', password: 'newpass' });

      assert.strictEqual(blockedRes.status, 429);
    });
  });

  test.describe('Sensitive Settings Rate Limiting', () => {
    test('should allow settings changes under limit', async () => {
      const rateLimits = require('../middleware/rate-limit');
      const app = express();

      app.use(express.json());
      app.post(
        '/settings',
        rateLimits.sensitiveSettingsRateLimit,
        (req, res) => {
          res.json({ success: true });
        }
      );

      const res = await request(app)
        .post('/settings')
        .send({ setting: 'value' });

      assert.strictEqual(res.status, 200);
    });

    test('should block excessive settings changes', async () => {
      process.env.RATE_LIMIT_SETTINGS_MAX = '5';
      delete require.cache[require.resolve('../middleware/rate-limit')];
      const rateLimits = require('../middleware/rate-limit');

      const app = express();
      app.use(express.json());
      app.post(
        '/settings',
        rateLimits.sensitiveSettingsRateLimit,
        (req, res) => {
          res.json({ success: true });
        }
      );

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/settings')
          .send({ setting: `value${i}` });
      }

      // Sixth should be blocked
      const blockedRes = await request(app)
        .post('/settings')
        .send({ setting: 'value6' });

      assert.strictEqual(blockedRes.status, 429);
      assert.ok(blockedRes.body.error.includes('settings'));
    });
  });

  test.describe('Rate Limiting Disable Flag', () => {
    test('should bypass all rate limits when DISABLE_RATE_LIMITING is true', async () => {
      process.env.DISABLE_RATE_LIMITING = 'true';
      process.env.RATE_LIMIT_LOGIN_MAX = '1'; // Very restrictive
      delete require.cache[require.resolve('../middleware/rate-limit')];
      const rateLimits = require('../middleware/rate-limit');

      const app = express();
      app.use(express.json());
      app.post('/login', rateLimits.loginRateLimit, (req, res) => {
        res.json({ success: true });
      });

      // Make multiple requests - all should succeed
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/login')
          .send({ email: 'test@test.com' });
        assert.strictEqual(res.status, 200);
      }
    });

    test('should bypass registration rate limits when disabled', async () => {
      process.env.DISABLE_RATE_LIMITING = 'true';
      delete require.cache[require.resolve('../middleware/rate-limit')];
      const rateLimits = require('../middleware/rate-limit');

      const app = express();
      app.use(express.json());
      app.post('/register', rateLimits.registerRateLimit, (req, res) => {
        res.json({ success: true });
      });

      // Make many requests - all should succeed
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/register')
          .send({ email: `test${i}@test.com` });
        assert.strictEqual(res.status, 200);
      }
    });

    test('should bypass password reset rate limits when disabled', async () => {
      process.env.DISABLE_RATE_LIMITING = 'true';
      delete require.cache[require.resolve('../middleware/rate-limit')];
      const rateLimits = require('../middleware/rate-limit');

      const app = express();
      app.use(express.json());
      app.post('/forgot', rateLimits.forgotPasswordRateLimit, (req, res) => {
        res.json({ success: true });
      });

      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/forgot')
          .send({ email: 'test@test.com' });
        assert.strictEqual(res.status, 200);
      }
    });
  });

  test.describe('Configuration via Environment Variables', () => {
    test('should use custom max from RATE_LIMIT_LOGIN_MAX', async () => {
      process.env.RATE_LIMIT_LOGIN_MAX = '7';
      delete require.cache[require.resolve('../middleware/rate-limit')];
      const rateLimits = require('../middleware/rate-limit');

      const app = express();
      app.use(express.json());
      app.post('/login', rateLimits.loginRateLimit, (req, res) => {
        res.json({ success: true });
      });

      // Should allow 7 requests
      for (let i = 0; i < 7; i++) {
        const res = await request(app).post('/login').send({});
        assert.strictEqual(res.status, 200);
      }

      // 8th should be blocked
      const blockedRes = await request(app).post('/login').send({});
      assert.strictEqual(blockedRes.status, 429);
    });

    test('should use custom max from RATE_LIMIT_REGISTER_MAX', async () => {
      process.env.RATE_LIMIT_REGISTER_MAX = '4';
      delete require.cache[require.resolve('../middleware/rate-limit')];
      const rateLimits = require('../middleware/rate-limit');

      const app = express();
      app.use(express.json());
      app.post('/register', rateLimits.registerRateLimit, (req, res) => {
        res.json({ success: true });
      });

      // Should allow 4 requests
      for (let i = 0; i < 4; i++) {
        const res = await request(app).post('/register').send({});
        assert.strictEqual(res.status, 200);
      }

      // 5th should be blocked
      const blockedRes = await request(app).post('/register').send({});
      assert.strictEqual(blockedRes.status, 429);
    });
  });

  test.describe('Error Response Format', () => {
    test('should return JSON error with proper structure', async () => {
      process.env.RATE_LIMIT_LOGIN_MAX = '1';
      delete require.cache[require.resolve('../middleware/rate-limit')];
      const rateLimits = require('../middleware/rate-limit');

      const app = express();
      app.use(express.json());
      app.post('/login', rateLimits.loginRateLimit, (req, res) => {
        res.json({ success: true });
      });

      await request(app).post('/login').send({});
      const blockedRes = await request(app).post('/login').send({});

      assert.strictEqual(blockedRes.status, 429);
      assert.ok(blockedRes.body.error);
      assert.strictEqual(typeof blockedRes.body.error, 'string');
      assert.ok(blockedRes.body.retryAfter !== undefined);
    });

    test('should include descriptive error messages', async () => {
      process.env.RATE_LIMIT_LOGIN_MAX = '1';
      process.env.RATE_LIMIT_REGISTER_MAX = '1';
      delete require.cache[require.resolve('../middleware/rate-limit')];
      const rateLimits = require('../middleware/rate-limit');

      const app = express();
      app.use(express.json());
      app.post('/login', rateLimits.loginRateLimit, (req, res) => {
        res.json({ success: true });
      });
      app.post('/register', rateLimits.registerRateLimit, (req, res) => {
        res.json({ success: true });
      });

      // Trigger login rate limit
      await request(app).post('/login').send({});
      const loginBlocked = await request(app).post('/login').send({});
      assert.ok(loginBlocked.body.error.includes('login'));

      // Trigger registration rate limit
      await request(app).post('/register').send({});
      const registerBlocked = await request(app).post('/register').send({});
      assert.ok(registerBlocked.body.error.includes('registration'));
    });
  });

  test.describe('IP-based Rate Limiting', () => {
    test('should track rate limits per IP address', async () => {
      process.env.RATE_LIMIT_LOGIN_MAX = '2';
      delete require.cache[require.resolve('../middleware/rate-limit')];
      const rateLimits = require('../middleware/rate-limit');

      const app = express();
      app.use(express.json());
      app.post('/login', rateLimits.loginRateLimit, (req, res) => {
        res.json({ success: true });
      });

      // Make 2 requests from same IP (supertest default)
      await request(app).post('/login').send({});
      await request(app).post('/login').send({});

      // Third from same IP should be blocked
      const blocked = await request(app).post('/login').send({});
      assert.strictEqual(blocked.status, 429);
    });
  });
});
