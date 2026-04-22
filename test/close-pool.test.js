/**
 * Tests for db/close-pool.js (drainPool).
 */

const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { drainPool } = require('../db/close-pool');

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makePool({
  endImpl,
  totalCount = 0,
  idleCount = 0,
  waitingCount = 0,
}) {
  return {
    totalCount,
    idleCount,
    waitingCount,
    end: mock.fn(endImpl ?? (async () => {})),
  };
}

describe('drainPool', () => {
  it('marks the pool draining then awaits pool.end()', async () => {
    const pool = makePool({ endImpl: async () => {} });
    let drainMarked = null;
    const markDraining = mock.fn((p) => {
      drainMarked = p;
    });

    const result = await drainPool(pool, {
      logger: silentLogger,
      markDraining,
    });

    assert.deepStrictEqual(result, { drained: true });
    assert.strictEqual(markDraining.mock.calls.length, 1);
    assert.strictEqual(drainMarked, pool);
    assert.strictEqual(pool.end.mock.calls.length, 1);
  });

  it('returns drained: false when pool.end() rejects', async () => {
    const pool = makePool({
      endImpl: async () => {
        const err = new Error('connection refused');
        err.code = 'ECONNREFUSED';
        throw err;
      },
    });

    const result = await drainPool(pool, {
      logger: silentLogger,
      markDraining: () => {},
    });

    assert.deepStrictEqual(result, { drained: false });
  });

  it('returns drained: false on timeout when pool.end() hangs', async () => {
    const pool = makePool({
      endImpl: () => new Promise(() => {}), // never resolves
      totalCount: 3,
      idleCount: 0,
      waitingCount: 2,
    });

    const start = Date.now();
    const result = await drainPool(pool, {
      logger: silentLogger,
      markDraining: () => {},
      timeoutMs: 50,
    });
    const elapsed = Date.now() - start;

    assert.deepStrictEqual(result, { drained: false });
    // Timeout must fire in roughly the configured window — guards against
    // an unbounded wait slipping back in.
    assert.ok(elapsed < 500, `elapsed=${elapsed}ms should be ≪ 500`);
    assert.ok(elapsed >= 40, `elapsed=${elapsed}ms should be ≥ ~50ms`);
  });

  it('treats missing pool gracefully', async () => {
    const result = await drainPool(null, {
      logger: silentLogger,
      markDraining: () => {},
    });
    assert.deepStrictEqual(result, { drained: true });
  });

  it('treats pool without end() gracefully', async () => {
    const result = await drainPool(
      {},
      { logger: silentLogger, markDraining: () => {} }
    );
    assert.deepStrictEqual(result, { drained: true });
  });

  it('logs totalCount/idleCount/waitingCount on timeout', async () => {
    const errors = [];
    const logger = {
      ...silentLogger,
      error: (msg, ctx) => errors.push({ msg, ctx }),
    };
    const pool = makePool({
      endImpl: () => new Promise(() => {}),
      totalCount: 5,
      idleCount: 1,
      waitingCount: 4,
    });

    await drainPool(pool, {
      logger,
      markDraining: () => {},
      timeoutMs: 20,
    });

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].ctx.totalCount, 5);
    assert.strictEqual(errors[0].ctx.idleCount, 1);
    assert.strictEqual(errors[0].ctx.waitingCount, 4);
  });

  it('handles a synchronous pool.end() value', async () => {
    // Some mocks or wrappers return a non-promise; drainPool wraps in Promise.resolve.
    const pool = {
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
      end: mock.fn(() => undefined), // not a promise
    };
    const result = await drainPool(pool, {
      logger: silentLogger,
      markDraining: () => {},
    });
    assert.deepStrictEqual(result, { drained: true });
  });
});

describe('drainPool + ShuttingDownError integration', () => {
  it('markPoolDraining causes PgDatastore._query to fast-fail', async () => {
    const {
      PgDatastore,
      markPoolDraining,
      ShuttingDownError,
    } = require('../db/postgres');
    const pool = {
      query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
      connect: mock.fn(async () => ({
        query: async () => ({}),
        release: () => {},
      })),
    };
    const ds = new PgDatastore(pool, 't', { _id: '_id' });
    // Before draining: raw() works
    await ds.raw('SELECT 1');
    assert.strictEqual(pool.query.mock.calls.length, 1);

    // After draining: raw() rejects with ShuttingDownError
    markPoolDraining(pool);
    await assert.rejects(
      () => ds.raw('SELECT 1'),
      (err) => err instanceof ShuttingDownError
    );
    // Pool was NOT queried during the rejected call
    assert.strictEqual(pool.query.mock.calls.length, 1);

    // withClient also rejects
    await assert.rejects(
      () => ds.withClient(async () => 'x'),
      (err) => err instanceof ShuttingDownError
    );
    // withTransaction also rejects
    await assert.rejects(
      () => ds.withTransaction(async () => 'x'),
      (err) => err instanceof ShuttingDownError
    );
  });
});
