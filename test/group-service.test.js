const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const { createGroupService } = require('../services/group-service');
const { TransactionAbort } = require('../db/transaction');
const { createMockLogger, asMockDb } = require('./helpers');

function createTransactionPool(queryHandler) {
  const client = {
    query: mock.fn(async (sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      return queryHandler(sql, params);
    }),
    release: mock.fn(),
  };

  return {
    pool: asMockDb({
      connect: mock.fn(async () => client),
      query: mock.fn(async (sql, params) => queryHandler(sql, params)),
    }),
    client,
  };
}

describe('group-service', () => {
  it('reorderGroups should bulk update with one UNNEST query', async () => {
    const { pool, client } = createTransactionPool(async (sql) => {
      if (
        sql.includes('SELECT g._id, g.name, g.year, COUNT(l.id) as list_count')
      ) {
        return {
          rows: [
            { _id: 'g1', name: '2024', year: 2024, list_count: '1' },
            { _id: 'g2', name: 'Collection', year: null, list_count: '1' },
            { _id: 'g3', name: 'Uncategorized', year: null, list_count: '1' },
          ],
        };
      }

      if (sql.includes('UPDATE list_groups AS g')) {
        return { rows: [], rowCount: 3 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const service = createGroupService({
      db: pool,
      logger: createMockLogger(),
    });

    await service.reorderGroups('user1', ['g3', 'g1', 'g2']);

    const updateCalls = client.query.mock.calls.filter((call) =>
      call.arguments[0].includes('UPDATE list_groups AS g')
    );
    assert.strictEqual(updateCalls.length, 1);

    const updateParams = updateCalls[0].arguments[1];
    assert.deepStrictEqual(updateParams[0], ['g3', 'g1', 'g2']);
    assert.deepStrictEqual(updateParams[1], [0, 1, 2]);
    assert.strictEqual(updateParams[2], 'user1');
  });

  it('reorderGroups should reject partial order payloads', async () => {
    const { pool } = createTransactionPool(async (sql) => {
      if (
        sql.includes('SELECT g._id, g.name, g.year, COUNT(l.id) as list_count')
      ) {
        return {
          rows: [
            { _id: 'g1', name: '2024', year: 2024, list_count: '1' },
            { _id: 'g2', name: 'Collection', year: null, list_count: '1' },
            { _id: 'g3', name: 'Uncategorized', year: null, list_count: '1' },
          ],
        };
      }

      if (sql.includes('UPDATE list_groups AS g')) {
        return { rows: [], rowCount: 0 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const service = createGroupService({
      db: pool,
      logger: createMockLogger(),
    });

    await assert.rejects(
      () => service.reorderGroups('user1', ['g1', 'g2']),
      (err) => {
        assert.ok(err instanceof TransactionAbort);
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.body.error, /include all user groups/i);
        return true;
      }
    );
  });

  it('reorderGroups should allow hidden empty uncategorized groups', async () => {
    const { pool, client } = createTransactionPool(async (sql) => {
      if (
        sql.includes('SELECT g._id, g.name, g.year, COUNT(l.id) as list_count')
      ) {
        return {
          rows: [
            { _id: 'g1', name: '2024', year: 2024, list_count: '1' },
            { _id: 'g2', name: 'Collection', year: null, list_count: '1' },
            {
              _id: 'g_hidden',
              name: 'Uncategorized',
              year: null,
              list_count: '0',
            },
          ],
        };
      }

      if (sql.includes('UPDATE list_groups AS g')) {
        return { rows: [], rowCount: 2 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const service = createGroupService({
      db: pool,
      logger: createMockLogger(),
    });

    await service.reorderGroups('user1', ['g2', 'g1']);

    const updateCalls = client.query.mock.calls.filter((call) =>
      call.arguments[0].includes('UPDATE list_groups AS g')
    );
    assert.strictEqual(updateCalls.length, 1);
  });

  it('reorderLists should bulk update with one UNNEST query', async () => {
    const { pool, client } = createTransactionPool(async (sql) => {
      if (sql.includes('SELECT id FROM list_groups')) {
        return { rows: [{ id: 99 }] };
      }

      if (
        sql.includes(
          'SELECT _id FROM lists WHERE user_id = $1 AND group_id = $2'
        )
      ) {
        return { rows: [{ _id: 'l1' }, { _id: 'l2' }, { _id: 'l3' }] };
      }

      if (sql.includes('UPDATE lists AS l')) {
        return { rows: [], rowCount: 3 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const service = createGroupService({
      db: pool,
      logger: createMockLogger(),
    });

    await service.reorderLists('user1', 'group-external-id', [
      'l3',
      'l1',
      'l2',
    ]);

    const updateCalls = client.query.mock.calls.filter((call) =>
      call.arguments[0].includes('UPDATE lists AS l')
    );
    assert.strictEqual(updateCalls.length, 1);

    const updateParams = updateCalls[0].arguments[1];
    assert.deepStrictEqual(updateParams[0], ['l3', 'l1', 'l2']);
    assert.deepStrictEqual(updateParams[1], [0, 1, 2]);
    assert.strictEqual(updateParams[2], 'user1');
  });

  it('reorderLists should reject duplicate IDs in order payload', async () => {
    const { pool } = createTransactionPool(async (sql) => {
      if (sql.includes('SELECT id FROM list_groups')) {
        return { rows: [{ id: 99 }] };
      }

      if (
        sql.includes(
          'SELECT _id FROM lists WHERE user_id = $1 AND group_id = $2'
        )
      ) {
        return { rows: [{ _id: 'l1' }, { _id: 'l2' }] };
      }

      if (sql.includes('UPDATE lists AS l')) {
        return { rows: [], rowCount: 0 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const service = createGroupService({
      db: pool,
      logger: createMockLogger(),
    });

    await assert.rejects(
      () => service.reorderLists('user1', 'group-external-id', ['l1', 'l1']),
      (err) => {
        assert.ok(err instanceof TransactionAbort);
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.body.error, /duplicate list IDs/i);
        return true;
      }
    );
  });

  it('deleteGroup should check locked years in one query', async () => {
    const logger = createMockLogger();
    const { pool, client } = createTransactionPool(async (sql, params) => {
      if (sql.includes('FROM list_groups')) {
        return { rows: [{ id: 7, name: 'Collection', year: null }] };
      }

      if (
        sql.includes(
          'FROM lists WHERE group_id = $1 AND year IS NOT NULL AND is_main = TRUE'
        )
      ) {
        return { rows: [{ year: 2022 }, { year: 2024 }, { year: 2024 }] };
      }

      if (sql.includes('FROM master_lists')) {
        assert.deepStrictEqual(params[0], [2022, 2024]);
        return { rows: [{ year: 2024 }] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const service = createGroupService({ db: pool, logger });

    await assert.rejects(
      () => service.deleteGroup('user1', 'group1', false),
      (err) => {
        assert.ok(err instanceof TransactionAbort);
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.body.year, 2024);
        return true;
      }
    );

    const lockChecks = client.query.mock.calls.filter((call) =>
      call.arguments[0].includes('FROM master_lists')
    );
    assert.strictEqual(lockChecks.length, 1);
  });
});
