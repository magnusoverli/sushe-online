const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const { createEnsureAdminUser } = require('../db/bootstrap-admin');

function createLogger() {
  return {
    info: mock.fn(),
    debug: mock.fn(),
    error: mock.fn(),
  };
}

describe('bootstrap-admin', () => {
  it('does nothing when an admin user already exists', async () => {
    const db = {
      raw: mock.fn(async () => ({
        rows: [
          { _id: 'admin-1', email: 'admin@localhost.com', username: 'admin' },
        ],
      })),
    };
    const logger = createLogger();
    const bcrypt = { hash: mock.fn(async () => 'hashed') };

    const ensureAdminUser = createEnsureAdminUser({ db, logger, bcrypt });
    await ensureAdminUser();

    assert.strictEqual(db.raw.mock.calls.length, 1);
    assert.strictEqual(bcrypt.hash.mock.calls.length, 0);
  });

  it('creates and verifies admin user when missing', async () => {
    const db = {
      raw: mock.fn(async (sql, params) => {
        if (sql.includes("WHERE role = 'admin'")) {
          return { rows: [] };
        }

        if (sql.includes('INSERT INTO users')) {
          assert.strictEqual(params[1], 'admin');
          assert.strictEqual(params[2], 'admin@localhost.com');
          assert.strictEqual(params[3], 'hashed-password');
          return {
            rows: [
              {
                _id: 'new-admin-id',
                email: 'admin@localhost.com',
                username: 'admin',
              },
            ],
          };
        }

        return { rows: [{ _id: 'new-admin-id' }] };
      }),
    };
    const logger = createLogger();
    const bcrypt = { hash: mock.fn(async () => 'hashed-password') };

    const ensureAdminUser = createEnsureAdminUser({ db, logger, bcrypt });
    await ensureAdminUser();

    assert.strictEqual(db.raw.mock.calls.length, 3);
    assert.strictEqual(bcrypt.hash.mock.calls.length, 1);
    assert.strictEqual(logger.error.mock.calls.length, 0);
  });

  it('logs errors and does not throw when bootstrap fails', async () => {
    const db = {
      raw: mock.fn(async () => {
        throw new Error('db failure');
      }),
    };
    const logger = createLogger();
    const bcrypt = { hash: mock.fn(async () => 'hashed-password') };

    const ensureAdminUser = createEnsureAdminUser({ db, logger, bcrypt });
    await ensureAdminUser();

    assert.strictEqual(logger.error.mock.calls.length, 1);
  });
});
