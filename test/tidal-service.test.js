const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { createTidalService } = require('../services/tidal-service.js');
const { createMockLogger } = require('./helpers');

describe('tidal-service searchAlbum', () => {
  it('returns the first result id (album-artist query order)', async () => {
    const fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: '12345' }, { id: '67890' }] }),
    }));
    const service = createTidalService({
      fetch,
      userService: {},
      logger: createMockLogger(),
    });

    const result = await service.searchAlbum(
      'Radiohead',
      'OK Computer',
      'tok',
      'US'
    );

    assert.deepStrictEqual(result, { id: '12345' });
    // Pure ASCII → a single query form (no extra fallback request).
    assert.strictEqual(fetch.mock.calls.length, 1);
    const url = fetch.mock.calls[0].arguments[0];
    assert.ok(
      url.includes('OK%20Computer%20Radiohead'),
      'query is "album artist"'
    );
  });

  it('falls back to a romanized query for Cyrillic names', async () => {
    // Native-script query returns nothing; the romanized fallback resolves.
    const fetch = mock.fn(async (url) => ({
      ok: true,
      json: async () =>
        url.includes('Patriarkh') ? { data: [{ id: 'rom-1' }] } : { data: [] },
    }));
    const service = createTidalService({
      fetch,
      userService: {},
      logger: createMockLogger(),
    });

    const result = await service.searchAlbum(
      'Патриархь',
      'Prophet Ilja',
      'tok',
      'US'
    );

    assert.deepStrictEqual(result, { id: 'rom-1' });
    // First the native (percent-encoded Cyrillic) form, then the romanized one.
    assert.strictEqual(fetch.mock.calls.length, 2);
  });

  it('returns null when no query form yields a result', async () => {
    const fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    }));
    const service = createTidalService({
      fetch,
      userService: {},
      logger: createMockLogger(),
    });

    const result = await service.searchAlbum(
      'Патриархь',
      'Prophet Ilja',
      'tok',
      'US'
    );

    assert.strictEqual(result, null);
  });

  it('throws on a non-OK API response', async () => {
    const fetch = mock.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    }));
    const logger = createMockLogger();
    const service = createTidalService({ fetch, userService: {}, logger });

    await assert.rejects(
      () => service.searchAlbum('Radiohead', 'OK Computer', 'tok', 'US'),
      /Tidal API error 503/
    );
    assert.strictEqual(logger.warn.mock.calls.length, 1);
  });
});
