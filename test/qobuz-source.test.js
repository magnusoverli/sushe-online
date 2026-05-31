const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  createQobuzSource,
  parseQobuzSearchPage,
  buildQobuzAlbumUrl,
  buildSearchUrl,
} = require('../services/availability/qobuz-source');
const { createMockLogger } = require('./helpers');

function createQobuzHtml(albums) {
  const props = JSON.stringify({
    mode: 'grid',
    albums: JSON.stringify(albums),
  }).replace(/"/g, '&quot;');
  return `<div data-live-props-value="${props}"></div>`;
}

describe('qobuz-source', () => {
  it('parses embedded Qobuz album search results', () => {
    const html = createQobuzHtml({
      rm9dhngzf2uvc: {
        id: 'rm9dhngzf2uvc',
        slug: 'necropalace-worm',
        title: 'Necropalace',
        artists: [{ name: 'Worm' }],
      },
    });

    assert.deepStrictEqual(parseQobuzSearchPage(html), [
      {
        id: 'rm9dhngzf2uvc',
        slug: 'necropalace-worm',
        title: 'Necropalace',
        artist: 'Worm',
      },
    ]);
  });

  it('returns a confident Qobuz album match', async () => {
    const html = createQobuzHtml({
      rm9dhngzf2uvc: {
        id: 'rm9dhngzf2uvc',
        slug: 'necropalace-worm',
        title: 'Necropalace',
        artists: [{ name: 'Worm' }],
      },
    });
    const fetchFn = mock.fn(async () => ({
      ok: true,
      text: async () => html,
    }));
    const source = createQobuzSource({
      fetch: fetchFn,
      logger: createMockLogger(),
      baseUrl: 'https://www.qobuz.com',
      store: 'no-en',
    });

    const result = await source.getLinks({
      artist: 'Worm',
      album: 'Necropalace',
    });

    assert.strictEqual(fetchFn.mock.calls.length, 1);
    assert.match(
      fetchFn.mock.calls[0].arguments[0],
      /\/no-en\/search\/albums\/Worm%20Necropalace$/
    );
    assert.deepStrictEqual(result.links, [
      {
        service: 'qobuz',
        url: 'https://www.qobuz.com/no-en/album/necropalace-worm/rm9dhngzf2uvc',
        confidence: 1,
        externalAlbumId: 'rm9dhngzf2uvc',
        externalArtist: 'Worm',
        externalAlbum: 'Necropalace',
      },
    ]);
  });

  it('matches Qobuz edition-suffixed album titles', async () => {
    const html = createQobuzHtml({
      qiq00522nqx4y: {
        id: 'qiq00522nqx4y',
        slug: 'the-mantle-agalloch',
        title: 'The Mantle (Remastered 2016)',
        artists: [{ name: 'Agalloch' }],
      },
    });
    const source = createQobuzSource({
      fetch: async () => ({ ok: true, text: async () => html }),
      logger: createMockLogger(),
      baseUrl: 'https://www.qobuz.com',
      store: 'no-en',
    });

    const result = await source.getLinks({
      artist: 'Agalloch',
      album: 'The Mantle',
    });

    assert.strictEqual(result.links[0].service, 'qobuz');
    assert.strictEqual(result.links[0].externalAlbumId, 'qiq00522nqx4y');
  });

  it('ignores weak Qobuz search matches', async () => {
    const html = createQobuzHtml({
      other: {
        id: 'other',
        slug: 'other-record',
        title: 'Different Record',
        artists: [{ name: 'Other Artist' }],
      },
    });
    const source = createQobuzSource({
      fetch: async () => ({ ok: true, text: async () => html }),
      logger: createMockLogger(),
    });

    assert.deepStrictEqual(
      await source.getLinks({ artist: 'Worm', album: 'Necropalace' }),
      { links: [] }
    );
  });

  it('builds Qobuz URLs and search URLs', () => {
    assert.strictEqual(
      buildQobuzAlbumUrl({
        baseUrl: 'https://www.qobuz.com',
        store: 'no-en',
        slug: 'necropalace-worm',
        id: 'rm9dhngzf2uvc',
      }),
      'https://www.qobuz.com/no-en/album/necropalace-worm/rm9dhngzf2uvc'
    );
    assert.strictEqual(
      buildSearchUrl({
        baseUrl: 'https://www.qobuz.com',
        store: 'no-en',
        artist: 'Worm',
        album: 'Necropalace',
      }),
      'https://www.qobuz.com/no-en/search/albums/Worm%20Necropalace'
    );
  });
});
