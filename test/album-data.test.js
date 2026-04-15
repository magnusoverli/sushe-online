const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('album-data module', () => {
  let createAlbumDataProcessor;
  let formatPlaycount;
  let formatPlaycountDisplay;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/album-display/album-data.js');
    createAlbumDataProcessor = module.createAlbumDataProcessor;
    formatPlaycount = module.formatPlaycount;
    formatPlaycountDisplay = module.formatPlaycountDisplay;
  });

  describe('formatPlaycount', () => {
    it('formats nullish and small values', () => {
      assert.strictEqual(formatPlaycount(null), '');
      assert.strictEqual(formatPlaycount(undefined), '');
      assert.strictEqual(formatPlaycount(0), '0');
      assert.strictEqual(formatPlaycount(999), '999');
    });

    it('formats thousands and millions with one decimal', () => {
      assert.strictEqual(formatPlaycount(1250), '1.3K');
      assert.strictEqual(formatPlaycount(1200000), '1.2M');
    });
  });

  describe('formatPlaycountDisplay', () => {
    it('returns empty state when status is missing or error', () => {
      assert.deepStrictEqual(formatPlaycountDisplay(10, null), {
        html: '',
        isNotFound: false,
        isEmpty: true,
      });

      assert.deepStrictEqual(formatPlaycountDisplay(10, 'error'), {
        html: '',
        isNotFound: false,
        isEmpty: true,
      });
    });

    it('returns not-found and success states', () => {
      assert.deepStrictEqual(formatPlaycountDisplay(10, 'not_found'), {
        html: '',
        isNotFound: true,
        isEmpty: false,
      });

      assert.deepStrictEqual(formatPlaycountDisplay(1250, 'success'), {
        html: '1.3K',
        isNotFound: false,
        isEmpty: false,
      });
    });
  });

  describe('processAlbumData', () => {
    it('builds display data, formats tracks, and applies list metadata', () => {
      const { processAlbumData } = createAlbumDataProcessor({
        getCurrentList: () => 'list-1',
        getListMetadata: () => ({ year: 2024, isMain: true }),
        getTrackName: (track) => track.name,
        getTrackLength: (track) => track.length,
        formatTrackTime: (len) => (len ? '4:32' : ''),
        getPlaycountCacheEntry: () => ({ playcount: 1250, status: 'success' }),
      });

      const data = processAlbumData(
        {
          _id: 'item-1',
          album_id: 'album-1',
          album: 'Blackwater Park',
          artist: 'Opeth',
          release_date: '2001-03-12',
          country: 'SE',
          genre_1: 'Progressive Metal',
          genre_2: 'Genre 2',
          comments: 'Comment',
          comments_2: 'Comment 2',
          primary_track: '1. The Leper Affinity',
          secondary_track: '7',
          tracks: [
            { name: '1. The Leper Affinity', length: 272 },
            { name: '2. Bleak', length: 548 },
          ],
        },
        2
      );

      assert.strictEqual(data.position, 3);
      assert.strictEqual(data.albumId, 'album-1');
      assert.strictEqual(data.genre2, '');
      assert.strictEqual(data.comment, '');
      assert.strictEqual(data.comment2, '');
      assert.strictEqual(data.primaryTrackDisplay, '1. The Leper Affinity');
      assert.strictEqual(data.primaryTrackDuration, '4:32');
      assert.strictEqual(data.secondaryTrackDisplay, 'Track 7');
      assert.strictEqual(data.playcountDisplay.html, '1.3K');
      assert.strictEqual(data.yearMismatch, true);
      assert.match(data.yearMismatchTooltip, /doesn't match list year/);
    });

    it('handles missing values and non-main lists with safe defaults', () => {
      const { processAlbumData } = createAlbumDataProcessor({
        getCurrentList: () => 'list-2',
        getListMetadata: () => ({ year: null, isMain: false }),
        getTrackName: (track) => track.name,
        getTrackLength: () => null,
        formatTrackTime: () => '',
        getPlaycountCacheEntry: () => ({ playcount: null, status: 'error' }),
      });

      const data = processAlbumData({ album: 'Still Life' }, 0);

      assert.strictEqual(data.position, null);
      assert.strictEqual(data.artist, 'Unknown Artist');
      assert.strictEqual(data.countryDisplay, 'Country');
      assert.strictEqual(data.genre1Display, 'Genre 1');
      assert.strictEqual(data.primaryTrackDisplay, '');
      assert.strictEqual(data.playcountDisplay.isEmpty, true);
      assert.strictEqual(data.yearMismatch, false);
      assert.strictEqual(data.yearMismatchTooltip, '');
    });
  });
});
