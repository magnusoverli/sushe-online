const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

let playRecommendationAlbum;

describe('recommendations playback', async () => {
  const mod = await import('../src/js/modules/recommendations.js');
  playRecommendationAlbum = mod.playRecommendationAlbum;

  it('plays recommendation by artist and album metadata', () => {
    const rec = {
      artist: 'Burial',
      album: 'Untrue',
      album_id: 'db-id-123',
      release_date: '2007-11-05',
    };
    const mockPlayAlbumByMetadata = mock.fn();
    const mockShowToast = mock.fn();

    playRecommendationAlbum(rec, mockPlayAlbumByMetadata, mockShowToast);

    assert.strictEqual(mockPlayAlbumByMetadata.mock.calls.length, 1);
    assert.deepStrictEqual(mockPlayAlbumByMetadata.mock.calls[0].arguments, [
      'Burial',
      'Untrue',
      {
        albumId: 'db-id-123',
        releaseDate: '2007-11-05',
      },
    ]);
    assert.strictEqual(mockShowToast.mock.calls.length, 0);
  });

  it('shows error toast when album metadata is missing', () => {
    const mockPlayAlbumByMetadata = mock.fn();
    const mockShowToast = mock.fn();

    playRecommendationAlbum(
      { artist: 'Burial', album: '' },
      mockPlayAlbumByMetadata,
      mockShowToast
    );

    assert.strictEqual(mockPlayAlbumByMetadata.mock.calls.length, 0);
    assert.strictEqual(mockShowToast.mock.calls.length, 1);
    assert.strictEqual(
      mockShowToast.mock.calls[0].arguments[0],
      'Could not find album data'
    );
  });

  it('shows error toast when playback dependency is unavailable', () => {
    const mockShowToast = mock.fn();

    playRecommendationAlbum(
      { artist: 'Burial', album: 'Untrue' },
      null,
      mockShowToast
    );

    assert.strictEqual(mockShowToast.mock.calls.length, 1);
    assert.strictEqual(
      mockShowToast.mock.calls[0].arguments[0],
      'Playback is not available right now'
    );
  });
});
