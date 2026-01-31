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

/**
 * Check if a specific list is locked
 * A list is locked only if the year is locked AND the list is the main list
 * @param {number|null} year - Year to check
 * @param {boolean} isMain - Whether the list is the main list
 * @returns {Promise<boolean>} True if list is locked
 */
export async function isListLocked(year, isMain) {
  if (!year || !isMain) return false;
  return await isYearLocked(year);
}

// ============ RECOMMENDATION LOCK UTILITIES ============

/**
 * Cache for locked recommendation years to reduce API calls
 */
let lockedRecommendationYearsCache = null;
let recommendationCacheTimestamp = 0;

/**
 * Fetch list of all locked recommendation years
 * @returns {Promise<number[]>} Array of locked year numbers
 */
export async function fetchLockedRecommendationYears() {
  try {
    const response = await apiCall('/api/recommendations/locked-years');
    return response.years || [];
  } catch (err) {
    console.error('Error fetching locked recommendation years:', err);
    return [];
  }
}

/**
 * Get locked recommendation years from cache or fetch if expired
 * @returns {Promise<number[]>} Array of locked year numbers
 */
export async function getLockedRecommendationYears() {
  const now = Date.now();
  if (
    lockedRecommendationYearsCache &&
    now - recommendationCacheTimestamp < CACHE_DURATION
  ) {
    return lockedRecommendationYearsCache;
  }

  lockedRecommendationYearsCache = await fetchLockedRecommendationYears();
  recommendationCacheTimestamp = now;
  return lockedRecommendationYearsCache;
}

/**
 * Invalidate the locked recommendation years cache
 * Call this after locking/unlocking recommendations
 */
export function invalidateLockedRecommendationYearsCache() {
  lockedRecommendationYearsCache = null;
  recommendationCacheTimestamp = 0;
}

/**
 * Check if recommendations are locked for a year (using cache)
 * @param {number|null} year - Year to check
 * @returns {Promise<boolean>} True if recommendations are locked
 */
export async function isRecommendationsLocked(year) {
  if (!year) return false;

  const lockedYears = await getLockedRecommendationYears();
  return lockedYears.includes(year);
}

/**
 * Check recommendation status for a year (makes API call for detailed info)
 * @param {number} year - Year to check
 * @returns {Promise<Object>} Status object with locked, hasAccess, count
 */
export async function getRecommendationStatus(year) {
  if (!year) return { locked: false, hasAccess: true, count: 0 };

  try {
    const response = await apiCall(`/api/recommendations/${year}/status`);
    return response;
  } catch (err) {
    console.error('Error fetching recommendation status:', err);
    return { locked: false, hasAccess: true, count: 0 };
  }
}
