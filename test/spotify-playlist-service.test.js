const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const {
  createSpotifyPlaylistService,
} = require('../services/playlist/spotify-playlist');
const { createMockLogger } = require('./helpers');

function createFetchResponse({
  ok = true,
  status = 200,
  jsonData,
  textData = '',
}) {
  return {
    ok,
    status,
    json: async () => jsonData,
    text: async () => textData,
  };
}

describe('spotify-playlist-service', () => {
  it('exports same-name SuShe lists into distinct new playlists instead of overwriting personal playlists', async (t) => {
    const bindings = new Map();
    const requests = [];
    let nextId = 0;
    t.mock.method(global, 'fetch', async (url, options = {}) => {
      requests.push({ url, ...options });
      if (url.endsWith('/me'))
        return createFetchResponse({ jsonData: { id: 'account' } });
      if (url.endsWith('/users/account/playlists'))
        return createFetchResponse({ jsonData: { id: `created-${++nextId}` } });
      if (url.includes('/search?'))
        return createFetchResponse({
          jsonData: { tracks: { items: [{ uri: 'spotify:track:1' }] } },
        });
      if (/\/playlists\/created-\d\/tracks$/.test(url))
        return createFetchResponse({ jsonData: {} });
      throw new Error(`Unexpected provider request: ${url}`);
    });
    const service = createSpotifyPlaylistService({
      logger: createMockLogger(),
      bindings: {
        get: async (_user, listId) => bindings.get(listId),
        set: async (_user, listId, _service, _account, id) =>
          bindings.set(listId, id),
      },
    });
    for (const listId of ['first', 'second']) {
      await service.handlePlaylist(
        'Favorites',
        [{ artist: 'Artist', album: 'Album', primaryTrack: 'Song' }],
        { access_token: 'synthetic' },
        { _id: 'user' },
        {
          listId,
          processed: 0,
          successful: 0,
          failed: 0,
          tracks: [],
          errors: [],
        }
      );
    }
    assert.notEqual(bindings.get('first'), bindings.get('second'));
    assert.ok(
      requests
        .filter((entry) => entry.method === 'PUT')
        .every((entry) => entry.url.includes('/created-'))
    );
    assert.ok(!requests.some((entry) => entry.url.includes('/me/playlists')));
  });
  it('checks the bound playlist by ID rather than adopting a matching name', async () => {
    const originalFetch = global.fetch;
    const fetchCalls = [];

    global.fetch = mock.fn(async (url) => {
      fetchCalls.push(url);

      if (String(url).endsWith('/me')) {
        return createFetchResponse({
          jsonData: { id: 'account' },
        });
      }

      return createFetchResponse({
        jsonData: {
          id: 'bound',
          name: 'Renamed',
          owner: { id: 'account' },
        },
      });
    });

    try {
      const service = createSpotifyPlaylistService({
        logger: createMockLogger(),
        bindings: { get: async () => 'bound' },
      });
      const exists = await service.checkPlaylistExists(
        'Target Playlist',
        {
          access_token: 'token',
        },
        { _id: 'user' },
        'list'
      );

      assert.strictEqual(exists, true);
      assert.ok(
        fetchCalls.some((url) => String(url).endsWith('/playlists/bound'))
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('handlePlaylist should fail when clear step fails', async () => {
    const originalFetch = global.fetch;
    let callIndex = 0;

    const responses = [
      // profile
      createFetchResponse({ jsonData: { id: 'spotify-user' } }),
      // playlists page 1
      createFetchResponse({
        jsonData: {
          id: 'pl1',
          name: 'My Playlist',
          owner: { id: 'spotify-user' },
          external_urls: { spotify: 'https://spotify.test/pl1' },
        },
      }),
      // track search
      createFetchResponse({
        jsonData: {
          tracks: { items: [{ uri: 'spotify:track:1' }] },
        },
      }),
      // clear playlist tracks (fails)
      createFetchResponse({ ok: false, status: 500, textData: 'clear failed' }),
    ];

    global.fetch = mock.fn(async () => {
      const response = responses[callIndex];
      callIndex += 1;
      return response;
    });

    try {
      const service = createSpotifyPlaylistService({
        logger: createMockLogger(),
        bindings: { get: async () => 'pl1' },
      });
      const result = {
        listId: 'list',
        processed: 0,
        successful: 0,
        failed: 0,
        tracks: [],
        errors: [],
        playlistUrl: null,
      };

      await assert.rejects(
        () =>
          service.handlePlaylist(
            'My Playlist',
            [{ artist: 'Artist', album: 'Album', primaryTrack: 'Song' }],
            { access_token: 'token' },
            { _id: 'user' },
            result
          ),
        /Failed to clear Spotify playlist tracks/
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
