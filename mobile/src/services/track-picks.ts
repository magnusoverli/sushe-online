/**
 * Track Picks Service - API calls for track selection operations.
 */

import { api } from './api-client';

export interface TrackPickResponse {
  success: boolean;
  listItemId: string;
  primary_track: string;
  secondary_track: string;
}

/**
 * Set or update a track pick.
 */
export async function setTrackPick(
  listItemId: string,
  trackIdentifier: string,
  priority: 1 | 2
): Promise<TrackPickResponse> {
  return api.post<TrackPickResponse>(`/api/track-picks/${listItemId}`, {
    trackIdentifier,
    priority,
  });
}

/**
 * Remove track pick(s).
 */
export async function removeTrackPick(
  listItemId: string,
  trackIdentifier?: string
): Promise<TrackPickResponse> {
  return api.delete<TrackPickResponse>(`/api/track-picks/${listItemId}`, {
    trackIdentifier,
  });
}
