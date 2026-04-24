/**
 * Factory compatibility tests.
 *
 * Every service factory must accept the canonical `deps.db` (a datastore
 * with .raw / .withClient / .withTransaction) and throw a helpful error
 * when it's missing. The legacy `deps.pool` has been retired — factories
 * reject it and callers pass `db`.
 */

const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const { createMockLogger } = require('./helpers');

const mockCrypto = require('crypto');

/** Build a mock datastore with a vendor-free .raw. */
function makeDb() {
  return {
    raw: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    withClient: mock.fn(async (cb) =>
      cb({ query: async () => ({ rows: [] }) })
    ),
    withTransaction: mock.fn(async (cb) =>
      cb({ query: async () => ({ rows: [] }) })
    ),
  };
}

const factories = [
  {
    name: 'admin-events',
    load: () => require('../services/admin-events').createAdminEventService,
    extra: () => ({ logger: createMockLogger() }),
  },
  {
    name: 'aggregate-list',
    load: () => require('../services/aggregate-list').createAggregateList,
    extra: () => ({ logger: createMockLogger() }),
  },
  {
    name: 'album-service',
    load: () => require('../services/album-service').createAlbumService,
    extra: () => ({
      logger: createMockLogger(),
      upsertAlbumRecord: () => {},
    }),
  },
  {
    name: 'catalog-cleanup',
    load: () =>
      require('../services/catalog-cleanup').createCatalogCleanupService,
    extra: () => ({ logger: createMockLogger() }),
  },
  {
    name: 'duplicate-service',
    load: () => require('../services/duplicate-service').createDuplicateService,
    extra: () => ({ logger: createMockLogger() }),
  },
  {
    name: 'external-identity-service',
    load: () =>
      require('../services/external-identity-service')
        .createExternalIdentityService,
    extra: () => ({ logger: createMockLogger() }),
  },
  {
    name: 'group-service',
    load: () => require('../services/group-service').createGroupService,
    extra: () => ({ logger: createMockLogger(), crypto: mockCrypto }),
  },
  {
    name: 'image-refetch',
    load: () => require('../services/image-refetch').createImageRefetchService,
    extra: () => ({ logger: createMockLogger() }),
  },
  {
    name: 'playcount-sync-service',
    load: () =>
      require('../services/playcount-sync-service').createPlaycountSyncService,
    extra: () => ({ logger: createMockLogger() }),
  },
  {
    name: 'recommendation-service',
    load: () =>
      require('../services/recommendation-service').createRecommendationService,
    extra: () => ({ logger: createMockLogger(), crypto: mockCrypto }),
  },
  {
    name: 'reidentify-service',
    load: () =>
      require('../services/reidentify-service').createReidentifyService,
    extra: () => ({ logger: createMockLogger() }),
  },
];

describe('factory-compat', () => {
  for (const { name, load, extra } of factories) {
    describe(name, () => {
      it('accepts deps.db (canonical datastore)', () => {
        const factory = load();
        const db = makeDb();
        const svc = factory({ db, ...extra() });
        assert.ok(svc, `${name} must build with deps.db`);
      });

      it('throws a helpful error when deps.db is missing', () => {
        const factory = load();
        assert.throws(
          () => factory({ ...extra() }),
          (err) => {
            assert.ok(
              err && err.message && /deps\.db/i.test(err.message),
              `${name} threw an unexpected error: ${err && err.message}`
            );
            return true;
          }
        );
      });
    });
  }
});
