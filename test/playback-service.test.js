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

    it('should open Spotify album with correct URI', async () => {
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

    it('should open Tidal album with correct URI', async () => {
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

    it('should open Tidal track with correct URI', async () => {
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
