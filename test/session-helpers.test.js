/**
 * Tests for Session Helper Utilities
 *
 * Tests the async/await wrappers for Express session operations.
 * Uses createSessionHelpers(deps) factory to inject a mock logger.
 */

const test = require('node:test');
const assert = require('node:assert');
const { createMockLogger } = require('./helpers');
const { createSessionHelpers } = require('../utils/session-helpers');

// Helper to create mock request with session
function createMockReq(sessionOverrides = {}) {
  return {
    session: {
      id: 'test-session-id',
      passport: { user: 'user123' },
      save: (callback) => {
        // Default: successful save
        if (sessionOverrides.saveError) {
          callback(sessionOverrides.saveError);
        } else {
          callback(null);
        }
      },
      ...sessionOverrides,
    },
  };
}

test('Session Helpers', async (t) => {
  await t.test('saveSessionAsync', async (t) => {
    await t.test('should resolve when session save succeeds', async () => {
      const mockLogger = createMockLogger();
      const { saveSessionAsync } = createSessionHelpers({
        logger: mockLogger,
      });
      const req = createMockReq();

      // Should not throw
      await saveSessionAsync(req);
    });

    await t.test('should reject when session save fails', async () => {
      const mockLogger = createMockLogger();
      const { saveSessionAsync } = createSessionHelpers({
        logger: mockLogger,
      });
      const saveError = new Error('Session store unavailable');
      const req = createMockReq({ saveError });

      await assert.rejects(async () => {
        await saveSessionAsync(req);
      }, /Session store unavailable/);
    });

    await t.test('should log error when session save fails', async () => {
      const mockLogger = createMockLogger();
      const { saveSessionAsync } = createSessionHelpers({
        logger: mockLogger,
      });
      const saveError = new Error('Session store unavailable');
      const req = createMockReq({ saveError });

      await assert.rejects(async () => {
        await saveSessionAsync(req);
      }, /Session store unavailable/);

      assert.strictEqual(mockLogger.error.mock.calls.length, 1);
      const logArgs = mockLogger.error.mock.calls[0].arguments;
      assert.strictEqual(logArgs[0], 'Session save failed');
      assert.strictEqual(logArgs[1].error, 'Session store unavailable');
      assert.strictEqual(logArgs[1].sessionId, 'test-session-id');
      assert.strictEqual(logArgs[1].userId, 'user123');
    });

    await t.test('should call session.save exactly once', async () => {
      const mockLogger = createMockLogger();
      const { saveSessionAsync } = createSessionHelpers({
        logger: mockLogger,
      });
      let saveCallCount = 0;
      const req = {
        session: {
          id: 'test-id',
          save: (callback) => {
            saveCallCount++;
            callback(null);
          },
        },
      };

      await saveSessionAsync(req);

      assert.strictEqual(saveCallCount, 1, 'save should be called once');
    });
  });

  await t.test('saveSessionSafe', async (t) => {
    await t.test('should not throw when session save succeeds', () => {
      const mockLogger = createMockLogger();
      const { saveSessionSafe } = createSessionHelpers({
        logger: mockLogger,
      });
      const req = createMockReq();

      // Should not throw
      saveSessionSafe(req, 'test update');
    });

    await t.test('should not throw when session save fails', () => {
      const mockLogger = createMockLogger();
      const { saveSessionSafe } = createSessionHelpers({
        logger: mockLogger,
      });
      const saveError = new Error('Session store unavailable');
      const req = createMockReq({ saveError });

      // Should not throw - errors are logged, not thrown
      saveSessionSafe(req, 'test update');
    });

    await t.test('should log error when session save fails', (t, done) => {
      const mockLogger = createMockLogger();
      const { saveSessionSafe } = createSessionHelpers({
        logger: mockLogger,
      });
      const saveError = new Error('Session store unavailable');
      const req = {
        session: {
          id: 'test-session-id',
          passport: { user: 'user123' },
          save: (callback) => {
            callback(saveError);
            // Verify logger was called after callback
            assert.strictEqual(mockLogger.error.mock.calls.length, 1);
            const logArgs = mockLogger.error.mock.calls[0].arguments;
            assert.strictEqual(
              logArgs[0],
              'Session save failed (non-blocking)'
            );
            assert.strictEqual(logArgs[1].context, 'test context');
            assert.strictEqual(logArgs[1].error, 'Session store unavailable');
            done();
          },
        },
      };

      saveSessionSafe(req, 'test context');
    });

    await t.test('should call session.save', (t, done) => {
      const mockLogger = createMockLogger();
      const { saveSessionSafe } = createSessionHelpers({
        logger: mockLogger,
      });
      let saveCalled = false;
      const req = {
        session: {
          id: 'test-id',
          save: (callback) => {
            saveCalled = true;
            callback(null);
            // Verify after callback
            assert.strictEqual(saveCalled, true);
            done();
          },
        },
      };

      saveSessionSafe(req, 'test');
    });
  });
});
