const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const {
  createRecommendationService,
} = require('../services/recommendation-service');
const { TransactionAbort } = require('../db/transaction');
const { asMockDb, createMockLogger } = require('./helpers');

describe('recommendation-service', () => {
  it('addRecommendation should use conflict-aware insert and report existing recommender', async () => {
    const client = {
      query: mock.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('INSERT INTO recommendations')) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('SELECT u.username')) {
          return { rows: [{ username: 'alice' }], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: mock.fn(),
    };
    const pool = asMockDb({
      query: mock.fn(async (sql) => {
        if (
          sql.includes('SELECT COUNT(*) as count FROM recommendation_access')
        ) {
          return { rows: [{ count: '0' }], rowCount: 1 };
        }

        if (sql.includes('SELECT locked FROM recommendation_settings')) {
          return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected raw query: ${sql}`);
      }),
      connect: mock.fn(async () => client),
    });

    const service = createRecommendationService({
      db: pool,
      logger: createMockLogger(),
      crypto: { randomBytes: () => Buffer.from('123456789012') },
      upsertAlbumRecord: mock.fn(async () => 'album-1'),
    });

    await assert.rejects(
      () =>
        service.addRecommendation(
          2024,
          { artist: "Paysage d'Hiver", album: 'Winterkaelte' },
          'Essential',
          { _id: 'user-1', username: 'bob' }
        ),
      (err) => {
        assert.ok(err instanceof TransactionAbort);
        assert.strictEqual(err.statusCode, 409);
        assert.strictEqual(err.body.recommended_by, 'alice');
        return true;
      }
    );

    const insertCall = client.query.mock.calls.find((call) =>
      call.arguments[0].includes('INSERT INTO recommendations')
    );
    assert.ok(
      insertCall.arguments[0].includes(
        'ON CONFLICT (year, album_id) DO NOTHING'
      )
    );
  });

  it('editReasoning should return 404 when recommendation does not exist', async () => {
    const pool = asMockDb({
      query: mock.fn(async (sql) => {
        if (sql.includes('UPDATE recommendations')) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('SELECT recommended_by FROM recommendations')) {
          return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected raw query: ${sql}`);
      }),
    });

    const service = createRecommendationService({
      db: pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
    });

    await assert.rejects(
      () =>
        service.editReasoning(2024, 'missing-album', 'Updated note', 'user-1'),
      (err) => {
        assert.ok(err instanceof TransactionAbort);
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.body.error, 'Recommendation not found');
        return true;
      }
    );
  });
});
