const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  SUSHE_USER_AGENT,
  selectBestRelease,
  extractTracksFromMedia,
} = require('../utils/musicbrainz-helpers');

describe('musicbrainz-helpers', () => {
  describe('SUSHE_USER_AGENT', () => {
    it('should be a non-empty string', () => {
      assert.strictEqual(typeof SUSHE_USER_AGENT, 'string');
      assert.ok(SUSHE_USER_AGENT.length > 0);
    });
  });

  describe('selectBestRelease', () => {
    it('should return null for empty array', () => {
      assert.strictEqual(selectBestRelease([]), null);
    });

    it('should return null when all releases are non-Official', () => {
      const result = selectBestRelease([
        { status: 'Bootleg', country: 'US', media: [] },
      ]);
      assert.strictEqual(result, null);
    });

    it('should select the highest scored release', () => {
      const releases = [
        {
          id: 'us',
          status: 'Official',
          country: 'US',
          media: [],
          date: '2020-01-01',
        },
        {
          id: 'de',
          status: 'Official',
          country: 'DE',
          media: [{ format: 'Digital Media' }],
          date: '2020-01-01',
        },
      ];
      const best = selectBestRelease(releases);
      assert.strictEqual(best.id, 'de');
    });
  });

  describe('extractTracksFromMedia', () => {
    it('should return empty array for empty media', () => {
      assert.deepStrictEqual(extractTracksFromMedia([]), []);
    });

    it('should extract tracks with name and length', () => {
      const media = [
        {
          tracks: [
            { title: 'Track 1', length: 180000 },
            { title: 'Track 2', length: 240000 },
          ],
        },
      ];
      const tracks = extractTracksFromMedia(media);
      assert.strictEqual(tracks.length, 2);
      assert.strictEqual(tracks[0].name, 'Track 1');
      assert.strictEqual(tracks[0].length, 180000);
    });

    it('should fall back to recording title', () => {
      const media = [
        {
          tracks: [{ recording: { title: 'Recording Title', length: 300000 } }],
        },
      ];
      const tracks = extractTracksFromMedia(media);
      assert.strictEqual(tracks[0].name, 'Recording Title');
      assert.strictEqual(tracks[0].length, 300000);
    });

    it('should handle media without tracks array', () => {
      const media = [{ format: 'Digital Media' }];
      const tracks = extractTracksFromMedia(media);
      assert.deepStrictEqual(tracks, []);
    });

    it('should handle multi-disc releases', () => {
      const media = [
        { tracks: [{ title: 'Disc 1 Track', length: 100000 }] },
        { tracks: [{ title: 'Disc 2 Track', length: 200000 }] },
      ];
      const tracks = extractTracksFromMedia(media);
      assert.strictEqual(tracks.length, 2);
    });
  });
});
