/**
 * Preferences Service - Fetch and sync user music preferences.
 */

import { api } from './api-client';
import type { PreferencesData } from '@/lib/types';

interface PreferencesResponse {
  data: PreferencesData | null;
}

interface SyncResponse {
  data: { duration: number; errors: string[] };
}

export async function getPreferences(): Promise<PreferencesData | null> {
  const res = await api.get<PreferencesResponse>('/api/preferences');
  return res.data ?? null;
}

export async function syncPreferences(): Promise<{
  duration: number;
  errors: string[];
}> {
  const res = await api.post<SyncResponse>('/api/preferences/sync');
  return res.data;
}
