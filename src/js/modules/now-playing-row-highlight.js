import { isAlbumMatchingPlayback } from './playback-utils.js';

export const NOW_PLAYING_ROW_CLASS = 'album-row--now-playing';
const NOW_PLAYING_ROW_SELECTOR = [
  '.album-rows-container > .album-row',
  '.mobile-album-list .album-card.album-row',
].join(', ');

function asString(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

export function normalizeSpotifyAlbumId(value) {
  const raw = asString(value);
  if (!raw) return '';

  const urlMatch = raw.match(/open\.spotify\.com\/album\/([^/?#]+)/i);
  if (urlMatch) return urlMatch[1];

  const uriMatch = raw.match(/^spotify:album:([^\s]+)$/i);
  if (uriMatch) return uriMatch[1];

  const prefixedMatch = raw.match(/^spotify-([^\s]+)$/i);
  if (prefixedMatch) return prefixedMatch[1];

  return raw;
}

export function albumMatchesPlayback(album, playback) {
  if (!album || !playback || playback.hasPlayback === false) return false;

  const playingSpotifyAlbumId = normalizeSpotifyAlbumId(
    playback.spotifyAlbumId || playback.albumId || playback.album_id
  );
  const listSpotifyAlbumId = normalizeSpotifyAlbumId(
    album.spotifyAlbumId ||
      album.spotify_album_id ||
      album.album_id ||
      album.albumId
  );

  if (
    playingSpotifyAlbumId &&
    listSpotifyAlbumId &&
    playingSpotifyAlbumId === listSpotifyAlbumId
  ) {
    return true;
  }

  return isAlbumMatchingPlayback(
    album,
    playback.albumName,
    playback.artistName
  );
}

export function createNowPlayingRowHighlight(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  const getListData = deps.getListData || (() => []);
  const getCurrentList = deps.getCurrentList || (() => null);

  let currentPlayback = null;
  let initialized = false;

  function getRows() {
    const container = doc?.getElementById?.('albumContainer');
    if (!container?.querySelectorAll) return [];

    return Array.from(container.querySelectorAll(NOW_PLAYING_ROW_SELECTOR));
  }

  function setRowState(row, isNowPlaying) {
    row.classList.toggle(NOW_PLAYING_ROW_CLASS, isNowPlaying);

    if (isNowPlaying) {
      row.dataset.nowPlaying = 'true';
      return;
    }

    delete row.dataset.nowPlaying;
  }

  function apply(playback = currentPlayback) {
    const rows = getRows();
    if (rows.length === 0) return;

    const albums = getListData(getCurrentList()) || [];

    rows.forEach((row) => {
      const index = Number.parseInt(row.dataset.index || '', 10);
      const album = Number.isNaN(index) ? null : albums[index];
      setRowState(row, albumMatchesPlayback(album, playback));
    });
  }

  function clear() {
    getRows().forEach((row) => setRowState(row, false));
  }

  function handlePlaybackChange(event) {
    currentPlayback = event?.detail || null;
    apply(currentPlayback);
  }

  function initialize() {
    if (initialized || !win?.addEventListener) return;

    initialized = true;
    win.addEventListener('spotify-playback-change', handlePlaybackChange);
    apply();
  }

  function destroy() {
    if (!initialized || !win?.removeEventListener) return;

    win.removeEventListener('spotify-playback-change', handlePlaybackChange);
    initialized = false;
    currentPlayback = null;
    clear();
  }

  return {
    initialize,
    destroy,
    apply,
    clear,
    handlePlaybackChange,
  };
}
