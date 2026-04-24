const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const {
  createAdminBootstrapService,
  createDefaultAggregateStatus,
} = require('../services/admin-bootstrap-service');

describe('admin-bootstrap-service', () => {
  it('throws when db dependency is missing', () => {
    assert.throws(
      () => createAdminBootstrapService({}),
      /AdminBootstrapService requires deps\.db/
    );
  });

  it('returns empty maps for empty year input', async () => {
    const db = { raw: mock.fn(async () => ({ rows: [] })) };
    const service = createAdminBootstrapService({ db });

    const aggregateStatuses = await service.getAggregateStatuses([]);
    const recommendationStatuses = await service.getRecommendationStatuses(
      [],
      'user-1'
    );

    assert.strictEqual(aggregateStatuses.size, 0);
    assert.strictEqual(recommendationStatuses.size, 0);
    assert.strictEqual(db.raw.mock.calls.length, 0);
  });

  it('builds aggregate statuses with defaults for missing years', async () => {
    const db = {
      raw: mock.fn(async (sql) => {
        if (sql.includes('FROM master_lists')) {
          return {
            rows: [
              {
                year: 2024,
                revealed: true,
                revealed_at: '2024-12-31T00:00:00.000Z',
                computed_at: '2024-12-30T00:00:00.000Z',
                locked: true,
                stats: {
                  totalAlbums: 100,
                  rankDistribution: { 1: 10 },
                },
              },
            ],
          };
        }

        return {
          rows: [
            {
              year: 2024,
              username: 'admin-user',
              confirmed_at: '2024-12-31T12:00:00.000Z',
            },
          ],
        };
      }),
    };

    const service = createAdminBootstrapService({ db });
    const statuses = await service.getAggregateStatuses([2024, 2025]);

    assert.strictEqual(statuses.size, 2);

    const y2024 = statuses.get(2024);
    assert.strictEqual(y2024.exists, true);
    assert.strictEqual(y2024.locked, true);
    assert.strictEqual(y2024.totalAlbums, 100);
    assert.strictEqual(y2024.confirmationCount, 1);
    assert.strictEqual(y2024.confirmations[0].username, 'admin-user');

    const y2025 = statuses.get(2025);
    assert.deepStrictEqual(y2025, createDefaultAggregateStatus());
  });

  it('builds recommendation statuses with access and lock rules', async () => {
    const db = {
      raw: mock.fn(async (sql) => {
        if (sql.includes('FROM recommendation_settings')) {
          return { rows: [{ year: 2024, locked: true }] };
        }

        if (
          sql.includes('FROM recommendation_access') &&
          sql.includes('COUNT')
        ) {
          return {
            rows: [
              { year: 2024, count: 2 },
              { year: 2025, count: 0 },
            ],
          };
        }

        if (
          sql.includes('FROM recommendation_access') &&
          sql.includes('AND user_id = $2')
        ) {
          return { rows: [{ year: 2024 }] };
        }

        return { rows: [{ year: 2024, count: 8 }] };
      }),
    };

    const service = createAdminBootstrapService({ db });
    const statuses = await service.getRecommendationStatuses(
      [2024, 2025],
      'user-1'
    );

    const y2024 = statuses.get(2024);
    assert.strictEqual(y2024.locked, true);
    assert.strictEqual(y2024.hasAccess, true);
    assert.strictEqual(y2024.count, 8);

    const y2025 = statuses.get(2025);
    assert.strictEqual(y2025.locked, false);
    assert.strictEqual(y2025.hasAccess, true);
    assert.strictEqual(y2025.count, 0);
  });
});
