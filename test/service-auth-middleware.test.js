/**
 * Tests for Service Authentication Middleware
 *
 * Tests requireSpotifyAuth and requireTidalAuth middleware functions
 * for token validation and refresh behavior.
 */

const test = require('node:test');
const assert = require('node:assert');
const { createServiceAuthMiddleware } = require('../middleware/service-auth');

// Mock logger
const mockLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

// Helper to create mock request/response
function createMockReqRes(user = {}) {
  const req = { user };
  const res = {
    statusCode: null,
    jsonData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    },
  };
  return { req, res };
}

test('Service Auth Middleware', async (t) => {
  await t.test('requireSpotifyAuth', async (t) => {
    await t.test(
      'should call next() and attach spotifyAuth on successful token validation',
      async () => {
        const mockSpotifyAuth = {
          access_token: 'valid-token',
          expires_in: 3600,
        };
        const ensureValidSpotifyToken = async () => ({
          success: true,
          spotifyAuth: mockSpotifyAuth,
        });

        const { requireSpotifyAuth } = createServiceAuthMiddleware({
          ensureValidSpotifyToken,
          ensureValidTidalToken: async () => ({}),
          users: {},
          logger: mockLogger,
        });

        const { req, res } = createMockReqRes({ _id: 'user123' });
        let nextCalled = false;
        const next = () => {
          nextCalled = true;
        };

        await requireSpotifyAuth(req, res, next);

        assert.strictEqual(nextCalled, true, 'next() should be called');
        assert.deepStrictEqual(
          req.spotifyAuth,
          mockSpotifyAuth,
          'spotifyAuth should be attached to req'
        );
        assert.strictEqual(res.statusCode, null, 'status should not be set');
      }
    );

    await t.test('should return 401 when token validation fails', async () => {
      const ensureValidSpotifyToken = async () => ({
        success: false,
        error: 'NOT_CONNECTED',
        message: 'Spotify not connected',
      });

      const { requireSpotifyAuth } = createServiceAuthMiddleware({
        ensureValidSpotifyToken,
        ensureValidTidalToken: async () => ({}),
        users: {},
        logger: mockLogger,
      });

      const { req, res } = createMockReqRes({ _id: 'user123' });
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      await requireSpotifyAuth(req, res, next);

      assert.strictEqual(nextCalled, false, 'next() should not be called');
      assert.strictEqual(res.statusCode, 401, 'status should be 401');
      assert.deepStrictEqual(res.jsonData, {
        error: 'Spotify not connected',
        code: 'NOT_CONNECTED',
        service: 'spotify',
      });
    });

    await t.test(
      'should return 500 when token validation throws error',
      async () => {
        const ensureValidSpotifyToken = async () => {
          throw new Error('Database connection failed');
        };

        const { requireSpotifyAuth } = createServiceAuthMiddleware({
          ensureValidSpotifyToken,
          ensureValidTidalToken: async () => ({}),
          users: {},
          logger: mockLogger,
        });

        const { req, res } = createMockReqRes({ _id: 'user123' });
        let nextCalled = false;
        const next = () => {
          nextCalled = true;
        };

        await requireSpotifyAuth(req, res, next);

        assert.strictEqual(nextCalled, false, 'next() should not be called');
        assert.strictEqual(res.statusCode, 500, 'status should be 500');
        assert.deepStrictEqual(res.jsonData, {
          error: 'Authentication service error',
        });
      }
    );

    await t.test(
      'should return 401 with TOKEN_EXPIRED code when token is expired',
      async () => {
        const ensureValidSpotifyToken = async () => ({
          success: false,
          error: 'TOKEN_EXPIRED',
          message: 'Spotify token expired and refresh failed',
        });

        const { requireSpotifyAuth } = createServiceAuthMiddleware({
          ensureValidSpotifyToken,
          ensureValidTidalToken: async () => ({}),
          users: {},
          logger: mockLogger,
        });

        const { req, res } = createMockReqRes({ _id: 'user123' });
        await requireSpotifyAuth(req, res, () => {});

        assert.strictEqual(res.statusCode, 401);
        assert.strictEqual(res.jsonData.code, 'TOKEN_EXPIRED');
        assert.strictEqual(res.jsonData.service, 'spotify');
      }
    );
  });

  await t.test('requireTidalAuth', async (t) => {
    await t.test(
      'should call next() and attach tidalAuth on successful token validation',
      async () => {
        const mockTidalAuth = {
          access_token: 'valid-tidal-token',
          expires_in: 3600,
        };
        const ensureValidTidalToken = async () => ({
          success: true,
          tidalAuth: mockTidalAuth,
        });

        const { requireTidalAuth } = createServiceAuthMiddleware({
          ensureValidSpotifyToken: async () => ({}),
          ensureValidTidalToken,
          users: {},
          logger: mockLogger,
        });

        const { req, res } = createMockReqRes({ _id: 'user123' });
        let nextCalled = false;
        const next = () => {
          nextCalled = true;
        };

        await requireTidalAuth(req, res, next);

        assert.strictEqual(nextCalled, true, 'next() should be called');
        assert.deepStrictEqual(
          req.tidalAuth,
          mockTidalAuth,
          'tidalAuth should be attached to req'
        );
        assert.strictEqual(res.statusCode, null, 'status should not be set');
      }
    );

    await t.test('should return 401 when token validation fails', async () => {
      const ensureValidTidalToken = async () => ({
        success: false,
        error: 'NOT_CONNECTED',
        message: 'Tidal not connected',
      });

      const { requireTidalAuth } = createServiceAuthMiddleware({
        ensureValidSpotifyToken: async () => ({}),
        ensureValidTidalToken,
        users: {},
        logger: mockLogger,
      });

      const { req, res } = createMockReqRes({ _id: 'user123' });
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      await requireTidalAuth(req, res, next);

      assert.strictEqual(nextCalled, false, 'next() should not be called');
      assert.strictEqual(res.statusCode, 401, 'status should be 401');
      assert.deepStrictEqual(res.jsonData, {
        error: 'Tidal not connected',
        code: 'NOT_CONNECTED',
        service: 'tidal',
      });
    });

    await t.test(
      'should return 500 when token validation throws error',
      async () => {
        const ensureValidTidalToken = async () => {
          throw new Error('Database connection failed');
        };

        const { requireTidalAuth } = createServiceAuthMiddleware({
          ensureValidSpotifyToken: async () => ({}),
          ensureValidTidalToken,
          users: {},
          logger: mockLogger,
        });

        const { req, res } = createMockReqRes({ _id: 'user123' });
        let nextCalled = false;
        const next = () => {
          nextCalled = true;
        };

        await requireTidalAuth(req, res, next);

        assert.strictEqual(nextCalled, false, 'next() should not be called');
        assert.strictEqual(res.statusCode, 500, 'status should be 500');
        assert.deepStrictEqual(res.jsonData, {
          error: 'Authentication service error',
        });
      }
    );

    await t.test(
      'should return 401 with TOKEN_EXPIRED code when token is expired',
      async () => {
        const ensureValidTidalToken = async () => ({
          success: false,
          error: 'TOKEN_EXPIRED',
          message: 'Tidal token expired and refresh failed',
        });

        const { requireTidalAuth } = createServiceAuthMiddleware({
          ensureValidSpotifyToken: async () => ({}),
          ensureValidTidalToken,
          users: {},
          logger: mockLogger,
        });

        const { req, res } = createMockReqRes({ _id: 'user123' });
        await requireTidalAuth(req, res, () => {});

        assert.strictEqual(res.statusCode, 401);
        assert.strictEqual(res.jsonData.code, 'TOKEN_EXPIRED');
        assert.strictEqual(res.jsonData.service, 'tidal');
      }
    );
  });
});
