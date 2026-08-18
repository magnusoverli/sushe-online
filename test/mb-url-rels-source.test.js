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
  it('resolves release-group url-rels and a seed in one browse request', async () => {
    const seen = [];
    const mbFetch = async (url) => {
      seen.push(url);
      if (url.includes('/release?release-group=')) {
        return jsonResponse({
          releases: [
            { id: 'rel-promo', status: 'Promotion' },
            {
              id: 'rel-official',
              status: 'Official',
              barcode: '886443927087',
              relations: [
                {
                  type: 'streaming',
                  url: { resource: 'https://music.apple.com/us/album/1' },
                },
                {
                  type: 'purchase for download',
                  url: { resource: 'https://play.qobuz.com/album/2' },
                },
                {
                  type: 'discogs',
                  url: { resource: 'https://discogs.com/x' },
                },
              ],
            },
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
      { service: 'itunes', url: 'https://music.apple.com/us/album/1' },
      { service: 'qobuz', url: 'https://play.qobuz.com/album/2' },
    ]);
    assert.strictEqual(seen.length, 1);
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

  it('falls back to a direct release lookup when browse rejects a release id', async () => {
    const seen = [];
    const mbFetch = async (url) => {
      seen.push(url);
      if (url.includes('/release?release-group=')) {
        return { ok: false, status: 404 };
      }
      return jsonResponse({ relations: [] });
    };
    const source = createMbUrlRelsSource({
      mbFetch,
      logger: createMockLogger(),
    });
    const result = await source.getDirectLinks(MB_ID);
    assert.deepStrictEqual(result, { seedUrl: null, upc: null, links: [] });
    assert.strictEqual(seen.length, 2);
    assert.ok(seen.some((u) => u.includes(`/release/${MB_ID}`)));
  });
});
