const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { createSpotifyService } = require('../services/spotify-service');
const { createMockLogger } = require('./helpers');

describe('spotify-service', () => {
  it('schedules playcount refresh using Spotify album mappings', async () => {
    let scheduled = null;
    const db = {
      raw: mock.fn(async () => ({
        rows: [
          {
            album_id: 'album-1',
            artist: 'Marianas Rest',
            album: 'The Bereaved',
          },
        ],
      })),
    };
    const refreshPlaycountsInBackground = mock.fn(async () => ({}));
    const service = createSpotifyService({
      fetch: async () => ({}),
      logger: createMockLogger(),
    });

    service.schedulePlaycountRefresh({
      spotifyAlbumId: 'spotify-album-1',
      userId: 'user-1',
      lastfmUsername: 'listener',
      db,
      refreshPlaycountsInBackground,
      schedule: (callback, delay) => {
        scheduled = { callback, delay };
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.match(db.raw.mock.calls[0].arguments[0], /album_service_mappings/);
    assert.deepStrictEqual(db.raw.mock.calls[0].arguments[1], [
      'spotify-album-1',
    ]);
    assert.strictEqual(scheduled.delay, 60000);

    await scheduled.callback();

    assert.strictEqual(refreshPlaycountsInBackground.mock.calls.length, 1);
    assert.deepStrictEqual(
      refreshPlaycountsInBackground.mock.calls[0].arguments[2],
      [
        {
          itemId: 'album-1',
          artist: 'Marianas Rest',
          album: 'The Bereaved',
          album_id: 'album-1',
        },
      ]
    );
  });
});
