/**
 * Playback utilities - matching and device icons.
 *
 * Fuzzy matching algorithm: normalize both strings by lowercasing,
 * trimming, and removing common variations (edition tags, remaster notes).
 * Uses `includes` in both directions to handle substring matching.
 */

/**
 * Normalize a string for fuzzy matching.
 * Strips parenthetical suffixes, remaster/deluxe/edition tags, and
 * normalizes whitespace.
 */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, '') // Remove (foo) and [bar]
    .replace(
      /\s*[-–—:]\s*(remaster|deluxe|expanded|anniversary|bonus|special|edition|version|original|mono|stereo).*/i,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if a list album matches the currently playing album/artist.
 * Uses fuzzy matching to handle variations in naming.
 */
export function isAlbumMatchingPlayback(
  listAlbumName: string,
  listArtistName: string,
  playingAlbumName: string | null,
  playingArtistName: string | null
): boolean {
  if (!playingAlbumName || !playingArtistName) return false;

  const listAlbum = normalizeForMatch(listAlbumName);
  const listArtist = normalizeForMatch(listArtistName);
  const playAlbum = normalizeForMatch(playingAlbumName);
  const playArtist = normalizeForMatch(playingArtistName);

  // Artist must match (bidirectional includes for "Various Artists" etc.)
  const artistMatch =
    listArtist.includes(playArtist) || playArtist.includes(listArtist);
  if (!artistMatch) return false;

  // Album must match (bidirectional for remaster variants)
  return listAlbum.includes(playAlbum) || playAlbum.includes(listAlbum);
}

/**
 * Get a device type icon character for display.
 */
export function getDeviceIcon(deviceType: string | null): string {
  switch (deviceType?.toLowerCase()) {
    case 'computer':
      return '\uD83D\uDCBB'; // laptop
    case 'smartphone':
      return '\uD83D\uDCF1'; // phone
    case 'speaker':
      return '\uD83D\uDD0A'; // speaker
    case 'tv':
      return '\uD83D\uDCFA'; // TV
    default:
      return '\uD83C\uDFB5'; // music note
  }
}
