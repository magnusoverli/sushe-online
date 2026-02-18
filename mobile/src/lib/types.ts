/**
 * Shared TypeScript types for the mobile app.
 * Mirrors the data shapes returned by the existing API.
 */

export interface Album {
  _id: string;
  artist: string;
  album: string;
  album_id: string;
  release_date: string;
  country: string;
  genre_1: string;
  genre_2: string;
  track_pick: string;
  primary_track: string;
  secondary_track: string;
  comments: string;
  comments_2: string;
  tracks: Track[];
  cover_image_url?: string;
  cover_image?: string;
  cover_image_format: string;
  summary: string;
  summary_source: string;
  recommended_by: string | null;
  recommended_at: string | null;
}

export interface Track {
  title: string;
  position: number;
  length?: number;
}

export interface ListMetadata {
  _id: string;
  name: string;
  year: number | null;
  isMain: boolean;
  count: number;
  groupId: string | null;
  sortOrder: number;
  updatedAt: string;
  createdAt: string;
}

export interface Group {
  _id: string;
  name: string;
  sortOrder: number;
  isYear: boolean;
  year?: number;
}

export interface User {
  _id: string;
  email: string;
  username: string;
  role: string;
  spotifyConnected?: boolean;
  tidalConnected?: boolean;
  lastfmConnected?: boolean;
  accentColor?: string;
}

export interface AuthSession {
  authenticated: boolean;
  user: User | null;
  csrfToken: string;
}

/**
 * API error response shape from the server's sendErrorResponse():
 * { success: false, error: { message: "...", code: "..." } }
 *
 * Some older endpoints may return { error: "string" } directly.
 */
export interface ApiErrorResponse {
  success: false;
  error: string | { message: string; code?: string; type?: string };
}

export interface ListSummaryItem {
  id: string;
  name: string;
  year: number | null;
}
