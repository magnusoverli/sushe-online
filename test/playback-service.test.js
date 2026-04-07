/**
 * Tests for playback-service.js utility module
 */

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');

// Set up minimal globals
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

let openInMusicApp, playOnSpotifyDevice;

describe('playback-service', async () => {
  const mod = await import('../src/js/utils/playback-service.js');
  openInMusicApp = mod.openInMusicApp;
  playOnSpotifyDevice = mod.playOnSpotifyDevice;

  describe('openInMusicApp', () => {
    beforeEach(() => {
      // Reset location
      globalThis.window.location = { href: '' };
    });

    it('should open Spotify album with correct URL', async () => {
      const mockShowToast = mock.fn();
      globalThis.fetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'abc123' }),
        })
      );

      await openInMusicApp(
        'spotify',
        'album',
        { artist: 'Radiohead', album: 'OK Computer' },
        mockShowToast
      );

      assert.strictEqual(
        globalThis.window.location.href,
        'spotify:album:abc123'
      );
    });

    it('should open Tidal album with correct URL', async () => {
      const mockShowToast = mock.fn();
      globalThis.fetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'xyz789' }),
        })
      );

      await openInMusicApp(
        'tidal',
        'album',
        { artist: 'Radiohead', album: 'OK Computer' },
        mockShowToast
      );

      assert.strictEqual(
        globalThis.window.location.href,
        'tidal://album/xyz789'
      );
    });

    it('should open Qobuz album with correct URL and endpoint', async () => {
      const mockShowToast = mock.fn();
      globalThis.fetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: '0060252792762' }),
        })
      );

      await openInMusicApp(
        'qobuz',
        'album',
        { artist: 'Radiohead', album: 'OK Computer' },
        mockShowToast
      );

      const fetchUrl = globalThis.fetch.mock.calls[0].arguments[0];
      assert.ok(fetchUrl.startsWith('/api/qobuz/album?'));
      assert.strictEqual(
        globalThis.window.location.href,
        'qobuzapp://album/0060252792762'
      );
    });

    it('should fall back to Tidal web URL when app launch is not detected', async () => {
      const mockShowToast = mock.fn();
      const originalDocument = globalThis.document;
      const originalSetTimeout = globalThis.setTimeout;
      const originalClearTimeout = globalThis.clearTimeout;
      const originalOpen = globalThis.window.open;
      let scheduledFallback = null;

      globalThis.fetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'xyz789' }),
        })
      );

      globalThis.document = {
        visibilityState: 'visible',
        addEventListener: mock.fn(),
        removeEventListener: mock.fn(),
      };
      globalThis.window.addEventListener = mock.fn();
      globalThis.window.removeEventListener = mock.fn();
      globalThis.window.open = mock.fn();
      globalThis.setTimeout = (fn) => {
        scheduledFallback = fn;
        return 1;
      };
      globalThis.clearTimeout = () => {};

      try {
        await openInMusicApp(
          'tidal',
          'album',
          { artist: 'Radiohead', album: 'OK Computer' },
          mockShowToast
        );

        assert.strictEqual(
          globalThis.window.location.href,
          'tidal://album/xyz789'
        );

        assert.strictEqual(typeof scheduledFallback, 'function');

        scheduledFallback();

        assert.strictEqual(
          globalThis.window.open.mock.calls[0].arguments[0],
          'https://listen.tidal.com/album/xyz789'
        );
        assert.strictEqual(
          globalThis.window.open.mock.calls[0].arguments[1],
          '_blank'
        );
      } finally {
        globalThis.document = originalDocument;
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
        globalThis.window.open = originalOpen;
        delete globalThis.window.addEventListener;
        delete globalThis.window.removeEventListener;
      }
    });

    it('should include track in query for track type', async () => {
      const mockShowToast = mock.fn();
      globalThis.fetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'track1' }),
        })
      );

      await openInMusicApp(
        'spotify',
        'track',
        {
          artist: 'Radiohead',
          album: 'OK Computer',
          track: 'Paranoid Android',
        },
        mockShowToast
      );

      const fetchUrl = globalThis.fetch.mock.calls[0].arguments[0];
      assert.ok(fetchUrl.includes('track=Paranoid'));
      assert.strictEqual(
        globalThis.window.location.href,
        'spotify:track:track1'
      );
    });

    it('should fall back to Qobuz web URL when app launch is not detected', async () => {
      const mockShowToast = mock.fn();
      const originalDocument = globalThis.document;
      const originalSetTimeout = globalThis.setTimeout;
      const originalClearTimeout = globalThis.clearTimeout;
      const originalOpen = globalThis.window.open;
      let scheduledFallback = null;

      globalThis.fetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: '0060252792762' }),
        })
      );

      globalThis.document = {
        visibilityState: 'visible',
        addEventListener: mock.fn(),
        removeEventListener: mock.fn(),
      };
      globalThis.window.addEventListener = mock.fn();
      globalThis.window.removeEventListener = mock.fn();
      globalThis.window.open = mock.fn();
      globalThis.setTimeout = (fn) => {
        scheduledFallback = fn;
        return 1;
      };
      globalThis.clearTimeout = () => {};

      try {
        await openInMusicApp(
          'qobuz',
          'album',
          { artist: 'Radiohead', album: 'OK Computer' },
          mockShowToast
        );

        assert.strictEqual(
          globalThis.window.location.href,
          'qobuzapp://album/0060252792762'
        );
        assert.strictEqual(typeof scheduledFallback, 'function');

        scheduledFallback();

        assert.strictEqual(
          globalThis.window.open.mock.calls[0].arguments[0],
          'https://play.qobuz.com/album/0060252792762'
        );
        assert.strictEqual(
          globalThis.window.open.mock.calls[0].arguments[1],
          '_blank'
        );
      } finally {
        globalThis.document = originalDocument;
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
        globalThis.window.open = originalOpen;
        delete globalThis.window.addEventListener;
        delete globalThis.window.removeEventListener;
      }
    });

    it('should fall back to Spotify web URL when app launch is not detected', async () => {
      const mockShowToast = mock.fn();
      const originalDocument = globalThis.document;
      const originalSetTimeout = globalThis.setTimeout;
      const originalClearTimeout = globalThis.clearTimeout;
      const originalOpen = globalThis.window.open;
      let scheduledFallback = null;

      globalThis.fetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'abc123' }),
        })
      );

      globalThis.document = {
        visibilityState: 'visible',
        addEventListener: mock.fn(),
        removeEventListener: mock.fn(),
      };
      globalThis.window.addEventListener = mock.fn();
      globalThis.window.removeEventListener = mock.fn();
      globalThis.window.open = mock.fn();
      globalThis.setTimeout = (fn) => {
        scheduledFallback = fn;
        return 1;
      };
      globalThis.clearTimeout = () => {};

      try {
        await openInMusicApp(
          'spotify',
          'album',
          { artist: 'Radiohead', album: 'OK Computer' },
          mockShowToast
        );

        assert.strictEqual(
          globalThis.window.location.href,
          'spotify:album:abc123'
        );

        assert.strictEqual(typeof scheduledFallback, 'function');

        scheduledFallback();

        assert.strictEqual(
          globalThis.window.open.mock.calls[0].arguments[0],
          'https://open.spotify.com/album/abc123'
        );
        assert.strictEqual(
          globalThis.window.open.mock.calls[0].arguments[1],
          '_blank'
        );
      } finally {
        globalThis.document = originalDocument;
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
        globalThis.window.open = originalOpen;
        delete globalThis.window.addEventListener;
        delete globalThis.window.removeEventListener;
      }
    });

    it('should not fall back when focus is lost without blur event', async () => {
      const mockShowToast = mock.fn();
      const originalDocument = globalThis.document;
      const originalSetTimeout = globalThis.setTimeout;
      const originalClearTimeout = globalThis.clearTimeout;
      const originalSetInterval = globalThis.setInterval;
      const originalClearInterval = globalThis.clearInterval;
      let scheduledFallback = null;
      let focusProbe = null;
      let hasFocus = true;

      globalThis.fetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'xyz789' }),
        })
      );

      globalThis.document = {
        visibilityState: 'visible',
        hasFocus: () => hasFocus,
        addEventListener: mock.fn(),
        removeEventListener: mock.fn(),
      };
      globalThis.window.addEventListener = mock.fn();
      globalThis.window.removeEventListener = mock.fn();
      globalThis.setTimeout = (fn) => {
        scheduledFallback = fn;
        return 1;
      };
      globalThis.clearTimeout = () => {};
      globalThis.setInterval = (fn) => {
        focusProbe = fn;
        return 2;
      };
      globalThis.clearInterval = () => {};

      try {
        await openInMusicApp(
          'tidal',
          'album',
          { artist: 'Radiohead', album: 'OK Computer' },
          mockShowToast
        );

        assert.strictEqual(
          globalThis.window.location.href,
          'tidal://album/xyz789'
        );

        assert.strictEqual(typeof focusProbe, 'function');
        assert.strictEqual(typeof scheduledFallback, 'function');

        hasFocus = false;
        focusProbe();
        scheduledFallback();

        assert.strictEqual(
          globalThis.window.location.href,
          'tidal://album/xyz789'
        );
      } finally {
        globalThis.document = originalDocument;
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
        delete globalThis.window.addEventListener;
        delete globalThis.window.removeEventListener;
      }
    });

    it('should include albumId and releaseDate when provided', async () => {
      const mockShowToast = mock.fn();
      globalThis.fetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'abc123' }),
        })
      );

      await openInMusicApp(
        'spotify',
        'album',
        {
          artist: 'Exxul',
          album: 'Meteahna Timpurilor',
          albumId: 'album-123',
          releaseDate: '2007-01-01',
        },
        mockShowToast
      );

      const requestUrl = globalThis.fetch.mock.calls[0].arguments[0];
      assert.ok(requestUrl.includes('albumId=album-123'));
      assert.ok(requestUrl.includes('releaseDate=2007-01-01'));
    });

    it('should show toast on error response', async () => {
      const mockShowToast = mock.fn();
      globalThis.fetch = mock.fn(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: 'Not found' }),
        })
      );

      await openInMusicApp(
        'spotify',
        'album',
        { artist: 'Radiohead', album: 'OK Computer' },
        mockShowToast
      );

      assert.strictEqual(mockShowToast.mock.calls.length, 1);
      assert.strictEqual(mockShowToast.mock.calls[0].arguments[0], 'Not found');
    });

    it('should show toast when no id returned', async () => {
      const mockShowToast = mock.fn();
      globalThis.fetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        })
      );

      await openInMusicApp(
        'spotify',
        'album',
        { artist: 'Radiohead', album: 'OK Computer' },
        mockShowToast
      );

      assert.strictEqual(mockShowToast.mock.calls.length, 1);
      assert.ok(mockShowToast.mock.calls[0].arguments[0].includes('not found'));
    });

    it('should show toast on fetch failure', async () => {
      const mockShowToast = mock.fn();
      globalThis.fetch = mock.fn(() =>
        Promise.reject(new Error('Network error'))
      );

      await openInMusicApp(
        'spotify',
        'album',
        { artist: 'Radiohead', album: 'OK Computer' },
        mockShowToast
      );

      assert.strictEqual(mockShowToast.mock.calls.length, 1);
    });

    it('should open Tidal track with correct URL', async () => {
      const mockShowToast = mock.fn();
      globalThis.fetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'tidalTrack1' }),
        })
      );

      await openInMusicApp(
        'tidal',
        'track',
        {
          artist: 'Radiohead',
          album: 'OK Computer',
          track: 'Paranoid Android',
        },
        mockShowToast
      );

      assert.strictEqual(
        globalThis.window.location.href,
        'tidal://track/tidalTrack1'
      );
    });

    it('should show data.error when present but no id', async () => {
      const mockShowToast = mock.fn();
      globalThis.fetch = mock.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ error: 'Rate limited' }),
        })
      );

      await openInMusicApp(
        'spotify',
        'album',
        { artist: 'Radiohead', album: 'OK Computer' },
        mockShowToast
      );

      assert.strictEqual(mockShowToast.mock.calls.length, 1);
      assert.strictEqual(
        mockShowToast.mock.calls[0].arguments[0],
        'Rate limited'
      );
    });

    it('should show error toast when json parsing fails', async () => {
      const mockShowToast = mock.fn();
      globalThis.fetch = mock.fn(() =>
        Promise.resolve({
          ok: false,
          json: () => {
            throw new Error('Invalid JSON');
          },
        })
      );

      await openInMusicApp(
        'spotify',
        'album',
        { artist: 'Radiohead', album: 'OK Computer' },
        mockShowToast
      );

      assert.strictEqual(mockShowToast.mock.calls.length, 1);
      assert.strictEqual(
        mockShowToast.mock.calls[0].arguments[0],
        'Invalid response'
      );
    });

    it('should show unsupported service error without calling fetch', async () => {
      const mockShowToast = mock.fn();
      globalThis.fetch = mock.fn();

      await openInMusicApp(
        'deezer',
        'album',
        { artist: 'Radiohead', album: 'OK Computer' },
        mockShowToast
      );

      assert.strictEqual(globalThis.fetch.mock.calls.length, 0);
      assert.strictEqual(mockShowToast.mock.calls.length, 1);
      assert.strictEqual(
        mockShowToast.mock.calls[0].arguments[0],
        'Unsupported music service: deezer'
      );
    });
  });

  describe('playOnSpotifyDevice', () => {
    beforeEach(() => {
      globalThis.window.location = { href: '' };
    });

    it('should search and play album on device', async () => {
      const mockShowToast = mock.fn();
      let callCount = 0;
      globalThis.fetch = mock.fn(() => {
        callCount++;
        if (callCount === 1) {
          // Search response
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 'spotifyAlbumId' }),
          });
        }
        // Play response
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      });

      await playOnSpotifyDevice(
        { artist: 'Radiohead', album: 'OK Computer' },
        'device123',
        mockShowToast
      );

      // Should have 3 toast calls: "Starting playback...", then "Now playing..."
      assert.ok(mockShowToast.mock.calls.length >= 2);
      const lastToast =
        mockShowToast.mock.calls[mockShowToast.mock.calls.length - 1];
      assert.ok(lastToast.arguments[0].includes('Now playing'));
    });

    it('should show error when album not found on Spotify', async () => {
      const mockShowToast = mock.fn();
      globalThis.fetch = mock.fn(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: 'Album not found on Spotify' }),
        })
      );

      await playOnSpotifyDevice(
        { artist: 'Unknown', album: 'Unknown' },
        'device123',
        mockShowToast
      );

      const lastToast =
        mockShowToast.mock.calls[mockShowToast.mock.calls.length - 1];
      assert.ok(lastToast.arguments[0].includes('not found'));
    });

    it('should pass albumId and releaseDate to Spotify album search', async () => {
      const mockShowToast = mock.fn();
      let callCount = 0;
      globalThis.fetch = mock.fn(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 'spotifyAlbumId' }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      });

      await playOnSpotifyDevice(
        {
          artist: 'Exxul',
          album: 'Meteahna Timpurilor',
          album_id: 'album-42',
          release_date: '2007-01-01',
        },
        'device123',
        mockShowToast
      );

      const searchRequestUrl = globalThis.fetch.mock.calls[0].arguments[0];
      assert.ok(searchRequestUrl.includes('albumId=album-42'));
      assert.ok(searchRequestUrl.includes('releaseDate=2007-01-01'));
    });

    it('should show error when play request fails with success: false', async () => {
      const mockShowToast = mock.fn();
      let callCount = 0;
      globalThis.fetch = mock.fn(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 'spotifyAlbumId' }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ success: false, error: 'Device unavailable' }),
        });
      });

      await playOnSpotifyDevice(
        { artist: 'Radiohead', album: 'OK Computer' },
        'device123',
        mockShowToast
      );

      const lastToast =
        mockShowToast.mock.calls[mockShowToast.mock.calls.length - 1];
      assert.strictEqual(lastToast.arguments[0], 'Device unavailable');
    });

    it('should show error when fetch throws during play request', async () => {
      const mockShowToast = mock.fn();
      let callCount = 0;
      globalThis.fetch = mock.fn(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 'spotifyAlbumId' }),
          });
        }
        return Promise.reject(new Error('Network error'));
      });

      await playOnSpotifyDevice(
        { artist: 'Radiohead', album: 'OK Computer' },
        'device123',
        mockShowToast
      );

      const lastToast =
        mockShowToast.mock.calls[mockShowToast.mock.calls.length - 1];
      assert.strictEqual(lastToast.arguments[0], 'Failed to start playback');
    });
  });
});
