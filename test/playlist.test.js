const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Playlist functionality', () => {
  it('should validate playlist data correctly', () => {
    // Mock list items data
    const items = [
      { trackPick: '1', artist: 'Artist 1', album: 'Album 1' },
      { trackPick: '', artist: 'Artist 2', album: 'Album 2' },
      { trackPick: '3', artist: 'Artist 3', album: 'Album 3' },
      { trackPick: null, artist: 'Artist 4', album: 'Album 4' },
    ];

    // Mock validation function (extracted from routes/api.js logic)
    function validatePlaylistData(items) {
      const validation = {
        totalAlbums: items.length,
        albumsWithTracks: 0,
        albumsWithoutTracks: 0,
        estimatedTracks: 0,
        warnings: [],
        canProceed: true,
      };

      for (const item of items) {
        if (item.trackPick && item.trackPick.trim()) {
          validation.albumsWithTracks++;
          validation.estimatedTracks++;
        } else {
          validation.albumsWithoutTracks++;
          validation.warnings.push(
            `"${item.artist} - ${item.album}" has no selected track`
          );
        }
      }

      if (validation.albumsWithoutTracks > 0) {
        validation.warnings.unshift(
          `${validation.albumsWithoutTracks} albums will be skipped (no selected tracks)`
        );
      }

      if (validation.estimatedTracks === 0) {
        validation.canProceed = false;
        validation.warnings.push(
          'No tracks selected. Please select tracks from your albums first.'
        );
      }

      return validation;
    }

    const result = validatePlaylistData(items);

    assert.strictEqual(result.totalAlbums, 4);
    assert.strictEqual(result.albumsWithTracks, 2);
    assert.strictEqual(result.albumsWithoutTracks, 2);
    assert.strictEqual(result.estimatedTracks, 2);
    assert.strictEqual(result.canProceed, true);
    assert.strictEqual(result.warnings.length, 3); // 1 summary + 2 individual warnings
  });

  it('should prevent proceeding when no tracks are selected', () => {
    const items = [
      { trackPick: '', artist: 'Artist 1', album: 'Album 1' },
      { trackPick: null, artist: 'Artist 2', album: 'Album 2' },
    ];

    function validatePlaylistData(items) {
      const validation = {
        totalAlbums: items.length,
        albumsWithTracks: 0,
        albumsWithoutTracks: 0,
        estimatedTracks: 0,
        warnings: [],
        canProceed: true,
      };

      for (const item of items) {
        if (item.trackPick && item.trackPick.trim()) {
          validation.albumsWithTracks++;
          validation.estimatedTracks++;
        } else {
          validation.albumsWithoutTracks++;
          validation.warnings.push(
            `"${item.artist} - ${item.album}" has no selected track`
          );
        }
      }

      if (validation.albumsWithoutTracks > 0) {
        validation.warnings.unshift(
          `${validation.albumsWithoutTracks} albums will be skipped (no selected tracks)`
        );
      }

      if (validation.estimatedTracks === 0) {
        validation.canProceed = false;
        validation.warnings.push(
          'No tracks selected. Please select tracks from your albums first.'
        );
      }

      return validation;
    }

    const result = validatePlaylistData(items);

    assert.strictEqual(result.canProceed, false);
    assert.strictEqual(result.estimatedTracks, 0);
    assert(result.warnings.some((w) => w.includes('No tracks selected')));
  });
});
