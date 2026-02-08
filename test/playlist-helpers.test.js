const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  resolveTrackPicks,
  processTrackBatches,
} = require('../services/playlist/playlist-helpers');

describe('resolveTrackPicks', () => {
  it('should resolve primaryTrack and secondaryTrack fields', () => {
    const result = resolveTrackPicks({
      primaryTrack: 'Track A',
      secondaryTrack: 'Track B',
    });
    assert.strictEqual(result.primaryTrack, 'Track A');
    assert.strictEqual(result.secondaryTrack, 'Track B');
  });

  it('should resolve primary_track and secondary_track fields', () => {
    const result = resolveTrackPicks({
      primary_track: 'Track A',
      secondary_track: 'Track B',
    });
    assert.strictEqual(result.primaryTrack, 'Track A');
    assert.strictEqual(result.secondaryTrack, 'Track B');
  });

  it('should resolve legacy trackPick field', () => {
    const result = resolveTrackPicks({ trackPick: 'Legacy Track' });
    assert.strictEqual(result.primaryTrack, 'Legacy Track');
    assert.strictEqual(result.secondaryTrack, null);
  });

  it('should resolve legacy track_pick field', () => {
    const result = resolveTrackPicks({ track_pick: 'Legacy Track' });
    assert.strictEqual(result.primaryTrack, 'Legacy Track');
    assert.strictEqual(result.secondaryTrack, null);
  });

  it('should prefer primaryTrack over legacy fields', () => {
    const result = resolveTrackPicks({
      primaryTrack: 'Primary',
      trackPick: 'Legacy',
      track_pick: 'Legacy2',
    });
    assert.strictEqual(result.primaryTrack, 'Primary');
  });

  it('should return null for both when no fields present', () => {
    const result = resolveTrackPicks({});
    assert.strictEqual(result.primaryTrack, null);
    assert.strictEqual(result.secondaryTrack, null);
  });

  it('should return null for both when item has unrelated fields', () => {
    const result = resolveTrackPicks({
      artist: 'Artist',
      album: 'Album',
    });
    assert.strictEqual(result.primaryTrack, null);
    assert.strictEqual(result.secondaryTrack, null);
  });
});

describe('processTrackBatches', () => {
  it('should process items and collect found track IDs', async () => {
    const items = [
      { artist: 'A1', album: 'Al1', primaryTrack: 'T1' },
      { artist: 'A2', album: 'Al2', primaryTrack: 'T2' },
    ];
    const findTrackFn = mock.fn(async (_item, trackId) => `uri:${trackId}`);
    const result = {
      processed: 0,
      successful: 0,
      failed: 0,
      tracks: [],
      errors: [],
    };

    const trackIds = await processTrackBatches(items, findTrackFn, result);

    assert.strictEqual(trackIds.length, 2);
    assert.strictEqual(trackIds[0], 'uri:T1');
    assert.strictEqual(trackIds[1], 'uri:T2');
    assert.strictEqual(result.processed, 2);
    assert.strictEqual(result.successful, 2);
    assert.strictEqual(result.failed, 0);
    assert.strictEqual(result.tracks.length, 2);
    assert.strictEqual(result.tracks[0].found, true);
    assert.strictEqual(result.tracks[0].isPrimary, true);
  });

  it('should handle items with no track selected', async () => {
    const items = [{ artist: 'A1', album: 'Al1' }];
    const findTrackFn = mock.fn(async () => null);
    const result = {
      processed: 0,
      successful: 0,
      failed: 0,
      tracks: [],
      errors: [],
    };

    const trackIds = await processTrackBatches(items, findTrackFn, result);

    assert.strictEqual(trackIds.length, 0);
    assert.strictEqual(result.processed, 1);
    assert.strictEqual(result.failed, 1);
    assert.ok(result.errors[0].includes('no track selected'));
    assert.strictEqual(findTrackFn.mock.calls.length, 0);
  });

  it('should handle track not found by findTrackFn', async () => {
    const items = [{ artist: 'A1', album: 'Al1', primaryTrack: 'T1' }];
    const findTrackFn = mock.fn(async () => null);
    const result = {
      processed: 0,
      successful: 0,
      failed: 0,
      tracks: [],
      errors: [],
    };

    const trackIds = await processTrackBatches(items, findTrackFn, result);

    assert.strictEqual(trackIds.length, 0);
    assert.strictEqual(result.failed, 1);
    assert.ok(result.errors[0].includes('Track not found'));
    assert.strictEqual(result.tracks[0].found, false);
  });

  it('should handle findTrackFn errors gracefully', async () => {
    const items = [{ artist: 'A1', album: 'Al1', primaryTrack: 'T1' }];
    const findTrackFn = mock.fn(async () => {
      throw new Error('API failure');
    });
    const result = {
      processed: 0,
      successful: 0,
      failed: 0,
      tracks: [],
      errors: [],
    };

    const trackIds = await processTrackBatches(items, findTrackFn, result);

    assert.strictEqual(trackIds.length, 0);
    assert.strictEqual(result.failed, 1);
    assert.ok(result.errors[0].includes('API failure'));
  });

  it('should process both primary and secondary tracks', async () => {
    const items = [
      {
        artist: 'A1',
        album: 'Al1',
        primaryTrack: 'T1',
        secondaryTrack: 'T2',
      },
    ];
    const findTrackFn = mock.fn(async (_item, trackId) => `uri:${trackId}`);
    const result = {
      processed: 0,
      successful: 0,
      failed: 0,
      tracks: [],
      errors: [],
    };

    const trackIds = await processTrackBatches(items, findTrackFn, result);

    assert.strictEqual(trackIds.length, 2);
    assert.strictEqual(trackIds[0], 'uri:T1');
    assert.strictEqual(trackIds[1], 'uri:T2');
    assert.strictEqual(result.successful, 2);
    assert.strictEqual(result.tracks.length, 2);
    assert.strictEqual(result.tracks[0].isPrimary, true);
    assert.strictEqual(result.tracks[1].isPrimary, false);
  });

  it('should respect batch size parameter', async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      artist: `A${i}`,
      album: `Al${i}`,
      primaryTrack: `T${i}`,
    }));

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const findTrackFn = mock.fn(async (_item, trackId) => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) {
        maxConcurrent = currentConcurrent;
      }
      await new Promise((r) => setTimeout(r, 10));
      currentConcurrent--;
      return `uri:${trackId}`;
    });

    const result = {
      processed: 0,
      successful: 0,
      failed: 0,
      tracks: [],
      errors: [],
    };

    await processTrackBatches(items, findTrackFn, result, 2);

    assert.strictEqual(result.successful, 5);
    // With batch size 2, max concurrent should be at most 2
    assert.ok(maxConcurrent <= 2, `maxConcurrent was ${maxConcurrent}`);
  });

  it('should skip secondary track when empty/whitespace', async () => {
    const items = [
      {
        artist: 'A1',
        album: 'Al1',
        primaryTrack: 'T1',
        secondaryTrack: '   ',
      },
    ];
    const findTrackFn = mock.fn(async (_item, trackId) => `uri:${trackId}`);
    const result = {
      processed: 0,
      successful: 0,
      failed: 0,
      tracks: [],
      errors: [],
    };

    const trackIds = await processTrackBatches(items, findTrackFn, result);

    assert.strictEqual(trackIds.length, 1);
    assert.strictEqual(result.successful, 1);
    assert.strictEqual(findTrackFn.mock.calls.length, 1);
  });

  it('should handle Promise.allSettled rejections', async () => {
    const items = [
      { artist: 'A1', album: 'Al1', primaryTrack: 'T1' },
      { artist: 'A2', album: 'Al2', primaryTrack: 'T2' },
    ];

    let callCount = 0;
    const findTrackFn = mock.fn(async (_item, trackId) => {
      callCount++;
      if (callCount === 1) return `uri:${trackId}`;
      throw new Error('Search failed');
    });

    const result = {
      processed: 0,
      successful: 0,
      failed: 0,
      tracks: [],
      errors: [],
    };

    const trackIds = await processTrackBatches(items, findTrackFn, result);

    assert.strictEqual(trackIds.length, 1);
    assert.strictEqual(result.successful, 1);
    assert.strictEqual(result.failed, 1);
  });
});
