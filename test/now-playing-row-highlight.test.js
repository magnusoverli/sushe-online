const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createClassList() {
  const classes = new Set();
  return {
    toggle(name, force) {
      if (force) {
        classes.add(name);
      } else {
        classes.delete(name);
      }
    },
    contains(name) {
      return classes.has(name);
    },
  };
}

function createRow(index) {
  return {
    dataset: { index: String(index) },
    classList: createClassList(),
  };
}

function createWindow() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, handler) {
      listeners.set(name, handler);
    },
    removeEventListener(name, handler) {
      if (listeners.get(name) === handler) {
        listeners.delete(name);
      }
    },
    dispatchPlayback(detail) {
      listeners.get('spotify-playback-change')?.({ detail });
    },
  };
}

describe('now-playing-row-highlight module', () => {
  let module;

  beforeEach(async () => {
    module = await import('../src/js/modules/now-playing-row-highlight.js');
  });

  it('normalizes Spotify album identifiers from supported forms', () => {
    assert.strictEqual(
      module.normalizeSpotifyAlbumId('spotify-abc123'),
      'abc123'
    );
    assert.strictEqual(
      module.normalizeSpotifyAlbumId('spotify:album:def456'),
      'def456'
    );
    assert.strictEqual(
      module.normalizeSpotifyAlbumId(
        'https://open.spotify.com/album/ghi789?si=1'
      ),
      'ghi789'
    );
  });

  it('matches by Spotify album id before falling back to names', () => {
    const album = {
      album_id: 'spotify-abc123',
      album: 'Different local title',
      artist: 'Different local artist',
    };

    assert.strictEqual(
      module.albumMatchesPlayback(album, {
        hasPlayback: true,
        spotifyAlbumId: 'abc123',
        albumName: 'Remote title',
        artistName: 'Remote artist',
      }),
      true
    );
  });

  it('keeps a desktop row highlighted while playback is paused', () => {
    const rows = [createRow(0), createRow(1)];
    const container = {
      querySelectorAll(selector) {
        return selector === '.album-rows-container > .album-row' ? rows : [];
      },
    };
    const doc = { getElementById: () => container };
    const win = createWindow();
    const highlighter = module.createNowPlayingRowHighlight({
      doc,
      win,
      getCurrentList: () => 'list-1',
      getListData: () => [
        { album_id: 'spotify-abc123', album: 'Album A', artist: 'Artist A' },
        { album_id: 'spotify-def456', album: 'Album B', artist: 'Artist B' },
      ],
    });

    highlighter.initialize();
    win.dispatchPlayback({
      hasPlayback: true,
      isPlaying: false,
      spotifyAlbumId: 'abc123',
      albumName: 'Album A',
      artistName: 'Artist A',
    });

    assert.strictEqual(
      rows[0].classList.contains(module.NOW_PLAYING_ROW_CLASS),
      true
    );
    assert.strictEqual(rows[0].dataset.nowPlaying, 'true');
    assert.strictEqual(
      rows[1].classList.contains(module.NOW_PLAYING_ROW_CLASS),
      false
    );
  });

  it('clears the highlighted row when playback stops', () => {
    const rows = [createRow(0)];
    const container = {
      querySelectorAll(selector) {
        return selector === '.album-rows-container > .album-row' ? rows : [];
      },
    };
    const doc = { getElementById: () => container };
    const win = createWindow();
    const highlighter = module.createNowPlayingRowHighlight({
      doc,
      win,
      getCurrentList: () => 'list-1',
      getListData: () => [{ album: 'Café Album', artist: 'Señor Artist' }],
    });

    highlighter.initialize();
    win.dispatchPlayback({
      hasPlayback: true,
      albumName: 'Cafe Album',
      artistName: 'Senor Artist',
    });
    win.dispatchPlayback({ hasPlayback: false });

    assert.strictEqual(
      rows[0].classList.contains(module.NOW_PLAYING_ROW_CLASS),
      false
    );
    assert.strictEqual(rows[0].dataset.nowPlaying, undefined);
  });
});
