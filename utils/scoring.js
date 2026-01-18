/**
 * Position-based points for weighted aggregation and export
 *
 * This is the single source of truth for position scoring.
 * Used by:
 * - aggregate-list.js (aggregation calculations)
 * - user-preferences.js (user preference calculations)
 * - routes/api/lists.js (export functionality)
 *
 * Scoring system: Position 1 = 60 points, decreasing to position 40 = 1 point
 * Positions beyond 40 receive 0 points (not eligible for scoring)
 */
const POSITION_POINTS = {
  1: 60,
  2: 54,
  3: 50,
  4: 46,
  5: 43,
  6: 40,
  7: 38,
  8: 36,
  9: 34,
  10: 32,
  11: 30,
  12: 29,
  13: 28,
  14: 27,
  15: 26,
  16: 25,
  17: 24,
  18: 23,
  19: 22,
  20: 21,
  21: 20,
  22: 19,
  23: 18,
  24: 17,
  25: 16,
  26: 15,
  27: 14,
  28: 13,
  29: 12,
  30: 11,
  31: 10,
  32: 9,
  33: 8,
  34: 7,
  35: 6,
  36: 5,
  37: 4,
  38: 3,
  39: 2,
  40: 1,
};

/**
 * Get points for a position
 * @param {number} position - The position (1-based)
 * @param {number} defaultValue - Value to return for positions beyond 40 (default: 0)
 * @returns {number} - Points for the position
 */
function getPositionPoints(position, defaultValue = 0) {
  return POSITION_POINTS[position] ?? defaultValue;
}

/**
 * Get points for a position (legacy alias with default of 1 for export compatibility)
 * @param {number} position - The position (1-based)
 * @returns {number} - Points for the position (minimum 1)
 */
function getPointsForPosition(position) {
  return POSITION_POINTS[position] || 1;
}

module.exports = {
  POSITION_POINTS,
  getPositionPoints,
  getPointsForPosition,
};
