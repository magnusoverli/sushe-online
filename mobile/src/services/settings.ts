/**
 * Settings Service - User settings management.
 *
 * The settings endpoints at /settings/update-* accept JSON bodies
 * and return { success: true } or { error: "..." }.
 */

import { api } from './api-client';
import type {
  SystemStats,
  AdminStats,
  AdminEvent,
  DuplicateScanResponse,
  ManualAlbumAuditResponse,
  TelegramStatus,
  TelegramRecsStatus,
} from '@/lib/types';

// ── Simple setting updates ──

export async function updateAccentColor(
  accentColor: string
): Promise<{ success: boolean }> {
  return api.post('/settings/update-accent-color', { accentColor });
}

export async function updateTimeFormat(
  timeFormat: string
): Promise<{ success: boolean }> {
  return api.post('/settings/update-time-format', { timeFormat });
}

export async function updateDateFormat(
  dateFormat: string
): Promise<{ success: boolean }> {
  return api.post('/settings/update-date-format', { dateFormat });
}

export async function updateMusicService(
  musicService: string | null
): Promise<{ success: boolean }> {
  return api.post('/settings/update-music-service', { musicService });
}

// ── Unique field updates ──

export async function updateEmail(
  email: string
): Promise<{ success: boolean }> {
  return api.post('/settings/update-email', { email });
}

export async function updateUsername(
  username: string
): Promise<{ success: boolean }> {
  return api.post('/settings/update-username', { username });
}

// ── Password ──

export async function changePassword(data: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<{ success: boolean }> {
  return api.post('/settings/change-password', data);
}

// ── Admin access ──

export async function requestAdmin(
  code: string
): Promise<{ success: boolean }> {
  return api.post('/settings/request-admin', { code });
}

// ── Stats ──

export async function getSystemStats(): Promise<SystemStats> {
  return api.get('/api/stats');
}

export async function getAdminStats(): Promise<AdminStats> {
  return api.get('/api/admin/stats');
}

export async function getAdminStatus(): Promise<{
  isAdmin: boolean;
  codeValid: boolean;
}> {
  return api.get('/api/admin/status');
}

// ── Admin events ──

export async function getAdminEvents(
  limit = 50,
  offset = 0
): Promise<{ events: AdminEvent[]; total: number }> {
  return api.get(`/api/admin/events?limit=${limit}&offset=${offset}`);
}

export async function getAdminEventCounts(): Promise<Record<string, number>> {
  return api.get('/api/admin/events/counts');
}

export async function executeEventAction(
  eventId: string,
  action: string
): Promise<{ success: boolean }> {
  return api.post(`/api/admin/events/${eventId}/action/${action}`);
}

// ── Admin user management ──

export async function makeAdmin(userId: string): Promise<{ success: boolean }> {
  return api.post('/admin/make-admin', { userId });
}

export async function revokeAdmin(
  userId: string
): Promise<{ success: boolean }> {
  return api.post('/admin/revoke-admin', { userId });
}

export async function deleteUser(
  userId: string
): Promise<{ success: boolean }> {
  return api.post('/admin/delete-user', { userId });
}

// ── Admin: Duplicate Scanner ──

export async function scanDuplicates(
  threshold = 0.15
): Promise<DuplicateScanResponse> {
  return api.get(`/admin/api/scan-duplicates?threshold=${threshold}`);
}

export async function mergeAlbums(
  keepAlbumId: string,
  deleteAlbumId: string
): Promise<{
  success: boolean;
  listItemsUpdated: number;
  metadataMerged: boolean;
}> {
  return api.post('/admin/api/merge-albums', { keepAlbumId, deleteAlbumId });
}

export async function markAlbumsDistinct(
  albumId1: string,
  albumId2: string
): Promise<{ success: boolean }> {
  return api.post('/api/albums/mark-distinct', {
    album_id_1: albumId1,
    album_id_2: albumId2,
  });
}

// ── Admin: Manual Album Audit ──

export async function auditManualAlbums(
  threshold = 0.15
): Promise<ManualAlbumAuditResponse> {
  return api.get(`/api/admin/audit/manual-albums?threshold=${threshold}`);
}

export async function mergeManualAlbum(
  manualAlbumId: string,
  canonicalAlbumId: string
): Promise<{ success: boolean; updatedListItems: number }> {
  return api.post('/api/admin/audit/merge-album', {
    manualAlbumId,
    canonicalAlbumId,
  });
}

// ── Admin: Recommendation Lock ──

export async function getRecommendationYearsAdmin(): Promise<{
  years: number[];
}> {
  return api.get('/api/recommendations/years');
}

export async function getLockedRecommendationYears(): Promise<{
  years: number[];
}> {
  return api.get('/api/recommendations/locked-years');
}

export async function lockRecommendationYear(
  year: number
): Promise<{ success: boolean; locked: boolean }> {
  return api.post(`/api/recommendations/${year}/lock`);
}

export async function unlockRecommendationYear(
  year: number
): Promise<{ success: boolean; locked: boolean }> {
  return api.post(`/api/recommendations/${year}/unlock`);
}

// ── Admin: Telegram Configuration ──

export async function getTelegramStatus(): Promise<TelegramStatus> {
  return api.get('/api/admin/telegram/status');
}

export async function getTelegramRecsStatus(): Promise<TelegramRecsStatus> {
  return api.get('/api/admin/telegram/recommendations/status');
}

export async function sendTelegramTest(): Promise<{
  success: boolean;
  messageId?: number;
}> {
  return api.post('/api/admin/telegram/test');
}

export async function toggleTelegramRecs(
  enabled: boolean
): Promise<{ success: boolean; enabled: boolean }> {
  return api.post('/api/admin/telegram/recommendations/toggle', { enabled });
}

export async function disconnectTelegram(): Promise<{ success: boolean }> {
  return api.delete('/api/admin/telegram/disconnect');
}

// ── Admin: Aggregate Lists ──

export async function getAggregateYears(): Promise<{
  years: number[];
}> {
  return api.get('/api/aggregate-list-years/with-main-lists');
}

export async function getAggregateStatus(year: number): Promise<{
  revealed: boolean;
  confirmations: number;
  requiredConfirmations: number;
  locked: boolean;
}> {
  return api.get(`/api/aggregate-list/${year}/status`);
}

export async function getAggregateStats(year: number): Promise<{
  totalAlbums: number;
  totalContributors: number;
  totalVotes: number;
}> {
  return api.get(`/api/aggregate-list/${year}/stats`);
}

export async function confirmAggregateReveal(
  year: number
): Promise<{ success: boolean }> {
  return api.post(`/api/aggregate-list/${year}/confirm`);
}

export async function revokeAggregateConfirmation(
  year: number
): Promise<{ success: boolean }> {
  return api.delete(`/api/aggregate-list/${year}/confirm`);
}

export async function resetAggregateReveal(
  year: number
): Promise<{ success: boolean }> {
  return api.delete(`/api/aggregate-list/${year}/reset-seen`);
}

export async function recomputeAggregate(
  year: number
): Promise<{ success: boolean }> {
  return api.post(`/api/aggregate-list/${year}/recompute`);
}

export async function lockAggregateYear(
  year: number
): Promise<{ success: boolean }> {
  return api.post(`/api/aggregate-list/${year}/lock`);
}

export async function unlockAggregateYear(
  year: number
): Promise<{ success: boolean }> {
  return api.post(`/api/aggregate-list/${year}/unlock`);
}

// ── Admin: Re-identify Album ──

export async function reidentifySearch(
  artist: string,
  album: string,
  currentAlbumId: string
): Promise<{
  success: boolean;
  candidates: ReidentifyCandidate[];
  currentMatch?: ReidentifyCandidate;
}> {
  return api.post('/api/admin/album/reidentify/search', {
    artist,
    album,
    currentAlbumId,
  });
}

export interface ReidentifyCandidate {
  id: string;
  title: string;
  artist: string;
  date?: string;
  country?: string;
  type?: string;
  score?: number;
}

export async function applyReidentification(
  currentAlbumId: string,
  newAlbumId: string,
  artist: string,
  album: string
): Promise<{ success: boolean }> {
  return api.post('/api/admin/album/reidentify', {
    currentAlbumId,
    newAlbumId,
    artist,
    album,
  });
}

// ── Link Preview ──

export async function unfurlUrl(
  url: string
): Promise<{ title: string; description: string; image: string }> {
  return api.get(`/api/unfurl?url=${encodeURIComponent(url)}`);
}
