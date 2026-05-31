const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  createSpotifySource,
} = require('../services/availability/spotify-source');
const { createMockLogger } = require('./helpers');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('availability/spotify-source', () => {
  it('does nothing when Spotify app credentials are not configured', async () => {
    const fetch = mock.fn();
    const source = createSpotifySource({
      fetch,
      logger: createMockLogger(),
      env: {},
    });

    const result = await source.getLinks({
      artist: 'Metallica',
      album: '72 Seasons',
    });

    assert.deepStrictEqual(result, { links: [] });
    assert.strictEqual(fetch.mock.calls.length, 0);
  });

  it('returns a Spotify link for a confident album search match', async () => {
    const fetch = mock.fn(async (url) => {
      if (url === 'https://accounts.spotify.com/api/token') {
        return jsonResponse({ access_token: 'token', expires_in: 3600 });
      }

      return jsonResponse({
        albums: {
          items: [
            {
              id: 'spotify-album-1',
              name: '72 Seasons',
              artists: [{ name: 'Metallica' }],
              external_urls: {
                spotify: 'https://open.spotify.com/album/spotify-album-1',
              },
            },
          ],
        },
      });
    });
    const source = createSpotifySource({
      fetch,
      logger: createMockLogger(),
      env: {
        SPOTIFY_CLIENT_ID: 'id',
        SPOTIFY_CLIENT_SECRET: 'secret',
      },
    });

    const result = await source.getLinks({
      artist: 'Metallica',
      album: '72 Seasons',
    });

    assert.strictEqual(result.links.length, 1);
    assert.deepStrictEqual(result.links[0], {
      service: 'spotify',
      url: 'https://open.spotify.com/album/spotify-album-1',
      confidence: 1,
      externalAlbumId: 'spotify-album-1',
      externalArtist: 'Metallica',
      externalAlbum: '72 Seasons',
    });
    assert.ok(fetch.mock.calls.length > 1);
  });

  it('tries a UPC album search with a market when barcode is available', async () => {
    const requested = [];
    const fetch = mock.fn(async (url) => {
      requested.push(url);
      if (url === 'https://accounts.spotify.com/api/token') {
        return jsonResponse({ access_token: 'token', expires_in: 3600 });
      }

      return jsonResponse({ albums: { items: [] } });
    });
    const source = createSpotifySource({
      fetch,
      logger: createMockLogger(),
      env: {
        SPOTIFY_CLIENT_ID: 'id',
        SPOTIFY_CLIENT_SECRET: 'secret',
      },
    });

    await source.getLinks({
      artist: 'Daft Punk',
      album: 'Random Access Memories',
      upc: '886443927087',
    });

    const searchUrl = requested.find((url) => url.includes('/v1/search'));
    assert.ok(searchUrl.includes('q=upc%3A886443927087'));
    assert.ok(searchUrl.includes('market=US'));
  });

  it('rejects weak Spotify search matches', async () => {
    const fetch = mock.fn(async (url) => {
      if (url === 'https://accounts.spotify.com/api/token') {
        return jsonResponse({ access_token: 'token', expires_in: 3600 });
      }

      return jsonResponse({
        albums: {
          items: [
            {
              id: 'wrong',
              name: 'Load',
              artists: [{ name: 'Metallica' }],
              external_urls: {
                spotify: 'https://open.spotify.com/album/wrong',
              },
            },
          ],
        },
      });
    });
    const source = createSpotifySource({
      fetch,
      logger: createMockLogger(),
      env: {
        SPOTIFY_CLIENT_ID: 'id',
        SPOTIFY_CLIENT_SECRET: 'secret',
      },
    });

    const result = await source.getLinks({
      artist: 'Metallica',
      album: '72 Seasons',
    });

    assert.deepStrictEqual(result, { links: [] });
  });
});
