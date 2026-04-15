const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('mobile-ui album identity helpers', () => {
  let buildAlbumIdentity;
  let createAlbumIdentityFinder;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/mobile-ui/album-identity.js');
    buildAlbumIdentity = module.buildAlbumIdentity;
    createAlbumIdentityFinder = module.createAlbumIdentityFinder;
  });

  it('builds lowercase identity string', () => {
    const identity = buildAlbumIdentity({
      artist: 'Artist Name',
      album: 'Album Name',
      release_date: '2024-01-01',
    });

    assert.strictEqual(identity, 'artist name::album name::2024-01-01');
  });

  it('finds album by identity in current list', () => {
    const albums = [
      { artist: 'A', album: 'One', release_date: '2021-01-01' },
      { artist: 'B', album: 'Two', release_date: '2022-01-01' },
    ];

    const findAlbumByIdentity = createAlbumIdentityFinder({
      getCurrentList: () => 'list-1',
      getListData: () => albums,
    });

    const result = findAlbumByIdentity('b::two::2022-01-01');

    assert.strictEqual(result.index, 1);
    assert.deepStrictEqual(result.album, albums[1]);
  });

  it('returns null when album is missing', () => {
    const findAlbumByIdentity = createAlbumIdentityFinder({
      getCurrentList: () => 'list-1',
      getListData: () => [{ artist: 'A', album: 'One', release_date: '' }],
    });

    const result = findAlbumByIdentity('missing::album::');
    assert.strictEqual(result, null);
  });
});
