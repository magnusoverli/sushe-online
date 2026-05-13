// test/musicbrainz.test.js
const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { createMusicBrainz, COUNTRY_CODE_MAP } = require('../utils/musicbrainz');

describe('musicbrainz', () => {
  describe('COUNTRY_CODE_MAP', () => {
    it('should contain major music markets', () => {
      assert.strictEqual(COUNTRY_CODE_MAP.US, 'United States');
      assert.strictEqual(COUNTRY_CODE_MAP.GB, 'United Kingdom');
      assert.strictEqual(COUNTRY_CODE_MAP.CA, 'Canada');
      assert.strictEqual(COUNTRY_CODE_MAP.AU, 'Australia');
    });

    it('should contain Nordic countries', () => {
      assert.strictEqual(COUNTRY_CODE_MAP.SE, 'Sweden');
      assert.strictEqual(COUNTRY_CODE_MAP.NO, 'Norway');
      assert.strictEqual(COUNTRY_CODE_MAP.FI, 'Finland');
      assert.strictEqual(COUNTRY_CODE_MAP.DK, 'Denmark');
      assert.strictEqual(COUNTRY_CODE_MAP.IS, 'Iceland');
    });

    it('should contain special MusicBrainz codes', () => {
      assert.strictEqual(COUNTRY_CODE_MAP.XW, 'Worldwide');
      assert.strictEqual(COUNTRY_CODE_MAP.XE, 'Europe');
      assert.strictEqual(COUNTRY_CODE_MAP.XU, 'Unknown');
    });
  });

  describe('resolveCountryCode', () => {
    it('should resolve valid 2-letter codes', () => {
      const mockLogger = { info: mock.fn(), warn: mock.fn() };
      const { resolveCountryCode } = createMusicBrainz({ logger: mockLogger });

      assert.strictEqual(resolveCountryCode('US'), 'United States');
      assert.strictEqual(resolveCountryCode('GB'), 'United Kingdom');
      assert.strictEqual(resolveCountryCode('SE'), 'Sweden');
    });

    it('should handle lowercase codes', () => {
      const mockLogger = { info: mock.fn(), warn: mock.fn() };
      const { resolveCountryCode } = createMusicBrainz({ logger: mockLogger });

      assert.strictEqual(resolveCountryCode('us'), 'United States');
      assert.strictEqual(resolveCountryCode('gb'), 'United Kingdom');
    });

    it('should return empty string for unknown codes', () => {
      const mockLogger = { info: mock.fn(), warn: mock.fn() };
      const { resolveCountryCode } = createMusicBrainz({ logger: mockLogger });

      assert.strictEqual(resolveCountryCode('ZZ'), '');
      assert.strictEqual(resolveCountryCode('XX'), '');
    });

    it('should return empty string for invalid input', () => {
      const mockLogger = { info: mock.fn(), warn: mock.fn() };
      const { resolveCountryCode } = createMusicBrainz({ logger: mockLogger });

      assert.strictEqual(resolveCountryCode(''), '');
      assert.strictEqual(resolveCountryCode(null), '');
      assert.strictEqual(resolveCountryCode(undefined), '');
      assert.strictEqual(resolveCountryCode('USA'), ''); // Too long
      assert.strictEqual(resolveCountryCode('U'), ''); // Too short
    });
  });

  describe('getArtistCountriesBatch', () => {
    it('should process array of artist names', async () => {
      const mockLogger = { info: mock.fn(), warn: mock.fn() };
      let callCount = 0;
      const mockFetch = mock.fn(() => {
        callCount++;
        const responses = {
          1: { artists: [{ id: '1', name: 'Artist One', country: 'US' }] },
          2: { artists: [{ id: '2', name: 'Artist Two', country: 'SE' }] },
          3: { artists: [] },
        };
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(responses[callCount] || { artists: [] }),
        });
      });

      const { getArtistCountriesBatch } = createMusicBrainz({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const results = await getArtistCountriesBatch([
        'Artist One',
        'Artist Two',
        'Unknown Artist',
      ]);

      assert.strictEqual(results.get('Artist One').country, 'United States');
      assert.strictEqual(results.get('Artist Two').country, 'Sweden');
      assert.strictEqual(results.get('Unknown Artist'), null);
    });

    it('should process array of artist objects', async () => {
      const mockLogger = { info: mock.fn(), warn: mock.fn() };
      const mockFetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'abc-123',
              name: 'Artist Name',
              country: 'NO',
            }),
        })
      );

      const { getArtistCountriesBatch } = createMusicBrainz({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const results = await getArtistCountriesBatch([
        { name: 'Artist Name', mbid: 'abc-123' },
      ]);

      assert.strictEqual(results.get('Artist Name').country, 'Norway');
      assert.strictEqual(results.get('Artist Name').mbid, 'abc-123');
    });

    it('should handle empty array', async () => {
      const mockLogger = { info: mock.fn(), warn: mock.fn() };
      const { getArtistCountriesBatch } = createMusicBrainz({
        logger: mockLogger,
      });

      const results = await getArtistCountriesBatch([]);
      assert.strictEqual(results.size, 0);
    });
  });

  describe('mbFetch', () => {
    it('should include correct headers', async () => {
      const mockLogger = { info: mock.fn(), warn: mock.fn() };
      let capturedHeaders;
      const mockFetch = mock.fn((url, options) => {
        capturedHeaders = options.headers;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      });

      const { mbFetch } = createMusicBrainz({
        logger: mockLogger,
        fetch: mockFetch,
      });

      await mbFetch('artist/test');

      assert.strictEqual(capturedHeaders['Accept'], 'application/json');
      assert.ok(capturedHeaders['User-Agent'].includes('SusheOnline'));
    });

    it('should call correct API URL', async () => {
      const mockLogger = { info: mock.fn(), warn: mock.fn() };
      let capturedUrl;
      const mockFetch = mock.fn((url) => {
        capturedUrl = url;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      });

      const { mbFetch } = createMusicBrainz({
        logger: mockLogger,
        fetch: mockFetch,
      });

      await mbFetch('artist/abc-123?fmt=json');

      assert.ok(capturedUrl.includes('musicbrainz.org/ws/2'));
      assert.ok(capturedUrl.includes('artist/abc-123'));
    });
  });
});
