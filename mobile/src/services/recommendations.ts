/**
 * Recommendations Service - Recommendation CRUD and management.
 *
 * Uses the JSON API at /api/recommendations/*.
 */

import { api } from './api-client';
import type {
  RecommendationsResponse,
  RecommendationStatus,
} from '@/lib/types';

/** Get all years that have recommendations. */
export async function getRecommendationYears(): Promise<{ years: number[] }> {
  return api.get('/api/recommendations/years');
}

/** Get all locked years. */
export async function getLockedYears(): Promise<{ years: number[] }> {
  return api.get('/api/recommendations/locked-years');
}

/** Get all recommendations for a given year. */
export async function getRecommendations(
  year: number
): Promise<RecommendationsResponse> {
  return api.get(`/api/recommendations/${year}`);
}

/** Get the status (locked, access, count) for a year. */
export async function getRecommendationStatus(
  year: number
): Promise<RecommendationStatus> {
  return api.get(`/api/recommendations/${year}/status`);
}

/** Add a recommendation for a year. */
export async function addRecommendation(
  year: number,
  album: {
    artist: string;
    album: string;
    release_date?: string;
    country?: string;
    genre_1?: string;
    genre_2?: string;
  },
  reasoning: string
): Promise<{ success: boolean; _id: string; album_id: string; year: number }> {
  return api.post(`/api/recommendations/${year}`, { album, reasoning });
}

/** Edit the reasoning for a recommendation (own only). */
export async function editReasoning(
  year: number,
  albumId: string,
  reasoning: string
): Promise<{ success: boolean }> {
  return api.patch(`/api/recommendations/${year}/${albumId}/reasoning`, {
    reasoning,
  });
}

/** Remove a recommendation (admin only). */
export async function removeRecommendation(
  year: number,
  albumId: string
): Promise<{ success: boolean }> {
  return api.delete(`/api/recommendations/${year}/${albumId}`);
}

/** Lock recommendations for a year (admin only). */
export async function lockYear(
  year: number
): Promise<{ success: boolean; locked: boolean }> {
  return api.post(`/api/recommendations/${year}/lock`);
}

/** Unlock recommendations for a year (admin only). */
export async function unlockYear(
  year: number
): Promise<{ success: boolean; locked: boolean }> {
  return api.post(`/api/recommendations/${year}/unlock`);
}
