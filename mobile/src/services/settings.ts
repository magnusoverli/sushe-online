/**
 * Settings Service - User settings management.
 *
 * The settings endpoints at /settings/update-* accept JSON bodies
 * and return { success: true } or { error: "..." }.
 */

import { api } from './api-client';
import type { SystemStats, AdminStats, AdminEvent } from '@/lib/types';

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
