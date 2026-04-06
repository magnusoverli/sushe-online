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
  it('checkPlaylistExists should search beyond first page', async () => {
    const originalFetch = global.fetch;
    const fetchCalls = [];

    global.fetch = mock.fn(async (url) => {
      fetchCalls.push(url);

      if (String(url).includes('offset=0')) {
        return createFetchResponse({
          jsonData: { items: [{ name: 'Other' }], next: 'next-page' },
        });
      }

      return createFetchResponse({
        jsonData: {
          items: [{ name: 'Target Playlist' }],
          next: null,
        },
      });
    });

    try {
      const service = createSpotifyPlaylistService({
        logger: createMockLogger(),
      });
      const exists = await service.checkPlaylistExists('Target Playlist', {
        access_token: 'token',
      });

      assert.strictEqual(exists, true);
      assert.ok(fetchCalls.some((url) => String(url).includes('offset=50')));
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
          items: [
            {
              id: 'pl1',
              name: 'My Playlist',
              external_urls: { spotify: 'https://spotify.test/pl1' },
            },
          ],
          next: null,
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
      });
      const result = {
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
            {},
            result
          ),
        /Failed to clear Spotify playlist tracks/
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
