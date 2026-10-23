export function trackTitle(track) {
  return typeof track === 'string' ? track : track?.name || track?.title || '';
}

// Exact titles take priority over numeric positions. New manual picks use #N.
export function findTrackIndex(identifier, tracks = []) {
  if (!identifier || !Array.isArray(tracks)) return -1;
  const exact = tracks.findIndex((track) => trackTitle(track) === identifier);
  if (exact >= 0) return exact;
  if (!/^#?\d+$/.test(identifier)) return -1;
  const index = Number(identifier.replace(/^#/, '')) - 1;
  return index >= 0 && index < tracks.length ? index : -1;
}

export function resolveTrackTitle(identifier, tracks) {
  const index = findTrackIndex(identifier, tracks);
  return index < 0 ? identifier || '' : trackTitle(tracks[index]);
}
