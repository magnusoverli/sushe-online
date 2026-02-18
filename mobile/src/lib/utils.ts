/**
 * Pure utility functions.
 */

/**
 * Extract the year from a release date string (YYYY-MM-DD or YYYY).
 */
export function extractYear(releaseDate: string): number | null {
  if (!releaseDate) return null;
  const year = parseInt(releaseDate.substring(0, 4), 10);
  return isNaN(year) ? null : year;
}

/**
 * Check if an album's release year mismatches the list's year.
 */
export function isYearMismatch(
  releaseDate: string,
  listYear: number | null
): boolean {
  if (!listYear || !releaseDate) return false;
  const albumYear = extractYear(releaseDate);
  return albumYear !== null && albumYear !== listYear;
}

/**
 * Format a rank number with leading zero for single digits.
 */
export function formatRank(position: number): string {
  return position < 10 ? `0${position}` : `${position}`;
}

/**
 * Debounce a function call.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Clamp a number between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
