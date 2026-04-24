const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  PgDatastore,
  waitForPostgres,
  warmConnections,
  ensureDb,
} = require('../db/postgres.js');

describe('PgDatastore canonical facade', () => {
  it('raw uses pool.query for plain SQL', async () => {
    const pool = {
      query: mock.fn(async (sql, params) => ({ rows: [{ sql, params }] })),
    };
    const db = new PgDatastore(pool);

    const result = await db.raw('SELECT 1 WHERE id = $1', ['user-1']);

    assert.strictEqual(pool.query.mock.calls.length, 1);
    assert.strictEqual(
      pool.query.mock.calls[0].arguments[0],
      'SELECT 1 WHERE id = $1'
    );
    assert.deepStrictEqual(result.rows[0].params, ['user-1']);
  });

  it('raw uses prepared statements when name is provided', async () => {
    const pool = {
      query: mock.fn(async (statement, params) => ({
        rows: [{ statement, params }],
      })),
    };
    const db = new PgDatastore(pool);

    const result = await db.raw('SELECT 1', [], { name: 'select-one' });

    assert.deepStrictEqual(pool.query.mock.calls[0].arguments[0], {
      name: 'select-one',
      text: 'SELECT 1',
    });
    assert.deepStrictEqual(result.rows[0].params, []);
  });

  it('raw retries retryable errors when marked retryable', async () => {
    let attempts = 0;
    const pool = {
      query: mock.fn(async () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('serialization failure');
          error.code = '40001';
          throw error;
        }
        return { rows: [{ ok: true }] };
      }),
    };
    const db = new PgDatastore(pool);

    const result = await db.raw('SELECT 1', [], { retryable: true });

    assert.strictEqual(pool.query.mock.calls.length, 2);
    assert.deepStrictEqual(result.rows, [{ ok: true }]);
  });

  it('withClient releases clients on success and failure', async () => {
    const release = mock.fn();
    const client = { query: mock.fn(), release };
    const pool = { connect: mock.fn(async () => client) };
    const db = new PgDatastore(pool);

    const value = await db.withClient(async (leasedClient) => leasedClient);
    assert.strictEqual(value, client);
    assert.strictEqual(release.mock.calls.length, 1);
    assert.strictEqual(release.mock.calls[0].arguments[0], undefined);

    await assert.rejects(
      () => db.withClient(async () => Promise.reject(new Error('boom'))),
      /boom/
    );
    assert.strictEqual(release.mock.calls.length, 2);
    assert.strictEqual(release.mock.calls[1].arguments[0].message, 'boom');
  });

  it('withTransaction applies BEGIN/COMMIT and isolation override', async () => {
    const client = {
      query: mock.fn(async () => ({ rows: [] })),
      release: mock.fn(),
    };
    const pool = { connect: mock.fn(async () => client) };
    const db = new PgDatastore(pool);

    await db.withTransaction(async () => 'ok', { isolation: 'SERIALIZABLE' });

    assert.deepStrictEqual(
      client.query.mock.calls.map((call) => call.arguments[0]),
      ['BEGIN', 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE', 'COMMIT']
    );
  });
});

describe('DB helpers', () => {
  it('ensureDb accepts canonical datastores and rejects missing deps', () => {
    const db = { raw: async () => ({ rows: [] }) };
    assert.strictEqual(ensureDb(db, 'test-service'), db);
    assert.throws(() => ensureDb(null, 'test-service'), /requires deps\.db/);
  });

  it('waitForPostgres retries until the database is reachable', async () => {
    let attempts = 0;
    const pool = {
      query: mock.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('not ready');
        }
        return { rows: [{ ok: true }] };
      }),
    };

    await waitForPostgres(pool, 3, 1);

    assert.strictEqual(pool.query.mock.calls.length, 3);
  });

  it('warmConnections uses pool.options.min when available', async () => {
    const pool = {
      options: { min: 3 },
      query: mock.fn(async () => ({ rows: [{ warm: true }] })),
    };

    await warmConnections(pool);

    assert.strictEqual(pool.query.mock.calls.length, 3);
  });
});
