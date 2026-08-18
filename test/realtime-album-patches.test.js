const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('realtime-album-patches', () => {
  it('rejects stale versions per field', async () => {
    const { createRealtimeAlbumPatches } =
      await import('../src/js/modules/realtime-album-patches.js');
    const patches = createRealtimeAlbumPatches();

    assert.deepStrictEqual(
      patches.remember('album-1', { country: 'Norway' }, '10'),
      { country: 'Norway' }
    );
    assert.deepStrictEqual(
      patches.remember('album-1', { country: 'Sweden' }, '9'),
      {}
    );
    assert.deepStrictEqual(
      patches.remember('album-1', { tracks: ['Opening'] }, '9'),
      { tracks: ['Opening'] }
    );
  });

  it('applies only patches that arrived after a refresh began', async () => {
    const { createRealtimeAlbumPatches } =
      await import('../src/js/modules/realtime-album-patches.js');
    const patches = createRealtimeAlbumPatches();
    patches.remember('album-1', { country: 'Norway' }, '1');
    const refreshGeneration = patches.generation;
    patches.remember('album-1', { tracks: ['Opening'] }, '2');
    const albums = [{ album_id: 'album-1', country: 'Sweden', tracks: null }];

    patches.applyAfter(albums, refreshGeneration);

    assert.deepStrictEqual(albums, [
      { album_id: 'album-1', country: 'Sweden', tracks: ['Opening'] },
    ]);
  });
});
