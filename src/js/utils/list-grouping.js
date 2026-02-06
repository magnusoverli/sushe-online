/**
 * List grouping utility.
 * Groups lists by year for use in submenus and mobile sheets.
 */

/**
 * Group lists by year.
 *
 * @param {Object} lists - Lists object keyed by ID, each with optional year property
 * @param {Object} [options={}] - Options
 * @param {string} [options.excludeListId] - List ID to exclude (e.g., current list for move operations)
 * @param {boolean} [options.includeWithoutYear=false] - Whether to include lists without a year
 * @param {boolean} [options.includeNames=false] - Whether to include list names in the result
 * @returns {{ listsByYear: Object, sortedYears: string[], listsWithoutYear?: Array }}
 */
export function groupListsByYear(lists, options = {}) {
  const {
    excludeListId,
    includeWithoutYear = false,
    includeNames = false,
  } = options;
  const listsByYear = {};
  const listsWithoutYear = [];

  Object.keys(lists).forEach((listId) => {
    // Skip excluded list
    if (excludeListId && listId === excludeListId) return;

    const meta = lists[listId];
    const year = meta?.year;

    if (year) {
      if (!listsByYear[year]) {
        listsByYear[year] = [];
      }
      if (includeNames) {
        listsByYear[year].push({ id: listId, name: meta?.name || 'Unknown' });
      } else {
        listsByYear[year].push(listId);
      }
    } else if (includeWithoutYear) {
      if (includeNames) {
        listsWithoutYear.push({ id: listId, name: meta?.name || 'Unknown' });
      } else {
        listsWithoutYear.push(listId);
      }
    }
  });

  // Sort years descending
  const sortedYears = Object.keys(listsByYear).sort(
    (a, b) => parseInt(b) - parseInt(a)
  );

  const result = { listsByYear, sortedYears };
  if (includeWithoutYear) {
    result.listsWithoutYear = listsWithoutYear;
  }
  return result;
}
