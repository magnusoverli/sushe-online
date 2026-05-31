const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  createDeezerSource,
  DEEZER_UPC_CONFIDENCE,
} = require('../services/availability/deezer-source');
const { createMockLogger } = require('./helpers');

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

describe('availability/deezer-source', () => {
  it('returns a deezer link on an exact UPC hit', async () => {
    let requested = null;
    const source = createDeezerSource({
      fetch: async (url) => {
        requested = url;
        return jsonResponse({
          id: 6575789,
          title: 'Random Access Memories',
          link: 'https://www.deezer.com/album/6575789',
          upc: '886443927087',
        });
      },
      logger: createMockLogger(),
    });

    const { links } = await source.getLinks({ upc: '886443927087' });

    assert.ok(requested.includes('/album/upc:886443927087'));
    assert.deepStrictEqual(links, [
      {
        service: 'deezer',
        url: 'https://www.deezer.com/album/6575789',
        confidence: DEEZER_UPC_CONFIDENCE,
      },
    ]);
  });

  it('returns no links when Deezer reports no data for the barcode', async () => {
    const source = createDeezerSource({
      fetch: async () =>
        jsonResponse({
          error: { type: 'DataException', message: 'no data', code: 800 },
        }),
      logger: createMockLogger(),
    });
    assert.deepStrictEqual(await source.getLinks({ upc: '000000000000' }), {
      links: [],
    });
  });

  it('returns no links without a UPC and makes no request', async () => {
    let called = false;
    const source = createDeezerSource({
      fetch: async () => {
        called = true;
        return jsonResponse({});
      },
      logger: createMockLogger(),
    });
    assert.deepStrictEqual(await source.getLinks({}), { links: [] });
    assert.strictEqual(called, false);
  });

  it('degrades to no links on a transport error', async () => {
    const source = createDeezerSource({
      fetch: async () => {
        throw new Error('network down');
      },
      logger: createMockLogger(),
    });
    assert.deepStrictEqual(await source.getLinks({ upc: '886443927087' }), {
      links: [],
    });
  });
});
