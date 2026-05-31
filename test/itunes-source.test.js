const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  createItunesSource,
  ITUNES_UPC_CONFIDENCE,
} = require('../services/availability/itunes-source');
const { createMockLogger } = require('./helpers');

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

describe('availability/itunes-source', () => {
  it('returns an apple_music link (query stripped) on an exact UPC hit', async () => {
    let requested = null;
    const source = createItunesSource({
      fetch: async (url) => {
        requested = url;
        return jsonResponse({
          resultCount: 1,
          results: [
            {
              wrapperType: 'collection',
              collectionType: 'Album',
              collectionName: 'Random Access Memories',
              artistName: 'Daft Punk',
              collectionId: 617154241,
              collectionViewUrl:
                'https://music.apple.com/us/album/random-access-memories/617154241?uo=4',
            },
          ],
        });
      },
      logger: createMockLogger(),
    });

    const { links } = await source.getLinks({ upc: '886443984059' });

    assert.ok(requested.includes('upc=886443984059'));
    assert.ok(requested.includes('entity=album'));
    assert.deepStrictEqual(links, [
      {
        service: 'apple_music',
        url: 'https://music.apple.com/us/album/random-access-memories/617154241',
        confidence: ITUNES_UPC_CONFIDENCE,
      },
    ]);
  });

  it('returns no links when the barcode is not found (resultCount 0)', async () => {
    const source = createItunesSource({
      fetch: async () => jsonResponse({ resultCount: 0, results: [] }),
      logger: createMockLogger(),
    });
    assert.deepStrictEqual(await source.getLinks({ upc: '000000000000' }), {
      links: [],
    });
  });

  it('returns no links without a UPC and makes no request', async () => {
    let called = false;
    const source = createItunesSource({
      fetch: async () => {
        called = true;
        return jsonResponse({ resultCount: 0, results: [] });
      },
      logger: createMockLogger(),
    });
    assert.deepStrictEqual(await source.getLinks({}), { links: [] });
    assert.strictEqual(called, false);
  });

  it('degrades to no links on a transport error', async () => {
    const source = createItunesSource({
      fetch: async () => {
        throw new Error('network down');
      },
      logger: createMockLogger(),
    });
    assert.deepStrictEqual(await source.getLinks({ upc: '886443984059' }), {
      links: [],
    });
  });
});
