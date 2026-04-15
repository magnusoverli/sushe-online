const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('album-display incremental update detector', () => {
  let detectUpdateType;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/album-display/incremental-update-detector.js');
    detectUpdateType = module.detectUpdateType;
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
});
