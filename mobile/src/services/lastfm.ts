/**
 * Last.fm Service - API calls for Last.fm scrobbling and discovery.
 */

import { api } from './api-client';

// ── Types ──

export interface SimilarArtist {
  name: string;
  match: string;
  url: string;
  image: string;
}

// ── API Calls ──

/**
 * Scrobble a track to Last.fm.
 */
export async function scrobble(params: {
  artist: string;
  track: string;
  album?: string;
  duration?: number;
  timestamp?: number;
}): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>('/api/lastfm/scrobble', params);
}

/**
 * Update "now playing" on Last.fm.
 */
export async function updateNowPlaying(params: {
  artist: string;
  track: string;
  album?: string;
  duration?: number;
}): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>('/api/lastfm/now-playing', params);
}

/**
 * Get similar artists from Last.fm.
 */
export async function getSimilarArtists(
  artist: string,
  limit = 20
): Promise<{ artists: SimilarArtist[] }> {
  return api.get<{ artists: SimilarArtist[] }>(
    `/api/lastfm/similar-artists?artist=${encodeURIComponent(artist)}&limit=${limit}`
  );
}
