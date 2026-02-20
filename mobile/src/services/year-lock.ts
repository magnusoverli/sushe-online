/**
 * Year Lock Service - Checks whether years are locked.
 *
 * Uses GET /api/locked-years which returns all locked years at once.
 * Results are cached in-memory for 30 seconds to reduce API calls.
 */

import { api } from './api-client';

interface LockedYearsResponse {
  years: number[];
}

let cachedYears: Set<number> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000;

/**
 * Fetch all locked years from the API, using a 30-second in-memory cache.
 */
export async function getLockedYears(): Promise<Set<number>> {
  const now = Date.now();
  if (cachedYears && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedYears;
  }

  const data = await api.get<LockedYearsResponse>('/api/locked-years');
  cachedYears = new Set(data.years);
  cacheTimestamp = now;
  return cachedYears;
}

/**
 * Check if a specific year is locked.
 * Returns false for null/undefined years.
 */
export async function checkYearLock(year: number | null): Promise<boolean> {
  if (year == null) return false;
  const locked = await getLockedYears();
  return locked.has(year);
}

/**
 * Clear the in-memory cache (useful after admin lock/unlock actions).
 */
export function clearYearLockCache(): void {
  cachedYears = null;
  cacheTimestamp = 0;
}

// Exported for testing
export const _testHelpers = {
  getCacheState: () => ({ cachedYears, cacheTimestamp }),
  setCacheState: (years: Set<number> | null, timestamp: number) => {
    cachedYears = years;
    cacheTimestamp = timestamp;
  },
};
