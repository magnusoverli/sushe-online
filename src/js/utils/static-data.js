/**
 * Static data parsing utility.
 * Parses newline-separated text files into sorted arrays with optional empty-first entry.
 */

/**
 * Parse a newline-separated text string into a sorted, trimmed, filtered array.
 * Keeps the first empty string (if present) at the top of the sorted result.
 *
 * @param {string} text - Newline-separated text
 * @returns {string[]} Parsed and sorted array
 */
export function parseStaticList(text) {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s, index) => {
      // Keep the first empty line if it exists, but remove other empty lines
      return s.length > 0 || (index === 0 && s === '');
    })
    .sort((a, b) => {
      // Keep empty string at top if it exists
      if (a === '') return -1;
      if (b === '') return 1;
      return a.localeCompare(b);
    });
}
