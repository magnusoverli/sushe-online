const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { createQueryBuilder } = require('../utils/db-helpers');

/**
 * Create a mock PostgreSQL pool that records queries
 */
function createMockPool(mockRows = [], mockRowCount = 0) {
  const pool = {
    queries: [],
    query(sql, values) {
      pool.queries.push({ sql, values });
      return Promise.resolve({ rows: mockRows, rowCount: mockRowCount });
    },
  };
  return pool;
}

// =============================================================================
// findAll tests
// =============================================================================

describe('QueryBuilder.findAll', () => {
  let pool, qb;

  beforeEach(() => {
    pool = createMockPool([
      { id: 1, name: 'test1' },
      { id: 2, name: 'test2' },
    ]);
    qb = createQueryBuilder(pool);
  });

  it('should select all records with no where clause', async () => {
    const results = await qb.findAll('users');
    assert.strictEqual(results.length, 2);
    assert.strictEqual(pool.queries[0].sql, 'SELECT * FROM users');
    assert.deepStrictEqual(pool.queries[0].values, []);
  });

  it('should apply simple where conditions', async () => {
    await qb.findAll('users', { name: 'test', active: true });
    assert.ok(pool.queries[0].sql.includes('WHERE name = $1 AND active = $2'));
    assert.deepStrictEqual(pool.queries[0].values, ['test', true]);
  });

  it('should apply custom where clause', async () => {
    await qb.findAll('users', {
      clause: 'age > $1 AND role = $2',
      values: [18, 'admin'],
    });
    assert.ok(pool.queries[0].sql.includes('WHERE age > $1 AND role = $2'));
    assert.deepStrictEqual(pool.queries[0].values, [18, 'admin']);
  });

  it('should select specific fields', async () => {
    await qb.findAll('users', {}, { fields: ['id', 'name'] });
    assert.ok(pool.queries[0].sql.startsWith('SELECT id, name FROM users'));
  });

  it('should apply ORDER BY clause', async () => {
    await qb.findAll('users', {}, { orderBy: 'name ASC' });
    assert.ok(pool.queries[0].sql.includes('ORDER BY name ASC'));
  });

  it('should apply LIMIT clause', async () => {
    await qb.findAll('users', {}, { limit: 10 });
    assert.ok(pool.queries[0].sql.includes('LIMIT 10'));
  });

  it('should combine all options', async () => {
    await qb.findAll(
      'users',
      { active: true },
      { fields: ['id', 'name'], orderBy: 'name', limit: 5 }
    );
    const sql = pool.queries[0].sql;
    assert.ok(sql.includes('SELECT id, name FROM users'));
    assert.ok(sql.includes('WHERE active = $1'));
    assert.ok(sql.includes('ORDER BY name'));
    assert.ok(sql.includes('LIMIT 5'));
  });
});

// =============================================================================
// findOne tests
// =============================================================================

describe('QueryBuilder.findOne', () => {
  it('should return first record', async () => {
    const pool = createMockPool([{ id: 1, name: 'test' }]);
    const qb = createQueryBuilder(pool);

    const result = await qb.findOne('users', { id: 1 });
    assert.deepStrictEqual(result, { id: 1, name: 'test' });
    assert.ok(pool.queries[0].sql.includes('LIMIT 1'));
  });

  it('should return null when no records found', async () => {
    const pool = createMockPool([]);
    const qb = createQueryBuilder(pool);

    const result = await qb.findOne('users', { id: 999 });
    assert.strictEqual(result, null);
  });
});

// =============================================================================
// assertExists tests
// =============================================================================

describe('QueryBuilder.assertExists', () => {
  it('should not throw if record exists', async () => {
    const pool = createMockPool([{ '?column?': 1 }]);
    const qb = createQueryBuilder(pool);

    await assert.doesNotReject(async () => {
      await qb.assertExists('users', 'id', 1);
    });
  });

  it('should throw 404 error if record does not exist', async () => {
    const pool = createMockPool([]);
    const qb = createQueryBuilder(pool);

    await assert.rejects(
      async () => await qb.assertExists('users', 'id', 999, 'User not found'),
      (err) => {
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.message, 'User not found');
        return true;
      }
    );
  });

  it('should use default error message', async () => {
    const pool = createMockPool([]);
    const qb = createQueryBuilder(pool);

    await assert.rejects(
      async () => await qb.assertExists('albums', 'id', 999),
      (err) => {
        assert.strictEqual(err.message, 'albums not found');
        return true;
      }
    );
  });
});

// =============================================================================
// exists tests
// =============================================================================

describe('QueryBuilder.exists', () => {
  it('should return true if record exists', async () => {
    const pool = createMockPool([{ '?column?': 1 }]);
    const qb = createQueryBuilder(pool);

    const result = await qb.exists('users', { email: 'test@test.com' });
    assert.strictEqual(result, true);
  });

  it('should return false if record does not exist', async () => {
    const pool = createMockPool([]);
    const qb = createQueryBuilder(pool);

    const result = await qb.exists('users', { email: 'none@test.com' });
    assert.strictEqual(result, false);
  });
});

// =============================================================================
// insert tests
// =============================================================================

describe('QueryBuilder.insert', () => {
  it('should insert a record and return it', async () => {
    const pool = createMockPool([{ id: 1, name: 'new', value: 10 }]);
    const qb = createQueryBuilder(pool);

    const result = await qb.insert('items', { name: 'new', value: 10 });
    assert.deepStrictEqual(result, { id: 1, name: 'new', value: 10 });

    const sql = pool.queries[0].sql;
    assert.ok(sql.includes('INSERT INTO items'));
    assert.ok(sql.includes('name, value'));
    assert.ok(sql.includes('$1, $2'));
    assert.ok(sql.includes('RETURNING *'));
    assert.deepStrictEqual(pool.queries[0].values, ['new', 10]);
  });

  it('should return specific fields', async () => {
    const pool = createMockPool([{ id: 1 }]);
    const qb = createQueryBuilder(pool);

    await qb.insert('items', { name: 'new' }, ['id']);
    assert.ok(pool.queries[0].sql.includes('RETURNING id'));
  });
});

// =============================================================================
// update tests
// =============================================================================

describe('QueryBuilder.update', () => {
  it('should update records with simple where', async () => {
    const pool = createMockPool([{ id: 1, name: 'updated' }]);
    const qb = createQueryBuilder(pool);

    const result = await qb.update('items', { name: 'updated' }, { id: 1 });
    assert.deepStrictEqual(result, [{ id: 1, name: 'updated' }]);

    const sql = pool.queries[0].sql;
    assert.ok(sql.includes('UPDATE items SET name = $1'));
    assert.ok(sql.includes('WHERE id = $2'));
    assert.deepStrictEqual(pool.queries[0].values, ['updated', 1]);
  });

  it('should update records with custom where clause', async () => {
    const pool = createMockPool([]);
    const qb = createQueryBuilder(pool);

    await qb.update(
      'items',
      { status: 'active' },
      { clause: 'created_at < $2', values: ['2024-01-01'] }
    );

    const sql = pool.queries[0].sql;
    assert.ok(sql.includes('SET status = $1'));
    assert.ok(sql.includes('WHERE created_at < $2'));
    assert.deepStrictEqual(pool.queries[0].values, ['active', '2024-01-01']);
  });

  it('should return specific fields', async () => {
    const pool = createMockPool([{ id: 1 }]);
    const qb = createQueryBuilder(pool);

    await qb.update('items', { name: 'x' }, { id: 1 }, ['id']);
    assert.ok(pool.queries[0].sql.includes('RETURNING id'));
  });
});

// =============================================================================
// delete tests
// =============================================================================

describe('QueryBuilder.delete', () => {
  it('should delete with simple where', async () => {
    const pool = createMockPool([], 3);
    const qb = createQueryBuilder(pool);

    const count = await qb.delete('items', { status: 'inactive' });
    assert.strictEqual(count, 3);

    const sql = pool.queries[0].sql;
    assert.ok(sql.includes('DELETE FROM items'));
    assert.ok(sql.includes('WHERE status = $1'));
    assert.deepStrictEqual(pool.queries[0].values, ['inactive']);
  });

  it('should delete with custom where clause', async () => {
    const pool = createMockPool([], 1);
    const qb = createQueryBuilder(pool);

    await qb.delete('items', {
      clause: 'id = $1 AND user_id = $2',
      values: [5, 'user123'],
    });

    const sql = pool.queries[0].sql;
    assert.ok(sql.includes('WHERE id = $1 AND user_id = $2'));
    assert.deepStrictEqual(pool.queries[0].values, [5, 'user123']);
  });

  it('should return rowCount of 0 when nothing deleted', async () => {
    const pool = createMockPool([], 0);
    const qb = createQueryBuilder(pool);

    const count = await qb.delete('items', { id: 999 });
    assert.strictEqual(count, 0);
  });
});
