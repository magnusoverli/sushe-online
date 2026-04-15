const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('track-pick-service module', () => {
  let createTrackPickService;

  beforeEach(async () => {
    const module = await import('../src/js/modules/track-pick-service.js');
    createTrackPickService = module.createTrackPickService;
  });

  it('builds DELETE request when clicking the current primary track', () => {
    const service = createTrackPickService({ apiCall: async () => ({}) });

    const request = service.buildTrackPickRequest('Track A', {
      primaryTrack: 'Track A',
      secondaryTrack: 'Track B',
    });

    assert.deepStrictEqual(request, {
      method: 'DELETE',
      body: JSON.stringify({ trackIdentifier: 'Track A' }),
    });
  });

  it('builds promote request when clicking the current secondary track', () => {
    const service = createTrackPickService({ apiCall: async () => ({}) });

    const request = service.buildTrackPickRequest('Track B', {
      primaryTrack: 'Track A',
      secondaryTrack: 'Track B',
    });

    assert.deepStrictEqual(request, {
      method: 'POST',
      body: JSON.stringify({ trackIdentifier: 'Track B', priority: 1 }),
    });
  });

  it('builds add-secondary request for a newly selected track', () => {
    const service = createTrackPickService({ apiCall: async () => ({}) });

    const request = service.buildTrackPickRequest('Track C', {
      primaryTrack: 'Track A',
      secondaryTrack: 'Track B',
    });

    assert.deepStrictEqual(request, {
      method: 'POST',
      body: JSON.stringify({ trackIdentifier: 'Track C', priority: 2 }),
    });
  });

  it('persists track picks via API and normalizes response fields', async () => {
    const calls = [];
    const service = createTrackPickService({
      apiCall: async (url, options) => {
        calls.push([url, options]);
        return {
          primary_track: 'Track B',
          secondary_track: 'Track A',
        };
      },
    });

    const result = await service.updateTrackPick('item-1', 'Track B', {
      primaryTrack: 'Track A',
      secondaryTrack: 'Track B',
    });

    assert.deepStrictEqual(calls, [
      [
        '/api/track-picks/item-1',
        {
          method: 'POST',
          body: JSON.stringify({ trackIdentifier: 'Track B', priority: 1 }),
        },
      ],
    ]);
    assert.deepStrictEqual(result, {
      primaryTrack: 'Track B',
      secondaryTrack: 'Track A',
    });
  });

  it('clears track picks via API and returns normalized empty picks', async () => {
    const calls = [];
    const service = createTrackPickService({
      apiCall: async (url, options) => {
        calls.push([url, options]);
        return null;
      },
    });

    const result = await service.clearTrackPicks('item-2');

    assert.deepStrictEqual(calls, [
      ['/api/track-picks/item-2', { method: 'DELETE' }],
    ]);
    assert.deepStrictEqual(result, {
      primaryTrack: '',
      secondaryTrack: '',
    });
  });
});
