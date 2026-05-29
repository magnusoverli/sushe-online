export function getTrackId(track) {
  if (!track?.name || !track?.artists?.[0]?.name) return null;
  return track.id || `${track.name}-${track.artists[0].name}`;
}

export function buildLastfmBody(track) {
  return {
    artist: track.artists[0].name,
    track: track.name,
    album: track.album?.name || '',
    duration: Math.floor((track.duration_ms || 0) / 1000),
  };
}

export function hasLastfmConnection(win = globalThis.window) {
  return !!win?.currentUser?.lastfmUsername;
}

const TERMINAL_LASTFM_ERROR_CODES = new Set([
  'NOT_AUTHENTICATED',
  'SERVICE_NOT_CONFIGURED',
  'LASTFM_INVALID_API_KEY',
  'LASTFM_SESSION_INVALID',
]);

export function isTerminalLastfmErrorCode(code) {
  return TERMINAL_LASTFM_ERROR_CODES.has(code);
}
