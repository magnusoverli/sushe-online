/**
 * Albums Service - API calls for album operations.
 */

import { api } from './api-client';

/**
 * Get album cover image URL (for <img> src).
 */
export function getAlbumCoverUrl(albumId: string): string {
  return `/api/albums/${encodeURIComponent(albumId)}/cover`;
}

/**
 * Get album summary.
 */
export async function getAlbumSummary(
  albumId: string
): Promise<{ summary: string; summarySource: string }> {
  return api.get(`/api/albums/${encodeURIComponent(albumId)}/summary`);
}

/**
 * Update album country.
 */
export async function updateAlbumCountry(
  albumId: string,
  country: string | null
): Promise<{ success: boolean }> {
  return api.patch(`/api/albums/${encodeURIComponent(albumId)}/country`, {
    country,
  });
}

/**
 * Update album genres.
 */
export async function updateAlbumGenres(
  albumId: string,
  genres: { genre_1?: string; genre_2?: string }
): Promise<{ success: boolean }> {
  return api.patch(`/api/albums/${encodeURIComponent(albumId)}/genres`, genres);
}

/**
 * Update album comment.
 */
export async function updateAlbumComment(
  listId: string,
  identifier: string,
  comment: string | null
): Promise<{ success: boolean }> {
  return api.patch(
    `/api/lists/${listId}/items/${encodeURIComponent(identifier)}/comment`,
    { comment }
  );
}

/**
 * Update album comment 2.
 */
export async function updateAlbumComment2(
  listId: string,
  identifier: string,
  comment: string | null
): Promise<{ success: boolean }> {
  return api.patch(
    `/api/lists/${listId}/items/${encodeURIComponent(identifier)}/comment2`,
    { comment }
  );
}
