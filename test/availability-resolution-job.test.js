const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  createAvailabilityResolutionJob,
} = require('../services/availability-resolution-job');
const { createMockLogger } = require('./helpers');

// Mock db whose raw() routes by the SQL text it receives.
function createDb({ candidates = [], stats = { total: 0, resolved: 0 } }) {
  return {
    raw: async (sql) => {
      if (/COUNT\(DISTINCT/i.test(sql)) {
        return { rows: [stats] };
      }
      if (/SELECT a\.album_id/i.test(sql)) {
        return { rows: candidates };
      }
      return { rows: [] };
    },
  };
}

const ALBUMS = [
  { album_id: 'a1', artist: 'A', album: 'One' },
  { album_id: 'a2', artist: 'B', album: 'Two' },
  { album_id: 'a3', artist: 'C', album: 'Three' },
];

describe('availability-resolution-job', () => {
  it('reports catalog coverage stats', async () => {
    const job = createAvailabilityResolutionJob({
      db: createDb({ stats: { total: '10', resolved: '4' } }),
      logger: createMockLogger(),
      resolution: { resolveAvailability: async () => ({ action: 'skip' }) },
      rateLimitMs: 0,
    });
    assert.deepStrictEqual(await job.getStats(), {
      totalAlbums: 10,
      resolved: 4,
      unresolved: 6,
    });
  });

  it('resolves every candidate and tallies the summary', async () => {
    const resolveAvailability = mock.fn(async ({ albumId }) =>
      albumId === 'a2'
        ? { action: 'skip', reason: 'no-seed' }
        : { action: 'resolved', services: ['spotify'] }
    );
    const job = createAvailabilityResolutionJob({
      db: createDb({ candidates: ALBUMS }),
      logger: createMockLogger(),
      resolution: { resolveAvailability },
      rateLimitMs: 0,
    });

    const summary = await job.resolveAll();

    assert.strictEqual(resolveAvailability.mock.calls.length, 3);
    assert.strictEqual(summary.total, 3);
    assert.strictEqual(summary.resolved, 2);
    assert.strictEqual(summary.skipped, 1);
    assert.strictEqual(summary.failed, 0);
    assert.strictEqual(summary.stoppedEarly, false);
    assert.strictEqual(job.isJobRunning(), false);
    assert.strictEqual(job.getProgress(), null);
  });

  it('keeps the last completed summary for polling clients', async () => {
    const job = createAvailabilityResolutionJob({
      db: createDb({ candidates: ALBUMS.slice(0, 1) }),
      logger: createMockLogger(),
      resolution: {
        resolveAvailability: async () => ({
          action: 'resolved',
          services: ['spotify'],
        }),
      },
      rateLimitMs: 0,
    });

    assert.strictEqual(job.getLastSummary(), null);

    const summary = await job.resolveAll();
    const lastSummary = job.getLastSummary();

    assert.deepStrictEqual(lastSummary, summary);
    lastSummary.resolved = 99;
    assert.strictEqual(job.getLastSummary().resolved, 1);
  });

  it('counts a throwing resolution as a failure without aborting the run', async () => {
    const job = createAvailabilityResolutionJob({
      db: createDb({ candidates: ALBUMS }),
      logger: createMockLogger(),
      resolution: {
        resolveAvailability: async ({ albumId }) => {
          if (albumId === 'a2') throw new Error('boom');
          return { action: 'resolved', services: ['spotify'] };
        },
      },
      rateLimitMs: 0,
    });

    const summary = await job.resolveAll();
    assert.strictEqual(summary.resolved, 2);
    assert.strictEqual(summary.failed, 1);
  });

  it('refuses to start a second concurrent run', async () => {
    const job = createAvailabilityResolutionJob({
      db: createDb({ candidates: ALBUMS }),
      logger: createMockLogger(),
      resolution: {
        resolveAvailability: async () => ({ action: 'resolved', services: [] }),
      },
      rateLimitMs: 0,
    });
    const first = job.resolveAll();
    await assert.rejects(() => job.resolveAll(), /already running/);
    await first;
  });
});
