import {
  formatReleaseDate,
  isYearMismatch,
  extractYearFromDate,
} from '../date-utils.js';

export function formatPlaycount(count) {
  if (count === null || count === undefined) return '';
  if (count === 0) return '0';
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

export function formatPlaycountDisplay(playcount, status) {
  if (status === null || status === undefined) {
    return { html: '', isNotFound: false, isEmpty: true };
  }

  if (status === 'not_found') {
    return { html: '', isNotFound: true, isEmpty: false };
  }

  if (status === 'error') {
    return { html: '', isNotFound: false, isEmpty: true };
  }

  const formatted = formatPlaycount(playcount);
  return { html: formatted, isNotFound: false, isEmpty: !formatted };
}

export function createAlbumDataProcessor(deps = {}) {
  const {
    getCurrentList,
    getListMetadata,
    getTrackName,
    getTrackLength,
    formatTrackTime,
    getPlaycountCacheEntry,
  } = deps;

  function processTrackPick(trackIdentifier, tracks) {
    if (!trackIdentifier) {
      return { display: '', class: 'text-gray-800 italic', duration: '' };
    }

    if (tracks && Array.isArray(tracks)) {
      const trackMatch = tracks.find(
        (track) => getTrackName(track) === trackIdentifier
      );
      if (trackMatch) {
        const trackName = getTrackName(trackMatch);
        const match = trackName.match(/^(\d+)[.\s-]?\s*(.*)$/);
        let display;
        if (match) {
          const trackNum = match[1];
          const displayName = match[2] || '';
          display = displayName
            ? `${trackNum}. ${displayName}`
            : `Track ${trackNum}`;
        } else {
          display = trackName;
        }
        const length = getTrackLength(trackMatch);
        const duration = formatTrackTime(length);
        return { display, class: 'text-gray-300', duration };
      }

      if (trackIdentifier.match(/^\d+$/)) {
        return {
          display: `Track ${trackIdentifier}`,
          class: 'text-gray-300',
          duration: '',
        };
      }

      return {
        display: trackIdentifier,
        class: 'text-gray-300',
        duration: '',
      };
    }

    if (trackIdentifier.match(/^\d+$/)) {
      return {
        display: `Track ${trackIdentifier}`,
        class: 'text-gray-300',
        duration: '',
      };
    }

    return {
      display: trackIdentifier,
      class: 'text-gray-300',
      duration: '',
    };
  }

  function processAlbumData(album, index) {
    const currentList = getCurrentList();
    const albumId = album.album_id || '';
    const albumName = album.album || 'Unknown Album';
    const artist = album.artist || 'Unknown Artist';
    const rawReleaseDate = album.release_date || '';
    const releaseDate = formatReleaseDate(rawReleaseDate);

    const listMeta = getListMetadata(currentList);
    const listYear = listMeta?.year || null;

    const isMain = listMeta?.isMain || false;
    const position = isMain ? index + 1 : null;
    const yearMismatch = isYearMismatch(rawReleaseDate, listYear);
    const releaseYear = extractYearFromDate(rawReleaseDate);
    const yearMismatchTooltip = yearMismatch
      ? `Release year (${releaseYear}) doesn't match list year (${listYear})`
      : '';

    const country = album.country || '';
    const countryDisplay = country || 'Country';
    const countryClass = country ? 'text-gray-300' : 'text-gray-800 italic';

    const genre1 = album.genre_1 || '';
    const genre1Display = genre1 || 'Genre 1';
    const genre1Class = genre1 ? 'text-gray-300' : 'text-gray-800 italic';

    let genre2 = album.genre_2 || '';
    if (genre2 === 'Genre 2' || genre2 === '-') genre2 = '';
    const genre2Display = genre2 || 'Genre 2';
    const genre2Class = genre2 ? 'text-gray-300' : 'text-gray-800 italic';

    let comment = album.comments || '';
    if (comment === 'Comment') comment = '';

    let comment2 = album.comments_2 || '';
    if (comment2 === 'Comment 2') comment2 = '';

    const coverImageUrl = album.cover_image_url || '';
    const coverImage = album.cover_image || '';
    const imageFormat = album.cover_image_format || 'PNG';

    const primaryTrack = album.primary_track || '';
    const primaryData = processTrackPick(primaryTrack, album.tracks);

    const secondaryTrack = album.secondary_track || '';
    const secondaryData = processTrackPick(secondaryTrack, album.tracks);

    const summary = album.summary || '';
    const summarySource = album.summary_source || album.summarySource || '';

    const recommendedBy = album.recommended_by || null;
    const recommendedAt = album.recommended_at || null;

    const itemId = album._id || '';
    const cachedData = getPlaycountCacheEntry(itemId);
    const playcount = cachedData?.playcount ?? null;
    const playcountStatus = cachedData?.status ?? null;
    const playcountDisplay = formatPlaycountDisplay(playcount, playcountStatus);

    return {
      position,
      albumId,
      albumName,
      artist,
      releaseDate,
      yearMismatch,
      yearMismatchTooltip,
      country,
      countryDisplay,
      countryClass,
      genre1,
      genre1Display,
      genre1Class,
      genre2,
      genre2Display,
      genre2Class,
      comment,
      comment2,
      coverImageUrl,
      coverImage,
      imageFormat,
      primaryTrack,
      primaryTrackDisplay: primaryData.display,
      primaryTrackClass: primaryData.display
        ? primaryData.class
        : 'text-gray-800 italic',
      primaryTrackDuration: primaryData.duration,
      secondaryTrack,
      secondaryTrackDisplay: secondaryData.display,
      secondaryTrackClass: secondaryData.display
        ? secondaryData.class
        : 'text-gray-800 italic',
      secondaryTrackDuration: secondaryData.duration,
      hasSecondaryTrack: !!secondaryTrack,
      itemId,
      playcount,
      playcountStatus,
      playcountDisplay,
      summary,
      summarySource,
      recommendedBy,
      recommendedAt,
    };
  }

  return { processAlbumData };
}
