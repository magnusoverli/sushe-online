const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  createOdesliClient,
} = require('../services/availability/odesli-client');
const { createMockLogger } = require('./helpers');

function mockFetch(handler) {
  return async (url) => handler(url);
}

describe('availability/odesli-client', () => {
  it('expands a url seed into normalized platform links', async () => {
    let calledUrl = null;
    const client = createOdesliClient({
      logger: createMockLogger(),
      fetch: mockFetch(async (url) => {
        calledUrl = url;
        return {
          ok: true,
          json: async () => ({
            linksByPlatform: {
              appleMusic: { url: 'https://music.apple.com/a' },
              tidal: { url: 'https://tidal.com/a' },
              broken: {},
            },
          }),
        };
      }),
    });

    const links = await client.fetchLinksBySeed({
      url: 'https://deezer.com/album/1',
    });

    assert.ok(calledUrl.includes('url=https%3A%2F%2Fdeezer.com%2Falbum%2F1'));
    assert.ok(calledUrl.includes('userCountry=US'));
    assert.deepStrictEqual(links, [
      { platform: 'appleMusic', url: 'https://music.apple.com/a' },
      { platform: 'tidal', url: 'https://tidal.com/a' },
    ]);
  });

  it('builds a platform/type/id query', async () => {
    let calledUrl = null;
    const client = createOdesliClient({
      logger: createMockLogger(),
      fetch: mockFetch(async (url) => {
        calledUrl = url;
        return { ok: true, json: async () => ({ linksByPlatform: {} }) };
      }),
    });

    await client.fetchLinksBySeed({
      platform: 'itunes',
      type: 'album',
      id: 99,
    });

    assert.ok(calledUrl.includes('platform=itunes'));
    assert.ok(calledUrl.includes('type=album'));
    assert.ok(calledUrl.includes('id=99'));
  });

  it('returns [] for an empty seed', async () => {
    const client = createOdesliClient({
      logger: createMockLogger(),
      fetch: mockFetch(async () => {
        throw new Error('should not be called');
      }),
    });
    assert.deepStrictEqual(await client.fetchLinksBySeed({}), []);
  });

  it('throws with status on a transient non-200', async () => {
    const client = createOdesliClient({
      logger: createMockLogger(),
      fetch: mockFetch(async () => ({ ok: false, status: 429 })),
    });
    await assert.rejects(
      () => client.fetchLinksBySeed({ url: 'https://x/y' }),
      (err) => err.status === 429
    );
  });
});
