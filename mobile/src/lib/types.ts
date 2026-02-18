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
  id: string;
  event_type: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  data: Record<string, unknown>;
  actions: { id: string; label: string }[];
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_via: string | null;
}

export interface AdminEventCounts {
  [priority: string]: number;
}

export type SettingsCategory =
  | 'account'
  | 'integrations'
  | 'visual'
  | 'preferences'
  | 'stats'
  | 'admin';

export interface PreferencesData {
  topGenres: { name: string; count: number; points: number }[];
  topArtists: { name: string; count: number; points: number }[];
  topCountries: { name: string; count: number; points: number }[];
  totalAlbums: number;
  spotify: SpotifyPreferences | null;
  lastfm: LastfmPreferences | null;
  affinity: {
    genres: AffinityItem[];
    artists: AffinityItem[];
  };
  updatedAt: string;
}

export interface SpotifyPreferences {
  topArtists: Record<string, SpotifyArtistItem[]>;
  topTracks: Record<string, SpotifyTrackItem[]>;
  syncedAt: string;
}

export interface LastfmPreferences {
  topArtists: Record<string, LastfmArtistItem[]>;
  totalScrobbles: number;
  syncedAt: string;
}

export interface SpotifyArtistItem {
  name: string;
  genres?: string[];
}

export interface SpotifyTrackItem {
  name: string;
  artist: string;
}

export interface LastfmArtistItem {
  name: string;
  playcount: number;
}

export interface AffinityItem {
  name: string;
  score: number;
  sources: string[];
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

/** Response from GET /api/lists/setup-status */
export interface SetupStatusList {
  id: string;
  name: string;
}

export interface SetupStatusYearSummary {
  year: number;
  hasMain: boolean;
  lists: { id: string; name: string; isMain: boolean }[];
}

export interface SetupStatus {
  needsSetup: boolean;
  listsWithoutYear: SetupStatusList[];
  yearsNeedingMain: number[];
  yearsSummary: SetupStatusYearSummary[];
  dismissedUntil: string | null;
}

/** Sort options for the album list */
export type AlbumSortKey =
  | 'custom'
  | 'artist'
  | 'title'
  | 'year'
  | 'genre'
  | 'country';

// ── Admin: Duplicate Scanner types ──

/** A single album in a duplicate pair from the scan endpoint */
export interface DuplicateAlbumInfo {
  album_id: string;
  artist: string;
  album: string;
  release_date: string | null;
  genre_1: string | null;
  genre_2: string | null;
  trackCount: number | null;
  hasCover: boolean;
}

/** A pair of potential duplicates from GET /admin/api/scan-duplicates */
export interface DuplicatePair {
  album1: DuplicateAlbumInfo;
  album2: DuplicateAlbumInfo;
  confidence: number;
  artistScore: number;
  albumScore: number;
}

/** Response from GET /admin/api/scan-duplicates */
export interface DuplicateScanResponse {
  totalAlbums: number;
  potentialDuplicates: number;
  excludedPairs: number;
  pairs: DuplicatePair[];
}

// ── Admin: Manual Album Audit types ──

/** A canonical match candidate for a manual album */
export interface AuditMatchCandidate {
  albumId: string;
  artist: string;
  album: string;
  hasCover: boolean;
  confidence: number;
}

/** Usage info for a manual album */
export interface AuditAlbumUsage {
  listId: string;
  listName: string;
  year: number | null;
  userId: string;
  username: string;
}

/** A manual album with its potential canonical matches */
export interface AuditManualAlbum {
  manualId: string;
  artist: string;
  album: string;
  hasCover: boolean;
  usedIn: AuditAlbumUsage[];
  matches: AuditMatchCandidate[];
}

/** An integrity issue found during audit */
export interface AuditIntegrityIssue {
  type: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  albumId?: string;
  artist?: string;
  album?: string;
  normalizedKey?: string;
  usedIn?: AuditAlbumUsage[];
  duplicates?: {
    manualId: string;
    artist: string;
    album: string;
    usedIn: AuditAlbumUsage[];
  }[];
  fixAction?: string;
}

/** Response from GET /api/admin/audit/manual-albums */
export interface ManualAlbumAuditResponse {
  manualAlbums: AuditManualAlbum[];
  totalManual: number;
  totalWithMatches: number;
  integrityIssues: AuditIntegrityIssue[];
  totalIntegrityIssues: number;
}

// ── Admin: Aggregate List types ──

export interface AggregateYearInfo {
  year: number;
  revealed: boolean;
  confirmations: number;
  requiredConfirmations: number;
  locked: boolean;
  totalAlbums: number;
  totalContributors: number;
  totalVotes: number;
}

// ── Admin: Telegram types ──

export interface TelegramStatus {
  configured: boolean;
  enabled?: boolean;
  chatId?: string;
  chatTitle?: string;
  threadId?: string;
  topicName?: string;
  configuredAt?: string;
}

export interface TelegramRecsStatus {
  configured: boolean;
  recommendationsEnabled: boolean;
  chatTitle?: string | null;
  threads?: unknown[];
}
