const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const {
  createTidalPlaylistService,
} = require('../services/playlist/tidal-playlist');
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

describe('tidal-playlist-service', () => {
  it('checkPlaylistExists should search beyond first page', async () => {
    const originalFetch = global.fetch;
    const calls = [];

    global.fetch = mock.fn(async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/me'))
        return createFetchResponse({ jsonData: { id: 'account' } });

      if (String(url).includes('offset=0')) {
        const firstPage = Array.from({ length: 50 }, (_, i) => ({
          id: `unrelated-${i}`,
          attributes: { title: `Other ${i}` },
        }));
        firstPage[0].attributes.title = 'Target Playlist';
        return createFetchResponse({
          jsonData: { data: firstPage },
        });
      }

      return createFetchResponse({
        jsonData: {
          data: [{ id: 'bound', attributes: { title: 'Renamed Playlist' } }],
        },
      });
    });

    try {
      const service = createTidalPlaylistService({
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
      assert.ok(calls.some((url) => url.includes('offset=50')));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('handlePlaylist should fail when clear step fails', async () => {
    const originalFetch = global.fetch;
    let callIndex = 0;

    const responses = [
      // profile
      createFetchResponse({ jsonData: { data: { id: 'tidal-user' } } }),
      // playlists page
      createFetchResponse({
        jsonData: {
          data: [{ id: 'pl1', attributes: { title: 'My Playlist' } }],
        },
      }),
      // album search (no match)
      createFetchResponse({ jsonData: { data: [] } }),
      // fallback track search
      createFetchResponse({ jsonData: { data: [{ id: 't1' }] } }),
      // clear playlist items (fails)
      createFetchResponse({ ok: false, status: 500, textData: 'clear failed' }),
    ];

    global.fetch = mock.fn(async () => {
      const response = responses[callIndex];
      callIndex += 1;
      return response;
    });

    try {
      const service = createTidalPlaylistService({
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
            { _id: 'user', tidalCountry: 'US' },
            result
          ),
        /Failed to clear Tidal playlist tracks/
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
