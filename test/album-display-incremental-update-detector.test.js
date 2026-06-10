const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function makeAlbum(i, overrides = {}) {
  return {
    _id: `id-${i}`,
    artist: `Artist ${i}`,
    album: `Album ${i}`,
    release_date: '2024-01-01',
    country: 'Norway',
    genre_1: 'Black Metal',
    genre_2: '',
    comments: '',
    comments_2: '',
    primary_track: '3',
    secondary_track: '7',
    ...overrides,
  };
}

describe('album-display incremental update detector', () => {
  let detectUpdateType;
  let albumMutableFingerprint;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/album-display/incremental-update-detector.js');
    detectUpdateType = module.detectUpdateType;
    const shared = await import('../src/js/modules/album-display-shared.js');
    albumMutableFingerprint = shared.albumMutableFingerprint;
  });

  it('returns FULL_REBUILD when incremental updates are disabled', () => {
    const result = detectUpdateType([], [], { incrementalEnabled: false });
    assert.strictEqual(result, 'FULL_REBUILD');
  });

  it('detects a single add operation', () => {
    const oldFingerprints = ['id-1|Artist A|Album A|2020-01-01||||||'];
    const newAlbums = [
      {
        _id: 'id-1',
        artist: 'Artist A',
        album: 'Album A',
        release_date: '2020-01-01',
      },
      {
        _id: 'id-2',
        artist: 'Artist B',
        album: 'Album B',
        release_date: '2021-01-01',
      },
    ];

    const result = detectUpdateType(oldFingerprints, newAlbums);

    assert.deepStrictEqual(result, {
      type: 'SINGLE_ADD',
      album: newAlbums[1],
      index: 1,
    });
  });

  it('detects a single remove operation', () => {
    const oldFingerprints = [
      'id-1|Artist A|Album A|2020-01-01||||||',
      'id-2|Artist B|Album B|2021-01-01||||||',
    ];
    const newAlbums = [
      {
        _id: 'id-2',
        artist: 'Artist B',
        album: 'Album B',
        release_date: '2021-01-01',
      },
    ];

    const result = detectUpdateType(oldFingerprints, newAlbums);

    assert.deepStrictEqual(result, { type: 'SINGLE_REMOVE', index: 0 });
  });

  it('detects position-only updates', () => {
    const oldFingerprints = [
      'id-1|Artist A|Album A|2020-01-01||||||',
      'id-2|Artist B|Album B|2021-01-01||||||',
    ];
    const newAlbums = [
      {
        _id: 'id-2',
        artist: 'Artist B',
        album: 'Album B',
        release_date: '2021-01-01',
      },
      {
        _id: 'id-1',
        artist: 'Artist A',
        album: 'Album A',
        release_date: '2020-01-01',
      },
    ];

    const result = detectUpdateType(oldFingerprints, newAlbums);

    assert.strictEqual(result, 'POSITION_UPDATE');
  });

  // Regression tests: the stored fingerprints and the comparison both use
  // albumMutableFingerprint, so a single-field edit on a large list must
  // classify as an incremental update, never FULL_REBUILD.
  it('returns FIELD_UPDATE for a one-field change on a 50-album list', () => {
    const oldAlbums = Array.from({ length: 50 }, (_, i) => makeAlbum(i));
    const oldFingerprints = oldAlbums.map(albumMutableFingerprint);
    const newAlbums = oldAlbums.map((album, i) =>
      i === 25 ? { ...album, genre_1: 'Doom Metal' } : album
    );

    const result = detectUpdateType(oldFingerprints, newAlbums);

    assert.strictEqual(result, 'FIELD_UPDATE');
  });

  it('returns SINGLE_ADD for one album appended to a 50-album list', () => {
    const oldAlbums = Array.from({ length: 50 }, (_, i) => makeAlbum(i));
    const oldFingerprints = oldAlbums.map(albumMutableFingerprint);
    const newAlbums = [...oldAlbums, makeAlbum(50)];

    const result = detectUpdateType(oldFingerprints, newAlbums);

    assert.deepStrictEqual(result, {
      type: 'SINGLE_ADD',
      album: newAlbums[50],
      index: 50,
    });
  });

  it('reports zero changes for identical 50-album data', () => {
    // Identical data lands in HYBRID_UPDATE (0 changes); the true
    // short-circuit on fingerprint equality happens in displayAlbums
    // before detectUpdateType runs.
    const oldAlbums = Array.from({ length: 50 }, (_, i) => makeAlbum(i));
    const oldFingerprints = oldAlbums.map(albumMutableFingerprint);
    const newAlbums = oldAlbums.map((album) => ({ ...album }));

    const result = detectUpdateType(oldFingerprints, newAlbums);

    assert.strictEqual(result, 'HYBRID_UPDATE');
  });
});
