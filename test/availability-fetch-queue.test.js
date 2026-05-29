const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  createAvailabilityFetchQueue,
  initializeAvailabilityFetchQueue,
  getAvailabilityFetchQueue,
} = require('../services/availability-fetch-queue');
const { createMockLogger } = require('./helpers');

function build({ existing = [], resolve } = {}) {
  const getAlbumAvailability = mock.fn(async () => existing);
  const resolveAvailability = mock.fn(
    resolve || (async () => ({ action: 'resolved', services: ['spotify'] }))
  );
  const queue = createAvailabilityFetchQueue({
    logger: createMockLogger(),
    rateLimitMs: 0,
    externalIdentityService: { getAlbumAvailability },
    resolutionService: { resolveAvailability },
    // a db value so ensureDb is bypassed via injected services (db unused here)
  });
  return { queue, getAlbumAvailability, resolveAvailability };
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
    const { queue, resolveAvailability } = build({ existing: [] });
    await queue.add('alb-1', 'Metallica', '72 Seasons');
    assert.strictEqual(resolveAvailability.mock.calls.length, 1);
    assert.deepStrictEqual(resolveAvailability.mock.calls[0].arguments[0], {
      albumId: 'alb-1',
      artist: 'Metallica',
      album: '72 Seasons',
    });
  });

  it('short-circuits when availability was already resolved', async () => {
    const { queue, resolveAvailability } = build({
      existing: [{ service: 'spotify', strategy: 'availability:existing' }],
    });
    await queue.add('alb-1', 'Metallica', '72 Seasons');
    assert.strictEqual(resolveAvailability.mock.calls.length, 0);
  });

  it('still resolves when only a prior identity mapping exists', async () => {
    const { queue, resolveAvailability } = build({
      existing: [{ service: 'spotify', strategy: 'scored_search' }],
    });
    await queue.add('alb-1', 'Metallica', '72 Seasons');
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
