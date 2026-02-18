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
  primary_track: string | null;
  secondary_track: string | null;
  comments: string;
  comments_2: string;
  tracks: Track[] | null;
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
  year: number | null;
  isYearGroup: boolean;
  listCount: number;
  createdAt: string;
  updatedAt: string;
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
  timeFormat?: string;
  dateFormat?: string;
  musicService?: string | null;
  lastfmUsername?: string | null;
  createdAt?: string;
}

export interface AuthSession {
  authenticated: boolean;
  user: User | null;
  csrfToken: string;
}

/** Recommendation returned from GET /api/recommendations/:year */
export interface Recommendation {
  _id: string;
  album_id: string;
  artist: string;
  album: string;
  release_date: string;
  country: string;
  genre_1: string;
  genre_2: string;
  recommended_by: string;
  recommender_id: string;
  reasoning: string;
  created_at: string;
}

export interface RecommendationsResponse {
  year: number;
  locked: boolean;
  recommendations: Recommendation[];
}

export interface RecommendationStatus {
  year: number;
  locked: boolean;
  hasAccess: boolean;
  count: number;
}

/** System stats from GET /api/stats */
export interface SystemStats {
  totalUsers: number;
  totalLists: number;
  totalAlbums: number;
  adminUsers: number;
  activeUsers: number;
}

/** Admin stats with user list from GET /api/admin/stats */
export interface AdminStats extends SystemStats {
  users: AdminUserInfo[];
}

export interface AdminUserInfo {
  _id: string;
  username: string;
  email: string;
  role: string;
  listCount: number;
  lastActivity: string | null;
  createdAt: string | null;
}

/** Admin event from GET /api/admin/events */
export interface AdminEvent {
  _id: string;
  type: string;
  priority: string;
  status: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AdminEventCounts {
  [priority: string]: number;
}

export type SettingsCategory =
  | 'account'
  | 'integrations'
  | 'visual'
  | 'stats'
  | 'admin';

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

/** Sort options for the album list */
export type AlbumSortKey =
  | 'custom'
  | 'artist'
  | 'title'
  | 'year'
  | 'genre'
  | 'country';
