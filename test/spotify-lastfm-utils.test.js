const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('spotify lastfm helpers', () => {
  let getTrackId;
  let buildLastfmBody;

  beforeEach(async () => {
    const module = await import('../src/js/modules/spotify-lastfm-utils.js');
    getTrackId = module.getTrackId;
    buildLastfmBody = module.buildLastfmBody;
  });

  it('prefers spotify track id when present', () => {
    const trackId = getTrackId({
      id: 'spotify-id-1',
      name: 'Song A',
      artists: [{ name: 'Artist A' }],
    });

    assert.strictEqual(trackId, 'spotify-id-1');
  });

  it('falls back to name-artist identity when id is missing', () => {
    const trackId = getTrackId({
      name: 'Song B',
      artists: [{ name: 'Artist B' }],
    });

    assert.strictEqual(trackId, 'Song B-Artist B');
  });

  it('builds normalized lastfm payload body', () => {
    const body = buildLastfmBody({
      name: 'Track X',
      artists: [{ name: 'Artist X' }],
      album: { name: 'Album X' },
      duration_ms: 198765,
    });

    assert.deepStrictEqual(body, {
      artist: 'Artist X',
      track: 'Track X',
      album: 'Album X',
      duration: 198,
    });
  });
});
