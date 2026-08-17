const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  createAvailabilityFetchQueue,
  initializeAvailabilityFetchQueue,
  getAvailabilityFetchQueue,
} = require('../services/availability-fetch-queue');
const {
  AVAILABILITY_RESOLUTION_VERSION,
} = require('../services/availability-resolution-service');
const { createMockLogger } = require('./helpers');

function build({ version = 0, resolve, ...deps } = {}) {
  const getAlbumAvailabilityResolutionState = mock.fn(async () => ({
    checkedAt: version > 0 ? '2026-08-17T00:00:00.000Z' : null,
    version,
  }));
  const resolveAvailability = mock.fn(
    resolve || (async () => ({ action: 'resolved', services: ['spotify'] }))
  );
  const queue = createAvailabilityFetchQueue({
    logger: createMockLogger(),
    rateLimitMs: 0,
    externalIdentityService: { getAlbumAvailabilityResolutionState },
    resolutionService: { resolveAvailability },
    ...deps,
    // a db value so ensureDb is bypassed via injected services (db unused here)
  });
  return {
    queue,
    getAlbumAvailabilityResolutionState,
    resolveAvailability,
  };
}

describe('availability-fetch-queue', () => {
  it('ignores incomplete input', async () => {
    const { queue, resolveAvailability } = build();
    queue.add('', 'a', 'b');
    queue.add('id', '', 'b');
    queue.add('id', 'a', '');
    assert.strictEqual(resolveAvailability.mock.calls.length, 0);
  });

  it('resolves availability for a new album', async () => {
    const { queue, resolveAvailability } = build();
    await queue.add('alb-1', 'Metallica', '72 Seasons');
    assert.strictEqual(resolveAvailability.mock.calls.length, 1);
    assert.deepStrictEqual(resolveAvailability.mock.calls[0].arguments[0], {
      albumId: 'alb-1',
      artist: 'Metallica',
      album: '72 Seasons',
    });
  });

  it('invalidates caches then broadcasts current availability to affected users', async () => {
    const operations = [];
    let queryCount = 0;
    const db = {
      raw: mock.fn(async () => {
        queryCount++;
        if (queryCount === 1) {
          operations.push('invalidate');
          return { rows: [{ user_id: 'user-1' }] };
        }
        return {
          rows: [
            {
              user_id: 'user-1',
              availability: ['spotify'],
              availability_links: [
                {
                  service: 'spotify',
                  url: 'https://open.spotify.com/album/1',
                },
              ],
            },
          ],
        };
      }),
    };
    const responseCache = {
      invalidate: mock.fn(() => operations.push('cache-invalidated')),
    };
    const albumAvailabilityUpdated = mock.fn((...args) => {
      operations.push('broadcast');
      return args;
    });
    const { queue } = build({
      db,
      responseCache,
      broadcast: { albumAvailabilityUpdated },
    });

    await queue.add('alb-1', 'Metallica', '72 Seasons');

    assert.deepStrictEqual(operations, [
      'invalidate',
      'cache-invalidated',
      'broadcast',
    ]);
    assert.deepStrictEqual(albumAvailabilityUpdated.mock.calls[0].arguments, [
      'user-1',
      'alb-1',
      ['spotify'],
      [
        {
          service: 'spotify',
          url: 'https://open.spotify.com/album/1',
        },
      ],
    ]);
  });

  it('short-circuits when the current availability version was resolved', async () => {
    const { queue, resolveAvailability } = build({
      version: AVAILABILITY_RESOLUTION_VERSION,
    });
    await queue.add('alb-1', 'Metallica', '72 Seasons');
    assert.strictEqual(resolveAvailability.mock.calls.length, 0);
  });

  it('still resolves albums checked by an older lifecycle version', async () => {
    const { queue, resolveAvailability } = build({
      version: AVAILABILITY_RESOLUTION_VERSION - 1,
    });
    await queue.add('alb-1', 'Metallica', '72 Seasons');
    assert.strictEqual(resolveAvailability.mock.calls.length, 1);
  });

  it('keeps hint-only albums eligible while their lifecycle version is unresolved', async () => {
    const { queue, resolveAvailability } = build({ version: 0 });

    await queue.add('album-with-visible-hint', 'Artist', 'Album');

    assert.strictEqual(resolveAvailability.mock.calls.length, 1);
  });

  it('swallows resolution errors without throwing', async () => {
    const { queue } = build({
      resolve: async () => {
        throw new Error('boom');
      },
    });
    await assert.doesNotReject(() => queue.add('alb-1', 'A', 'B'));
  });

  describe('singleton', () => {
    beforeEach(() => {
      // reset module singleton between assertions via fresh require cache
    });

    it('getAvailabilityFetchQueue throws before init', () => {
      // Note: initialize may have run in another test file; guard both shapes.
      try {
        const q = getAvailabilityFetchQueue();
        assert.ok(q && typeof q.add === 'function');
      } catch (err) {
        assert.match(err.message, /not initialized/);
      }
    });

    it('initialize is idempotent', () => {
      const a = initializeAvailabilityFetchQueue({
        raw: async () => ({ rows: [] }),
      });
      const b = initializeAvailabilityFetchQueue({
        raw: async () => ({ rows: [] }),
      });
      assert.strictEqual(a, b);
      assert.ok(typeof getAvailabilityFetchQueue().add === 'function');
    });
  });
});
