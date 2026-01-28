/**
 * Year Lock Utilities
 *
 * Frontend helpers for checking year lock status and handling locked year UI
 */

import { apiCall } from './utils.js';

/**
 * Fetch list of all locked years
 * @returns {Promise<number[]>} Array of locked year numbers
 */
export async function fetchLockedYears() {
  try {
    const response = await apiCall('/api/locked-years');
    return response.years || [];
  } catch (err) {
    console.error('Error fetching locked years:', err);
    return [];
  }
}

/**
 * Check if a specific year is locked
 * @param {number|null} year - Year to check
 * @returns {Promise<boolean>} True if year is locked, false otherwise
 */
export async function checkYearLocked(year) {
  if (!year) return false;

  try {
    const response = await apiCall(`/api/aggregate-list/${year}/status`);
    return response.locked || false;
  } catch (err) {
    console.error('Error checking year lock:', err);
    return false;
  }
}

/**
 * Cache for locked years to reduce API calls
 */
let lockedYearsCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 30000; // 30 seconds

/**
 * Get locked years from cache or fetch if expired
 * @returns {Promise<number[]>} Array of locked year numbers
 */
export async function getLockedYears() {
  const now = Date.now();
  if (lockedYearsCache && now - cacheTimestamp < CACHE_DURATION) {
    return lockedYearsCache;
  }

  lockedYearsCache = await fetchLockedYears();
  cacheTimestamp = now;
  return lockedYearsCache;
}

/**
 * Invalidate the locked years cache
 * Call this after locking/unlocking a year
 */
export function invalidateLockedYearsCache() {
  lockedYearsCache = null;
  cacheTimestamp = 0;
}

/**
 * Check if a year is locked (using cache)
 * @param {number|null} year - Year to check
 * @returns {Promise<boolean>} True if year is locked
 */
export async function isYearLocked(year) {
  if (!year) return false;

  const lockedYears = await getLockedYears();
  return lockedYears.includes(year);
}
