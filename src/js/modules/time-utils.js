/**
 * Time Formatting Utilities
 *
 * Consolidated time formatting functions for consistent display
 * across the application (track times, player UI, etc.)
 */

/**
 * Format milliseconds to MM:SS display format
 * @param {number} ms - Time in milliseconds
 * @returns {string} Formatted time string (e.g., "3:45" or "0:00" for invalid input)
 */
export function formatTime(ms) {
  if (!ms || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Alias for formatTime - used for track duration display
 * Kept for backward compatibility with existing code
 * @param {number} ms - Time in milliseconds
 * @returns {string} Formatted time string
 */
export const formatTrackTime = formatTime;
