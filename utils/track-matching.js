/**
 * Track Matching Utilities
 *
 * Shared logic for matching a track query (number or name) against a list
 * of tracks. Used by both Spotify and Tidal track search endpoints.
 */

/**
 * Try to match a track by number (1-based index).
 *
 * @param {Array<{id: string}>} tracks - Array of track objects with at least an `id` property
 * @param {string} trackQuery - The track query string (could be a number like "3")
 * @returns {{id: string}|null} - Matched track or null
 */
function matchTrackByNumber(tracks, trackQuery) {
  const trackNum = parseInt(trackQuery);
  if (!isNaN(trackNum) && trackNum > 0 && trackNum <= tracks.length) {
    return tracks[trackNum - 1];
  }
  return null;
}

/**
 * Extract a track name from a formatted string like "3. Track Name" or "3 - Track Name".
 * If the string doesn't match the pattern, returns the original string.
 *
 * @param {string} trackQuery - The track query string
 * @returns {string} - Extracted track name
 */
function extractTrackName(trackQuery) {
  const match = trackQuery.match(/^\d+[.\s-]*\s*(.+)$/);
  return match ? match[1] : trackQuery;
}

/**
 * Find a track by case-insensitive name matching.
 * Checks for exact match, then "includes" in both directions.
 *
 * @param {Array<{id: string, name: string}>} tracks - Tracks with name property
 * @param {string} searchName - Name to search for
 * @returns {{id: string, name: string}|null} - Matched track or null
 */
function matchTrackByName(tracks, searchName) {
  const lower = searchName.toLowerCase();
  return (
    tracks.find(
      (t) =>
        t.name &&
        (t.name.toLowerCase() === lower ||
          t.name.toLowerCase().includes(lower) ||
          lower.includes(t.name.toLowerCase()))
    ) || null
  );
}

module.exports = {
  matchTrackByNumber,
  extractTrackName,
  matchTrackByName,
};
