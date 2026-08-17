const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  createAvailabilityResolutionJob,
} = require('../services/availability-resolution-job');
const { createMockLogger } = require('./helpers');

// Mock db whose raw() routes by the SQL text it receives.
function createDb({ candidates = [], stats = { total: 0, resolved: 0 } }) {
  const raw = mock.fn(async (sql) => {
    if (/AS resolved/i.test(sql)) {
      return { rows: [stats] };
    }
    if (/SELECT a\.album_id/i.test(sql)) {
      return { rows: candidates };
    }
    return { rows: [] };
  });
  return {
    raw,
  };
}

const ALBUMS = [
  { album_id: 'a1', artist: 'A', album: 'One' },
  { album_id: 'a2', artist: 'B', album: 'Two' },
  { album_id: 'a3', artist: 'C', album: 'Three' },
];

describe('availability-resolution-job', () => {
  it('reports catalog coverage stats', async () => {
    const db = createDb({ stats: { total: '10', resolved: '4' } });
    const job = createAvailabilityResolutionJob({
      db,
      logger: createMockLogger(),
      resolution: { resolveAvailability: async () => ({ action: 'skip' }) },
      rateLimitMs: 0,
    });
    assert.deepStrictEqual(await job.getStats(), {
      totalAlbums: 10,
      resolved: 4,
      unresolved: 6,
    });
    assert.match(
      db.raw.mock.calls[0].arguments[0],
      /availability_resolution_version >= \$1/
    );
    assert.deepStrictEqual(db.raw.mock.calls[0].arguments[1], [2]);
  });

  it('selects unresolved candidates by lifecycle version, not mappings', async () => {
    const db = createDb({ candidates: ALBUMS.slice(0, 1) });
    const job = createAvailabilityResolutionJob({
      db,
      logger: createMockLogger(),
      resolution: {
        resolveAvailability: async () => ({
          action: 'skip',
          reason: 'no-seed',
        }),
      },
      rateLimitMs: 0,
    });

    await job.resolveAll();

    const candidateCall = db.raw.mock.calls.find((call) =>
      call.arguments[0].includes('SELECT a.album_id')
    );
    assert.match(
      candidateCall.arguments[0],
      /a\.availability_resolution_version < \$1/
    );
    assert.doesNotMatch(candidateCall.arguments[0], /album_service_mappings/);
    assert.deepStrictEqual(candidateCall.arguments[1], [2]);
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
