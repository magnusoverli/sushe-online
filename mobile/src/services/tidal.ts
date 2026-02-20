/**
 * Tidal Service - API calls and helpers for Tidal integration.
 */

import { api } from './api-client';

/**
 * Open a Tidal search page for the given artist + album in a new tab.
 */
export function openInTidal(artist: string, album: string): void {
  const query = encodeURIComponent(`${artist} ${album}`);
  window.open(`https://tidal.com/search?q=${query}`, '_blank');
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
