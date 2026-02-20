/**
 * Tidal Service - API calls and helpers for Tidal integration.
 */

import { api } from './api-client';

/**
 * Open an album in the Tidal app via deep link.
 *
 * Resolves the album's Tidal ID through the server API, then navigates
 * to `tidal://album/{id}` which the OS intercepts and opens in the
 * Tidal app (matching the legacy UI behaviour).
 *
 * @throws {Error} If the album is not found on Tidal or the API call fails.
 */
export async function openInTidal(
  artist: string,
  album: string
): Promise<void> {
  const query = `artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`;
  const data = await api.get<{ id?: string; error?: string }>(
    `/api/tidal/album?${query}`
  );

  if (!data.id) {
    throw new Error(data.error || 'Album not found on Tidal');
  }

  window.location.href = `tidal://album/${data.id}`;
}

/**
 * Create or update a Tidal playlist from a list.
 * Uses the unified playlist endpoint POST /api/playlists/:listId with service=tidal.
 */
export async function syncPlaylistToTidal(
  listId: string
): Promise<{ success: boolean; playlistName?: string }> {
  return api.post<{ success: boolean; playlistName?: string }>(
    `/api/playlists/${listId}`,
    { service: 'tidal' }
  );
}

/**
 * Check if a Tidal playlist already exists for a list.
 */
export async function checkTidalPlaylist(
  listId: string
): Promise<{ exists: boolean; playlistName: string }> {
  return api.post<{ exists: boolean; playlistName: string }>(
    `/api/playlists/${listId}`,
    { action: 'check', service: 'tidal' }
  );
}
