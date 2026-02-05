/**
 * Tests for Session Helper Utilities
 *
 * Tests the async/await wrappers for Express session operations.
 */

const test = require('node:test');
const assert = require('node:assert');

// Mock logger to avoid file operations
const mockLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

// Mock the logger module before requiring session-helpers
require.cache[require.resolve('../utils/logger')] = {
  exports: mockLogger,
};

const {
  saveSessionAsync,
  saveSessionSafe,
} = require('../utils/session-helpers');

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
      const req = createMockReq();

      // Should not throw
      await saveSessionAsync(req);
    });

    await t.test('should reject when session save fails', async () => {
      const saveError = new Error('Session store unavailable');
      const req = createMockReq({ saveError });

      await assert.rejects(async () => {
        await saveSessionAsync(req);
      }, /Session store unavailable/);
    });

    await t.test('should call session.save exactly once', async () => {
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
      const req = createMockReq();

      // Should not throw
      saveSessionSafe(req, 'test update');
    });

    await t.test('should not throw when session save fails', () => {
      const saveError = new Error('Session store unavailable');
      const req = createMockReq({ saveError });

      // Should not throw - errors are logged, not thrown
      saveSessionSafe(req, 'test update');
    });

    await t.test('should call session.save', (t, done) => {
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
