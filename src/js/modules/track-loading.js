import { patchAlbumCopies } from './app-state.js';
import { liveAlbumPatches } from './realtime-album-patches.js';

/** Fetch track metadata without overwriting a newer realtime response. */
export async function fetchTracksForAlbum(album, signal = null) {
  const requestGeneration = liveAlbumPatches.generation;
  const params = new URLSearchParams({
    id: album.album_id || '',
    artist: album.artist,
    album: album.album,
  });
  const fetchOptions = { credentials: 'include' };
  if (signal) fetchOptions.signal = signal;
  const resp = await fetch(
    `/api/musicbrainz/tracks?${params.toString()}`,
    fetchOptions
  );
  if (!resp.ok) {
    let message = 'Failed';
    try {
      const errData = await resp.json();
      message = errData.error || message;
    } catch (_parseError) {
      // Error responses may be HTML instead of JSON.
    }
    throw new Error(message);
  }
  const data = await resp.json();
  const patch = patchAlbumCopies(
    album.album_id,
    { tracks: data.tracks },
    requestGeneration
  );
  album.tracks = patch.tracks;
  return patch.tracks;
}
