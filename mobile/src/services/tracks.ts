/**
 * Tracks Service - Fetch album track listings from MusicBrainz.
 */

import { api } from './api-client';
import type { Track } from '@/lib/types';

export interface TracksResponse {
  tracks: Track[];
  releaseId: string;
}

/**
 * Fetch tracks for an album from MusicBrainz.
 * Can look up by MusicBrainz release-group ID, or by artist+album search.
 */
export async function fetchTracks(
  artist: string,
  album: string,
  mbId?: string
): Promise<TracksResponse> {
  const params = new URLSearchParams();
  if (mbId) params.set('id', mbId);
  params.set('artist', artist);
  params.set('album', album);
  return api.get<TracksResponse>(
    `/api/musicbrainz/tracks?${params.toString()}`
  );
}
