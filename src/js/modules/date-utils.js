/**
 * Date Utilities Module
 *
 * Handles date parsing, formatting, and validation for release dates.
 * Supports multiple date formats (ISO, MM/DD/YYYY, DD/MM/YYYY) and
 * respects user preferences.
 *
 * @module date-utils
 */

/**
 * Extract year from a release date string (various formats)
 * @param {string} dateStr - Date string in various formats
 * @returns {number|null} Year as integer or null if parsing fails
 */
export function extractYearFromDate(dateStr) {
  if (!dateStr) return null;

  // Year only (e.g., "2024")
  if (/^\d{4}$/.test(dateStr)) {
    return parseInt(dateStr, 10);
  }

  // ISO format: YYYY-MM-DD or YYYY-MM
  if (/^\d{4}-/.test(dateStr)) {
    return parseInt(dateStr.substring(0, 4), 10);
  }

  // MM/DD/YYYY or DD/MM/YYYY format
  const slashMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    return parseInt(slashMatch[3], 10);
  }

  // MM/YYYY format (month/year)
  const monthYearMatch = dateStr.match(/(\d{1,2})\/(\d{4})/);
  if (monthYearMatch) {
    return parseInt(monthYearMatch[2], 10);
  }

  return null;
}

/**
 * Check if release date year matches list year
 * @param {string} releaseDate - Release date string
 * @param {number} listYear - List year to compare against
 * @returns {boolean} True if years don't match, false otherwise
 */
export function isYearMismatch(releaseDate, listYear) {
  if (!listYear) return false; // No list year set, no mismatch possible
  if (!releaseDate) return false; // No release date, no mismatch

  const releaseYear = extractYearFromDate(releaseDate);
  if (!releaseYear) return false; // Couldn't parse year

  return releaseYear !== listYear;
}

/**
 * Convert various date formats to ISO YYYY-MM-DD for date input fields
 * @param {string} dateStr - Date string in various formats
 * @param {string} [userFormat] - User's preferred date format (defaults to window.currentUser?.dateFormat)
 * @returns {string} ISO date string (YYYY-MM-DD) or empty string if parsing fails
 */
export function normalizeDateForInput(dateStr, userFormat = null) {
  if (!dateStr) return '';

  const format = userFormat ?? window.currentUser?.dateFormat;

  // Year only
  if (/^\d{4}$/.test(dateStr)) {
    return `${dateStr}-01-01`;
  }

  // Year-month
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    return `${dateStr}-01`;
  }

  // ISO already
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Formats like DD/MM/YYYY or MM/DD/YYYY or with dashes
  const parts = dateStr.split(/[/-]/);
  if (
    parts.length === 3 &&
    /^\d{1,2}$/.test(parts[0]) &&
    /^\d{1,2}$/.test(parts[1]) &&
    /^\d{4}$/.test(parts[2])
  ) {
    const first = parseInt(parts[0], 10);
    const second = parseInt(parts[1], 10);
    const year = parts[2];
    let day, month;
    if (first > 12) {
      day = first;
      month = second;
    } else if (second > 12) {
      month = first;
      day = second;
    } else if (format === 'DD/MM/YYYY') {
      day = first;
      month = second;
    } else {
      month = first;
      day = second;
    }
    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  }

  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }

  return '';
}

/**
 * Standardize date formats for release dates (for display)
 * @param {string} dateStr - Date string in various formats
 * @param {string} [userFormat] - User's preferred date format (defaults to window.currentUser?.dateFormat)
 * @returns {string} Formatted date string for display
 */
export function formatReleaseDate(dateStr, userFormat = null) {
  if (!dateStr) return '';

  const format =
    userFormat ??
    (typeof window !== 'undefined' ? window.currentUser?.dateFormat : null) ??
    'MM/DD/YYYY';

  // Year only
  if (/^\d{4}$/.test(dateStr)) {
    return dateStr;
  }

  // Year-month
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    const [year, month] = dateStr.split('-');
    return `${month}/${year}`;
  }

  const iso = normalizeDateForInput(dateStr, format);
  if (!iso) return dateStr;

  const [year, month, day] = iso.split('-');

  if (format === 'DD/MM/YYYY') {
    return `${day}/${month}/${year}`;
  }
  return `${month}/${day}/${year}`;
}

/**
 * Convert YYYY-MM-DD to the user's preferred format (for storage/display)
 * @param {string} isoDate - ISO date string (YYYY-MM-DD)
 * @param {string} [userFormat] - User's preferred date format (defaults to window.currentUser?.dateFormat)
 * @returns {string} Date in user's preferred format
 */
export function formatDateForStorage(isoDate, userFormat = null) {
  if (!isoDate) return '';
  const format =
    userFormat ??
    (typeof window !== 'undefined' ? window.currentUser?.dateFormat : null) ??
    'MM/DD/YYYY';
  const [year, month, day] = isoDate.split('-');
  if (format === 'DD/MM/YYYY') {
    return `${day}/${month}/${year}`;
  }
  return `${month}/${day}/${year}`;
}
