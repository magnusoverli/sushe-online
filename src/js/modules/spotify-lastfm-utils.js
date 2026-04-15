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
