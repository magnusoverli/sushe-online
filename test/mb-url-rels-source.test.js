const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  createMbUrlRelsSource,
} = require('../services/availability/mb-url-rels-source');
const { createMockLogger } = require('./helpers');

const MB_ID = 'e9b61dee-4172-4173-9bf6-6f80d2fb3f13';

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

describe('availability/mb-url-rels-source', () => {
  it('resolves release-group -> release -> url-rels links and a seed', async () => {
    const mbFetch = async (url) => {
      if (url.includes('/release-group/')) {
        return jsonResponse({
          releases: [
            { id: 'rel-promo', status: 'Promotion' },
            { id: 'rel-official', status: 'Official' },
          ],
        });
      }
      if (url.includes('/release/rel-official')) {
        return jsonResponse({
          barcode: '886443927087',
          relations: [
            {
              type: 'streaming',
              url: { resource: 'https://music.apple.com/us/album/1' },
            },
            {
              type: 'purchase for download',
              url: { resource: 'https://www.deezer.com/album/2' },
            },
            { type: 'discogs', url: { resource: 'https://discogs.com/x' } },
          ],
        });
      }
      throw new Error(`unexpected url ${url}`);
    };

    const source = createMbUrlRelsSource({
      mbFetch,
      logger: createMockLogger(),
    });
    const { seedUrl, upc, links } = await source.getDirectLinks(MB_ID);

    assert.strictEqual(seedUrl, 'https://music.apple.com/us/album/1');
    assert.strictEqual(upc, '886443927087');
    assert.deepStrictEqual(links, [
      { service: 'apple_music', url: 'https://music.apple.com/us/album/1' },
      { service: 'deezer', url: 'https://www.deezer.com/album/2' },
    ]);
  });

  it('returns empty for a non-MusicBrainz id', async () => {
    const source = createMbUrlRelsSource({
      mbFetch: async () => {
        throw new Error('should not be called');
      },
      logger: createMockLogger(),
    });
    assert.deepStrictEqual(await source.getDirectLinks('spotify:album:x'), {
      seedUrl: null,
      upc: null,
      links: [],
    });
  });

  it('treats a release-group 404 as a direct release id', async () => {
    const seen = [];
    const mbFetch = async (url) => {
      seen.push(url);
      if (url.includes('/release-group/')) {
        const err = new Error('not found');
        err.status = 404;
        throw err;
      }
      return jsonResponse({ relations: [] });
    };
    const source = createMbUrlRelsSource({
      mbFetch,
      logger: createMockLogger(),
    });
    const result = await source.getDirectLinks(MB_ID);
    assert.deepStrictEqual(result, { seedUrl: null, upc: null, links: [] });
    assert.ok(seen.some((u) => u.includes(`/release/${MB_ID}`)));
  });
});
