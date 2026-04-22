/**
 * Tests for withRetry / computeBackoffDelay in db/retry-wrapper.js.
 *
 * The existing healthCheck tests live in test/retry-wrapper.test.js.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { withRetry, computeBackoffDelay } = require('../db/retry-wrapper.js');

const silentLogger = {
  debug: () => {},
  warn: () => {},
  info: () => {},
  error: () => {},
};

function pgError(code, message = 'err') {
  const err = new Error(message);
  err.code = code;
  return err;
}

describe('computeBackoffDelay', () => {
  it('returns deterministic ceiling when jitter is disabled', () => {
    assert.strictEqual(
      computeBackoffDelay(0, { jitter: false, baseMs: 50, maxMs: 1000 }),
      50
    );
    assert.strictEqual(
      computeBackoffDelay(1, { jitter: false, baseMs: 50, maxMs: 1000 }),
      100
    );
    assert.strictEqual(
      computeBackoffDelay(2, { jitter: false, baseMs: 50, maxMs: 1000 }),
      200
    );
  });

  it('caps at maxMs even at high attempt counts', () => {
    assert.strictEqual(
      computeBackoffDelay(20, { jitter: false, baseMs: 50, maxMs: 1000 }),
      1000
    );
  });

  it('with jitter returns a value in [0, ceiling]', () => {
    // Force random = 0.0 and random = 0.999999 to bracket the range
    const lo = computeBackoffDelay(2, {
      baseMs: 50,
      maxMs: 1000,
      random: () => 0,
    });
    const hi = computeBackoffDelay(2, {
      baseMs: 50,
      maxMs: 1000,
      random: () => 0.999999,
    });
    assert.strictEqual(lo, 0);
    // ceiling at attempt=2 is min(1000, 50*4) = 200 → floor(0.999999*200) = 199
    assert.ok(hi >= 0 && hi <= 200, `expected hi in [0,200], got ${hi}`);
  });
});

describe('withRetry', () => {
  it('returns the value on first-try success without retrying', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return 42;
      },
      { logger: silentLogger, sleep: async () => {} }
    );
    assert.strictEqual(result, 42);
    assert.strictEqual(calls, 1);
  });

  it('retries on retryable errors when idempotent is true', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw pgError('40001', 'serialization_failure');
        return 'ok';
      },
      {
        idempotent: true,
        retries: 3,
        logger: silentLogger,
        sleep: async () => {},
      }
    );
    assert.strictEqual(result, 'ok');
    assert.strictEqual(calls, 3);
  });

  it('does NOT retry non-retryable errors even when idempotent', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls++;
            throw pgError('23505', 'unique_violation');
          },
          {
            idempotent: true,
            retries: 5,
            logger: silentLogger,
            sleep: async () => {},
          }
        ),
      (err) => err.code === '23505'
    );
    assert.strictEqual(calls, 1);
  });

  it('does NOT retry when not idempotent and no beforeFirstQuery hook', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls++;
            throw pgError('40001');
          },
          {
            retries: 3,
            logger: silentLogger,
            sleep: async () => {},
          }
        ),
      (err) => err.code === '40001'
    );
    assert.strictEqual(
      calls,
      1,
      'Non-idempotent call must not retry without an explicit safe-to-retry signal'
    );
  });

  it('retries when beforeFirstQuery hook returns true (connection-level failure)', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls === 1) throw pgError('ECONNRESET', 'socket reset');
        return 'reconnected';
      },
      {
        beforeFirstQuery: () => true,
        retries: 2,
        logger: silentLogger,
        sleep: async () => {},
      }
    );
    assert.strictEqual(result, 'reconnected');
    assert.strictEqual(calls, 2);
  });

  it('does NOT retry when beforeFirstQuery returns false (side-effect already happened)', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls++;
            throw pgError('40001');
          },
          {
            beforeFirstQuery: () => false,
            retries: 3,
            logger: silentLogger,
            sleep: async () => {},
          }
        ),
      (err) => err.code === '40001'
    );
    assert.strictEqual(calls, 1);
  });

  it('exhausts retries and throws the final error', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls++;
            throw pgError('40P01', `deadlock attempt ${calls}`);
          },
          {
            idempotent: true,
            retries: 3,
            logger: silentLogger,
            sleep: async () => {},
          }
        ),
      (err) => err.code === '40P01' && /attempt 4$/.test(err.message)
    );
    assert.strictEqual(calls, 4); // 1 initial + 3 retries
  });

  it('sleeps between retries with correct delay sequence', async () => {
    const delays = [];
    let calls = 0;
    await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw pgError('40001');
        return 'ok';
      },
      {
        idempotent: true,
        retries: 3,
        baseMs: 10,
        maxMs: 1000,
        jitter: false, // deterministic
        logger: silentLogger,
        sleep: async (ms) => {
          delays.push(ms);
        },
      }
    );
    // Attempts 0 and 1 fail → sleeps at ceilings 10 and 20.
    assert.deepStrictEqual(delays, [10, 20]);
  });

  it('passes code through to logger on exhaustion', async () => {
    let warned = null;
    const logger = {
      ...silentLogger,
      warn: (msg, ctx) => {
        warned = { msg, ctx };
      },
    };
    await assert.rejects(() =>
      withRetry(
        async () => {
          throw pgError('40001');
        },
        {
          idempotent: true,
          retries: 1,
          logger,
          sleep: async () => {},
        }
      )
    );
    assert.ok(warned, 'warn should fire on exhaustion');
    assert.strictEqual(warned.ctx.code, '40001');
    assert.strictEqual(warned.ctx.attempts, 2);
  });

  it('classifies via injected classifier override', async () => {
    let calls = 0;
    // Custom classifier treats code 'X' as retryable.
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw pgError('X', 'custom retryable');
        return 'done';
      },
      {
        idempotent: true,
        retries: 2,
        classify: (err) =>
          err.code === 'X'
            ? { kind: 'retryable', code: 'X' }
            : { kind: 'unknown', code: err.code },
        logger: silentLogger,
        sleep: async () => {},
      }
    );
    assert.strictEqual(result, 'done');
    assert.strictEqual(calls, 2);
  });

  it('propagates non-pg thrown values without crashing the classifier', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls++;
            throw 'string error';
          },
          {
            idempotent: true,
            retries: 3,
            logger: silentLogger,
            sleep: async () => {},
          }
        ),
      (err) => err === 'string error'
    );
    assert.strictEqual(calls, 1);
  });
});
