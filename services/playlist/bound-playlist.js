async function findSpotifyPlaylist(bindings, user, listId, profile, headers) {
  if (!bindings || !user?._id || !listId) return null;
  const id = await bindings.get(user._id, listId, 'spotify', profile.id);
  if (!id) return null;
  const response = await fetch(
    `https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}`,
    { headers }
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Unable to verify linked Spotify playlist');
  const playlist = await response.json();
  if (playlist.owner?.id !== profile.id)
    throw new Error(
      'Linked Spotify playlist is no longer owned by this account'
    );
  return playlist;
}

async function findTidalPlaylist(playlistId, headers) {
  if (!playlistId) return null;
  for (let offset = 0; ; offset += 50) {
    const response = await fetch(
      `https://openapi.tidal.com/v2/me/playlists?limit=50&offset=${offset}`,
      { headers }
    );
    if (!response.ok)
      throw new Error(
        `Unable to verify linked Tidal playlist: ${response.status}`
      );
    const playlists = await response.json();
    const existing = playlists.data.find(
      (playlist) => playlist.id === playlistId
    );
    if (existing) return existing;
    if (playlists.data.length < 50) return null;
  }
}

module.exports = { findSpotifyPlaylist, findTidalPlaylist };
