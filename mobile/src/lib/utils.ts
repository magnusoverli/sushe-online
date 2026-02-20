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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => void>(
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

/**
 * Build tag pills array from album fields for display in AlbumCard.
 */
export function buildAlbumTags(album: {
  genre_1?: string;
  genre_2?: string;
  release_date?: string;
  country?: string;
}): string[] {
  const tags: string[] = [];
  if (album.genre_1) tags.push(album.genre_1);
  if (album.genre_2) tags.push(album.genre_2);
  return tags;
}

/**
 * Slugify an artist name for RateYourMusic URLs.
 *
 * Matches the slug logic in the web app's discovery module:
 * lowercase, apostrophes removed, "&" → "and", special chars stripped,
 * spaces → hyphens, collapsed/trimmed.
 */
export function slugifyForRym(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, '') // Remove apostrophes
    .replace(/&/g, 'and') // Replace & with "and"
    .replace(/[^\w\s-]/g, '') // Remove special chars except spaces/hyphens
    .replace(/\s+/g, '-') // Spaces → hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Trim leading/trailing hyphens
}

/**
 * Build a RateYourMusic artist URL from an artist name.
 */
export function getRymArtistUrl(artistName: string): string {
  return `https://rateyourmusic.com/artist/${slugifyForRym(artistName)}`;
}

/**
 * Format a playcount number for compact display.
 * e.g. 0 → "0", 999 → "999", 1500 → "1.5K", 2300000 → "2.3M"
 */
export function formatPlaycount(count: number | null | undefined): string {
  if (count === null || count === undefined) return '';
  if (count === 0) return '0';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

/**
 * Sort albums by the given key. Returns a new array.
 */
export function sortAlbums<
  T extends {
    artist: string;
    album: string;
    release_date: string;
    genre_1: string;
    country: string;
  },
>(albums: T[], sortKey: string): T[] {
  if (sortKey === 'custom') return albums;

  const sorted = [...albums];
  const collator = new Intl.Collator('en', { sensitivity: 'base' });

  sorted.sort((a, b) => {
    switch (sortKey) {
      case 'artist':
        return collator.compare(a.artist, b.artist);
      case 'title':
        return collator.compare(a.album, b.album);
      case 'year':
        return (a.release_date || '').localeCompare(b.release_date || '');
      case 'genre':
        return collator.compare(a.genre_1, b.genre_1);
      case 'country':
        return collator.compare(a.country, b.country);
      default:
        return 0;
    }
  });

  return sorted;
}
