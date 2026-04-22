/**
 * Tests for Database Transaction Utilities
 *
 * Tests the withTransaction() helper and TransactionAbort class.
 */

const test = require('node:test');
const assert = require('node:assert');
const { mock } = require('node:test');
const { withTransaction, TransactionAbort } = require('../db/transaction');

/**
 * Create a mock pool and client for testing
 */
function createMockPool() {
  const mockClient = {
    query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    release: mock.fn(),
  };

  const mockPool = {
    connect: mock.fn(async () => mockClient),
  };

  return { mockPool, mockClient };
}

test('Transaction Utilities', async (t) => {
  // ============================================
  // TransactionAbort Tests
  // ============================================

  await t.test('TransactionAbort', async (t) => {
    await t.test('should store statusCode and body', () => {
      const abort = new TransactionAbort(404, { error: 'Not found' });
      assert.strictEqual(abort.statusCode, 404);
      assert.deepStrictEqual(abort.body, { error: 'Not found' });
    });

    await t.test('should not be an instance of Error', () => {
      const abort = new TransactionAbort(400, { error: 'Bad request' });
      assert.ok(!(abort instanceof Error));
    });

    await t.test('should be identifiable via instanceof', () => {
      const abort = new TransactionAbort(403, { error: 'Forbidden' });
      assert.ok(abort instanceof TransactionAbort);
    });
  });

  // ============================================
  // withTransaction Tests
  // ============================================

  await t.test('withTransaction', async (t) => {
    await t.test(
      'should execute BEGIN, callback, and COMMIT on success',
      async () => {
        const { mockPool, mockClient } = createMockPool();

        await withTransaction(mockPool, async (client) => {
          await client.query('SELECT 1');
        });

        const calls = mockClient.query.mock.calls;
        assert.strictEqual(calls[0].arguments[0], 'BEGIN');
        assert.strictEqual(calls[1].arguments[0], 'SELECT 1');
        assert.strictEqual(calls[2].arguments[0], 'COMMIT');
        assert.strictEqual(calls.length, 3);
      }
    );

    await t.test('should return the callback result', async () => {
      const { mockPool } = createMockPool();

      const result = await withTransaction(mockPool, async () => {
        return { success: true, data: [1, 2, 3] };
      });

      assert.deepStrictEqual(result, { success: true, data: [1, 2, 3] });
    });

    await t.test('should ROLLBACK and re-throw on error', async () => {
      const { mockPool, mockClient } = createMockPool();
      const testError = new Error('Something went wrong');

      await assert.rejects(
        () =>
          withTransaction(mockPool, async () => {
            throw testError;
          }),
        (err) => {
          assert.strictEqual(err, testError);
          return true;
        }
      );

      const calls = mockClient.query.mock.calls;
      assert.strictEqual(calls[0].arguments[0], 'BEGIN');
      assert.strictEqual(calls[1].arguments[0], 'ROLLBACK');
      assert.strictEqual(calls.length, 2);
    });

    await t.test('should ROLLBACK and re-throw TransactionAbort', async () => {
      const { mockPool, mockClient } = createMockPool();
      const abort = new TransactionAbort(404, { error: 'List not found' });

      await assert.rejects(
        () =>
          withTransaction(mockPool, async () => {
            throw abort;
          }),
        (err) => {
          assert.ok(err instanceof TransactionAbort);
          assert.strictEqual(err.statusCode, 404);
          assert.deepStrictEqual(err.body, { error: 'List not found' });
          return true;
        }
      );

      const calls = mockClient.query.mock.calls;
      assert.strictEqual(calls[0].arguments[0], 'BEGIN');
      assert.strictEqual(calls[1].arguments[0], 'ROLLBACK');
    });

    await t.test('should always release the client on success', async () => {
      const { mockPool, mockClient } = createMockPool();

      await withTransaction(mockPool, async () => {
        return 'done';
      });

      assert.strictEqual(mockClient.release.mock.calls.length, 1);
    });

    await t.test('should always release the client on error', async () => {
      const { mockPool, mockClient } = createMockPool();

      await assert.rejects(() =>
        withTransaction(mockPool, async () => {
          throw new Error('fail');
        })
      );

      assert.strictEqual(mockClient.release.mock.calls.length, 1);
    });

    await t.test(
      'should always release the client on TransactionAbort',
      async () => {
        const { mockPool, mockClient } = createMockPool();

        await assert.rejects(() =>
          withTransaction(mockPool, async () => {
            throw new TransactionAbort(400, { error: 'bad' });
          })
        );

        assert.strictEqual(mockClient.release.mock.calls.length, 1);
      }
    );

    await t.test('should pass the client to the callback', async () => {
      const { mockPool, mockClient } = createMockPool();
      let receivedClient = null;

      await withTransaction(mockPool, async (client) => {
        receivedClient = client;
      });

      assert.strictEqual(receivedClient, mockClient);
    });

    await t.test(
      'should work with async callbacks that do multiple queries',
      async () => {
        const { mockPool, mockClient } = createMockPool();

        await withTransaction(mockPool, async (client) => {
          await client.query('INSERT INTO foo VALUES ($1)', ['bar']);
          await client.query('UPDATE baz SET x = $1', [42]);
        });

        const calls = mockClient.query.mock.calls;
        assert.strictEqual(calls.length, 4); // BEGIN, INSERT, UPDATE, COMMIT
        assert.strictEqual(calls[0].arguments[0], 'BEGIN');
        assert.strictEqual(calls[3].arguments[0], 'COMMIT');
      }
    );

    // ============================================
    // ROLLBACK failure preservation
    // ============================================

    await t.test(
      'should preserve original error when ROLLBACK itself fails',
      async () => {
        // Build a mock where BEGIN succeeds, ROLLBACK fails.
        const mockClient = {
          query: mock.fn(async (sql) => {
            if (sql === 'ROLLBACK') {
              const rollbackErr = new Error('connection terminated');
              rollbackErr.code = '08006';
              throw rollbackErr;
            }
            return { rows: [], rowCount: 0 };
          }),
          release: mock.fn(),
        };
        const mockPool = { connect: mock.fn(async () => mockClient) };
        const originalError = new Error('business logic failed');
        originalError.code = 'CUSTOM_BUSINESS_ERROR';

        await assert.rejects(
          () =>
            withTransaction(mockPool, async () => {
              throw originalError;
            }),
          (err) => {
            // MUST be the original error, not the rollback error
            assert.strictEqual(err, originalError);
            assert.strictEqual(err.code, 'CUSTOM_BUSINESS_ERROR');
            return true;
          }
        );

        // Confirm ROLLBACK was actually attempted
        const calls = mockClient.query.mock.calls;
        assert.strictEqual(calls[0].arguments[0], 'BEGIN');
        assert.strictEqual(calls[1].arguments[0], 'ROLLBACK');
      }
    );

    await t.test(
      'should release client with the rollback error so pg discards the connection',
      async () => {
        const mockClient = {
          query: mock.fn(async (sql) => {
            if (sql === 'ROLLBACK') {
              const rollbackErr = new Error('connection terminated');
              rollbackErr.code = '08006';
              throw rollbackErr;
            }
            return { rows: [], rowCount: 0 };
          }),
          release: mock.fn(),
        };
        const mockPool = { connect: mock.fn(async () => mockClient) };

        await assert.rejects(() =>
          withTransaction(mockPool, async () => {
            throw new Error('anything');
          })
        );

        // release() must be called exactly once, with the rollback error
        // as its argument — this tells pg the connection is poisoned.
        assert.strictEqual(mockClient.release.mock.calls.length, 1);
        const releaseArg = mockClient.release.mock.calls[0].arguments[0];
        assert.ok(
          releaseArg instanceof Error,
          'release should receive the rollback error'
        );
        assert.strictEqual(releaseArg.code, '08006');
      }
    );

    await t.test(
      'should release client without error when ROLLBACK succeeds',
      async () => {
        const { mockPool, mockClient } = createMockPool();

        await assert.rejects(() =>
          withTransaction(mockPool, async () => {
            throw new Error('business error');
          })
        );

        // release() called with undefined (no error) since ROLLBACK succeeded
        assert.strictEqual(mockClient.release.mock.calls.length, 1);
        assert.strictEqual(
          mockClient.release.mock.calls[0].arguments[0],
          undefined
        );
      }
    );

    await t.test(
      'should release client without error on happy path (COMMIT success)',
      async () => {
        const { mockPool, mockClient } = createMockPool();

        await withTransaction(mockPool, async () => 'ok');

        assert.strictEqual(mockClient.release.mock.calls.length, 1);
        assert.strictEqual(
          mockClient.release.mock.calls[0].arguments[0],
          undefined
        );
      }
    );
  });
});
