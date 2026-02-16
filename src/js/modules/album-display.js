/**
 * Album Display Module
 *
 * Handles rendering and display of albums in both desktop and mobile views.
 * Uses dependency injection for testability and decoupling from global state.
 *
 * @module album-display
 */

import {
  formatReleaseDate,
  isYearMismatch,
  extractYearFromDate,
} from './date-utils.js';
import { escapeHtmlAttr as escapeHtml } from './html-utils.js';
import { isListLocked } from './year-lock.js';
import {
  positionContextMenu,
  hideAllContextMenus as hideAllMenusBase,
} from './context-menu.js';

// Feature flag for incremental updates (can be disabled if issues arise)
const ENABLE_INCREMENTAL_UPDATES = true;

// Module-level state
// Store lightweight fingerprint instead of deep-cloned array for performance
let lastRenderedFingerprint = null;
// Store mutable field fingerprints for detectUpdateType (strings, not objects)
let lastRenderedMutableState = null;
let positionElementCache = new WeakMap();

// Fingerprint cache using WeakMap for automatic garbage collection
// When album arrays are replaced, old fingerprints are automatically cleaned up
const fingerprintCache = new WeakMap();

// Cache all frequently-updated DOM elements per row for faster incremental updates
// Structure: WeakMap<row, { position, artist, country, genre1, genre2, comment, track, releaseDate }>
let rowElementsCache = new WeakMap();

// Lazy loading observer for album cover images
let coverImageObserver = null;

// 1x1 transparent GIF placeholder for lazy loading
const PLACEHOLDER_GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Album cover preview state
let coverPreviewActive = null; // Stores { overlay, clone, originalRect }

/**
 * Initialize the IntersectionObserver for lazy loading cover images
 * Images with data-lazy-src will have their src swapped when visible
 */
function initCoverImageObserver() {
  if (coverImageObserver) return;

  coverImageObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target;
          const lazySrc = img.dataset.lazySrc;
          if (lazySrc) {
            img.src = lazySrc;
            delete img.dataset.lazySrc;
          }
          coverImageObserver.unobserve(img);
        }
      });
    },
    {
      rootMargin: '200px', // Pre-load images 200px before they enter viewport
      threshold: 0,
    }
  );
}

/**
 * Observe all lazy-load images in the container
 * @param {HTMLElement} container - Container with album items
 */
function observeLazyImages(container) {
  if (!coverImageObserver) {
    initCoverImageObserver();
  }

  const lazyImages = container.querySelectorAll('img[data-lazy-src]');
  lazyImages.forEach((img) => {
    coverImageObserver.observe(img);
  });
}

/**
 * Cache DOM element references for a desktop row
 * @param {HTMLElement} row - Row element
 */
function cacheDesktopRowElements(row) {
  const cache = {
    position:
      row.querySelector('[data-position-element="true"]') ||
      row.querySelector('.position-display'),
    albumName: row.querySelector('.font-semibold.text-gray-100'),
    releaseDate: row.querySelector('.release-date-display'),
    artist: row.querySelectorAll('.flex.items-center > span')[0],
    countryCell: row.querySelector('.country-cell'),
    genre1Cell: row.querySelector('.genre-1-cell'),
    genre2Cell: row.querySelector('.genre-2-cell'),
    commentCell: row.querySelector('.comment-cell'),
    comment2Cell: row.querySelector('.comment-2-cell'),
    trackCell: row.querySelector('.track-cell'),
  };

  // Cache the spans inside cells
  if (cache.countryCell) {
    cache.countrySpan = cache.countryCell.querySelector('span');
  }
  if (cache.genre1Cell) {
    cache.genre1Span = cache.genre1Cell.querySelector('span');
  }
  if (cache.genre2Cell) {
    cache.genre2Span = cache.genre2Cell.querySelector('span');
  }
  if (cache.commentCell) {
    cache.commentSpan = cache.commentCell.querySelector('span');
  }
  if (cache.comment2Cell) {
    cache.comment2Span = cache.comment2Cell.querySelector('span');
  }
  if (cache.trackCell) {
    cache.trackSpan = cache.trackCell.querySelector('span');
  }

  rowElementsCache.set(row, cache);
  return cache;
}

/**
 * Cache DOM element references for a mobile card
 * @param {HTMLElement} card - Card element (the inner .album-card, not the wrapper)
 */
function cacheMobileCardElements(card) {
  const cache = {
    position: card.querySelector('[data-position-element="true"]'),
    releaseDate: card.querySelector('.release-date-display'),
    artistText: card.querySelector('[data-field="artist-mobile-text"]'),
    countryText: card.querySelector('[data-field="country-mobile-text"]'),
    genreText: card.querySelector('[data-field="genre-mobile-text"]'),
    trackText: card.querySelector('[data-field="track-mobile-text"]'),
  };

  rowElementsCache.set(card, cache);
  return cache;
}

/**
 * Get cached elements for a row, or create cache if missing
 * @param {HTMLElement} row - Row or card element
 * @param {boolean} isMobile - Whether this is a mobile card
 * @returns {Object} Cached element references
 */
function getCachedElements(row, isMobile) {
  let cache = rowElementsCache.get(row);
  if (!cache) {
    cache = isMobile
      ? cacheMobileCardElements(row)
      : cacheDesktopRowElements(row);
  }
  return cache;
}

/**
 * Generate a lightweight fingerprint string for change detection
 * Only includes mutable fields that trigger UI updates
 * Uses WeakMap cache to avoid recalculating for same array reference
 * @param {Array} albums - Album array
 * @returns {string} Fingerprint string
 */
function generateAlbumFingerprint(albums) {
  if (!albums || albums.length === 0) return '';

  // Check cache first - avoid recalculation for same array reference
  const cached = fingerprintCache.get(albums);
  if (cached !== undefined) {
    return cached;
  }

  // Generate fingerprint
  const fingerprint = albums
    .map(
      (a) =>
        `${a._id || ''}|${a.track_pick || ''}|${a.country || ''}|${a.genre_1 || ''}|${a.genre_2 || ''}|${a.comments || ''}|${a.comments_2 || ''}`
    )
    .join('::');

  // Cache for future calls with same array reference
  fingerprintCache.set(albums, fingerprint);

  return fingerprint;
}

/**
 * Invalidate cached fingerprint for an album array
 * Call this when mutating album data in place
 * @param {Array} albums - Album array to invalidate
 */
function invalidateFingerprint(albums) {
  if (albums) {
    fingerprintCache.delete(albums);
  }
}

/**
 * Generate per-album mutable field strings for change detection.
 * Returns an array of fingerprint strings instead of an array of objects,
 * dramatically reducing GC pressure (primitives vs N 9-property objects).
 * @param {Array} albums - Album array
 * @returns {Array<string>|null} Array of field fingerprint strings
 */
function extractMutableFingerprints(albums) {
  if (!albums || albums.length === 0) return null;
  return albums.map(
    (a) =>
      `${a._id || ''}|${a.artist || ''}|${a.album || ''}|${a.release_date || ''}|${a.country || ''}|${a.genre_1 || ''}|${a.genre_2 || ''}|${a.comments || ''}|${a.comments_2 || ''}|${a.track_pick || ''}`
  );
}

// Last.fm playcount cache: { listItemId: { playcount, status } | null }
// status can be: 'success', 'not_found', 'error', or null (not yet fetched)
let playcountCache = {};
let playcountFetchInProgress = false;

// AbortControllers for active polling sessions (one per list)
const pollingControllers = new Map(); // listId -> AbortController

/**
 * Factory function to create the album display module with injected dependencies
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getListData - Get album array for a list
 * @param {Function} deps.getListMetadata - Get metadata for a list
 * @param {Function} deps.getCurrentList - Get current list name
 * @param {Function} deps.saveList - Save list to server
 * @param {Function} deps.showToast - Show toast notification
 * @param {Function} deps.apiCall - Make API call
 * @param {Function} deps.fetchTracksForAlbum - Fetch tracks for an album
 * @param {Function} deps.makeCountryEditable - Make country cell editable
 * @param {Function} deps.makeGenreEditable - Make genre cell editable
 * @param {Function} deps.makeCommentEditable - Make comment cell editable
 * @param {Function} deps.makeComment2Editable - Make comment 2 cell editable
 * @param {Function} deps.attachLinkPreview - Attach link preview to element
 * @param {Function} deps.showTrackSelectionMenu - Show track selection menu
 * @param {Function} deps.showMobileEditForm - Show mobile edit form
 * @param {Function} deps.showMobileAlbumMenu - Show mobile album menu
 * @param {Function} deps.showMobileSummarySheet - Show mobile summary sheet
 * @param {Function} deps.playTrackSafe - Play track safely by album ID
 * @param {Function} deps.reapplyNowPlayingBorder - Re-apply now playing border
 * @param {Function} deps.initializeUnifiedSorting - Initialize drag-drop sorting
 * @param {Function} deps.destroySorting - Destroy drag-drop sorting instance
 * @param {Function} deps.setContextAlbum - Set context album index and ID for menus
 * @returns {Object} Album display module API
 */
export function createAlbumDisplay(deps = {}) {
  const {
    getListData,
    getListMetadata,
    getCurrentList,
    saveList,
    showToast,
    apiCall,
    fetchTracksForAlbum,
    makeCountryEditable,
    makeGenreEditable,
    makeCommentEditable,
    makeComment2Editable,
    attachLinkPreview,
    showTrackSelectionMenu,
    showMobileEditForm,
    showMobileAlbumMenu,
    showMobileSummarySheet,
    playTrackSafe,
    reapplyNowPlayingBorder,
    initializeUnifiedSorting,
    destroySorting,
    setContextAlbum,
    getTrackName,
    getTrackLength,
    formatTrackTime,
  } = deps;

  /**
   * Process album data into display-ready format
   * @param {Object} album - Raw album data
   * @param {number} index - Album index in list
   * @returns {Object} Processed album data for rendering
   */
  function processAlbumData(album, index) {
    const currentList = getCurrentList();
    const albumId = album.album_id || '';
    const albumName = album.album || 'Unknown Album';
    const artist = album.artist || 'Unknown Artist';
    const rawReleaseDate = album.release_date || '';
    const releaseDate = formatReleaseDate(rawReleaseDate);

    // Check for year mismatch with current list
    const listMeta = getListMetadata(currentList);
    const listYear = listMeta?.year || null;

    // Position/rank only exists for main lists - it has semantic meaning (contributes to aggregate)
    // For non-main lists, position is just array order with no ranking significance
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

    const genre1 = album.genre_1 || album.genre || '';
    const genre1Display = genre1 || 'Genre 1';
    const genre1Class = genre1 ? 'text-gray-300' : 'text-gray-800 italic';

    let genre2 = album.genre_2 || '';
    if (genre2 === 'Genre 2' || genre2 === '-') genre2 = '';
    const genre2Display = genre2 || 'Genre 2';
    const genre2Class = genre2 ? 'text-gray-300' : 'text-gray-800 italic';

    let comment = album.comments || album.comment || '';
    if (comment === 'Comment') comment = '';

    let comment2 = album.comments_2 || '';
    if (comment2 === 'Comment 2') comment2 = '';

    // Support both URL-based images (new) and base64 (fallback/legacy)
    const coverImageUrl = album.cover_image_url || '';
    const coverImage = album.cover_image || '';
    const imageFormat = album.cover_image_format || 'PNG';

    // Helper to process a single track pick
    function processTrackPick(trackIdentifier, tracks) {
      if (!trackIdentifier) {
        return { display: '', class: 'text-gray-800 italic', duration: '' };
      }

      if (tracks && Array.isArray(tracks)) {
        const trackMatch = tracks.find(
          (t) => getTrackName(t) === trackIdentifier
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
        } else if (trackIdentifier.match(/^\d+$/)) {
          return {
            display: `Track ${trackIdentifier}`,
            class: 'text-gray-300',
            duration: '',
          };
        } else {
          return {
            display: trackIdentifier,
            class: 'text-gray-300',
            duration: '',
          };
        }
      } else if (trackIdentifier.match(/^\d+$/)) {
        return {
          display: `Track ${trackIdentifier}`,
          class: 'text-gray-300',
          duration: '',
        };
      } else {
        return {
          display: trackIdentifier,
          class: 'text-gray-300',
          duration: '',
        };
      }
    }

    // Process primary track pick (new normalized field or legacy)
    const primaryTrack = album.primary_track || album.track_pick || '';
    const primaryData = processTrackPick(primaryTrack, album.tracks);

    // Process secondary track pick (new normalized field)
    const secondaryTrack = album.secondary_track || '';
    const secondaryData = processTrackPick(secondaryTrack, album.tracks);

    // Legacy compatibility: keep old fields
    const trackPick = primaryTrack;
    const trackPickDisplay = primaryData.display || 'Select Track';
    const trackPickClass = primaryData.display
      ? primaryData.class
      : 'text-gray-800 italic';
    const trackPickDuration = primaryData.duration;

    // Album summary (from Claude AI)
    const summary = album.summary || '';
    const summarySource = album.summary_source || album.summarySource || '';

    // Recommendation cross-reference (from backend)
    const recommendedBy = album.recommended_by || null;
    const recommendedAt = album.recommended_at || null;

    // Get playcount from cache (keyed by list item _id)
    // Cache now stores { playcount, status } objects or null
    const itemId = album._id || '';
    const cachedData = playcountCache[itemId];
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
      // Legacy track pick fields (for backward compatibility)
      trackPick,
      trackPickDisplay,
      trackPickClass,
      trackPickDuration,
      // New dual track pick fields
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

  /**
   * Format playcount number for display
   * @param {number|null|undefined} count - Raw playcount
   * @returns {string} Formatted playcount or empty string
   */
  function formatPlaycount(count) {
    if (count === null || count === undefined) return '';
    if (count === 0) return '0';
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  }

  /**
   * Format playcount display based on status
   * @param {number|null} playcount - Raw playcount
   * @param {string|null} status - 'success', 'not_found', 'error', or null
   * @returns {Object} { html, isNotFound } for rendering
   */
  function formatPlaycountDisplay(playcount, status) {
    // Not yet fetched - return empty (will be hidden)
    if (status === null || status === undefined) {
      return { html: '', isNotFound: false, isEmpty: true };
    }

    // Album not found on Last.fm - show red X
    if (status === 'not_found') {
      return { html: '', isNotFound: true, isEmpty: false };
    }

    // Error state - treat like not yet fetched (will retry)
    if (status === 'error') {
      return { html: '', isNotFound: false, isEmpty: true };
    }

    // Success - show formatted playcount
    const formatted = formatPlaycount(playcount);
    return { html: formatted, isNotFound: false, isEmpty: !formatted };
  }

  /**
   * Extract only the fields needed for DOM field updates (updateAlbumFields).
   * ~20 properties vs processAlbumData's 40+, no closures, no cover/playcount/summary.
   * @param {Object} album - Raw album data
   * @param {number} index - Album index in list
   * @returns {Object} Lightweight field data for DOM updates
   */
  function extractFieldUpdateData(album, index) {
    const currentList = getCurrentList();
    const listMeta = getListMetadata(currentList);
    const isMain = listMeta?.isMain || false;
    const position = isMain ? index + 1 : null;

    const rawReleaseDate = album.release_date || '';
    const releaseDate = formatReleaseDate(rawReleaseDate);
    const listYear = listMeta?.year || null;
    const yearMismatch = isYearMismatch(rawReleaseDate, listYear);
    const releaseYear = extractYearFromDate(rawReleaseDate);
    const yearMismatchTooltip = yearMismatch
      ? `Release year (${releaseYear}) doesn't match list year (${listYear})`
      : '';

    const artist = album.artist || 'Unknown Artist';
    const albumName = album.album || 'Unknown Album';
    const country = album.country || '';
    const genre1 = album.genre_1 || album.genre || '';
    let genre2 = album.genre_2 || '';
    if (genre2 === 'Genre 2' || genre2 === '-') genre2 = '';
    let comment = album.comments || album.comment || '';
    if (comment === 'Comment') comment = '';
    let comment2 = album.comments_2 || '';
    if (comment2 === 'Comment 2') comment2 = '';

    const primaryTrack = album.primary_track || album.track_pick || '';
    const trackPick = primaryTrack;

    // Inline track display logic (avoids processTrackPick closure allocation)
    let trackPickDisplay = 'Select Track';
    let trackPickClass = 'text-gray-800 italic';
    let trackPickDuration = '';

    if (primaryTrack) {
      trackPickClass = 'text-gray-300';
      if (album.tracks && Array.isArray(album.tracks)) {
        const trackMatch = album.tracks.find(
          (t) => getTrackName(t) === primaryTrack
        );
        if (trackMatch) {
          const trackName = getTrackName(trackMatch);
          const match = trackName.match(/^(\d+)[.\s-]?\s*(.*)$/);
          trackPickDisplay = match
            ? match[2]
              ? `${match[1]}. ${match[2]}`
              : `Track ${match[1]}`
            : trackName;
          trackPickDuration = formatTrackTime(getTrackLength(trackMatch));
        } else if (primaryTrack.match(/^\d+$/)) {
          trackPickDisplay = `Track ${primaryTrack}`;
        } else {
          trackPickDisplay = primaryTrack;
        }
      } else if (primaryTrack.match(/^\d+$/)) {
        trackPickDisplay = `Track ${primaryTrack}`;
      } else {
        trackPickDisplay = primaryTrack;
      }
    }

    return {
      position,
      albumName,
      artist,
      releaseDate,
      yearMismatch,
      yearMismatchTooltip,
      country,
      countryDisplay: country || 'Country',
      countryClass: country ? 'text-gray-300' : 'text-gray-800 italic',
      genre1,
      genre1Display: genre1 || 'Genre 1',
      genre1Class: genre1 ? 'text-gray-300' : 'text-gray-800 italic',
      genre2,
      genre2Display: genre2 || 'Genre 2',
      genre2Class: genre2 ? 'text-gray-300' : 'text-gray-800 italic',
      comment,
      comment2,
      trackPick,
      trackPickDisplay,
      trackPickClass,
      trackPickDuration,
    };
  }

  /**
   * Helper function to check if text is truncated
   * @param {HTMLElement} element - Element to check
   * @returns {boolean} True if text is truncated
   */
  function isTextTruncated(element) {
    return element.scrollHeight > element.clientHeight;
  }

  /**
   * Hide all context menus and perform module-specific cleanup.
   * Delegates to shared hideAllMenusBase() then conditionally adjusts FAB.
   */
  function hideAllContextMenus() {
    hideAllMenusBase();

    // Only show FAB when a list is actually selected
    const currentList = getCurrentList();
    if (!currentList) {
      const fab = document.getElementById('addAlbumFAB');
      if (fab) fab.style.display = 'none';
    }
  }

  /**
   * Create desktop album row
   * @param {Object} data - Processed album data
   * @param {number} index - Album index
   * @returns {HTMLElement} Row element
   */
  function createDesktopAlbumRow(data, index) {
    const row = document.createElement('div');
    row.className = 'album-row album-grid gap-4 py-2';
    row.dataset.index = index;

    // Determine cover image source:
    // 1. Base64 cover (takes priority - may be locally edited or custom cover)
    // 2. URL-based loading - uses coverImageUrl from API (efficient for unmodified covers)
    // 3. Placeholder if no cover available
    const coverImageSrc = data.coverImage
      ? `data:image/${data.imageFormat};base64,${data.coverImage}`
      : data.coverImageUrl
        ? data.coverImageUrl
        : null;

    // Summary badge HTML (shown if album has a summary from any source)
    // All summaries now use Claude badge (even if originally from Last.fm/Wikipedia)
    let summaryBadgeHtml = '';
    if (data.summary) {
      const source = data.summarySource || '';
      // Always show Claude badge for all summaries
      const badgeClass = 'claude-badge';
      const iconClass = 'fas fa-robot';
      // No source URL for Claude summaries
      const sourceUrl = null;

      summaryBadgeHtml = `<div class="summary-badge ${badgeClass}" 
        data-summary="${escapeHtml(data.summary)}" 
        data-source-url="${escapeHtml(sourceUrl || '')}" 
        data-source="${escapeHtml(source)}"
        data-album-name="${escapeHtml(data.albumName)}" 
        data-artist="${escapeHtml(data.artist)}">
        <i class="${iconClass}"></i>
      </div>`;
    }

    // Recommendation badge HTML (shown if album is on the year's recommendations list)
    let recommendationBadgeHtml = '';
    if (data.recommendedBy) {
      recommendationBadgeHtml = `<div class="recommendation-badge"
        data-recommended-by="${escapeHtml(data.recommendedBy)}"
        data-recommended-at="${escapeHtml(data.recommendedAt || '')}"
        data-album-name="${escapeHtml(data.albumName)}"
        data-artist="${escapeHtml(data.artist)}">
        <i class="fas fa-thumbs-up"></i>
      </div>`;
    }

    row.innerHTML = `
      ${data.position !== null ? `<div class="flex items-center justify-center text-gray-400 font-medium text-sm position-display" data-position-element="true">${data.position}</div>` : '<div></div>'}
      <div class="flex items-center">
        <div class="album-cover-container">
          ${
            coverImageSrc
              ? `
            <img src="${PLACEHOLDER_GIF}" 
                data-lazy-src="${coverImageSrc}"
                alt="${data.albumName}" 
                class="album-cover rounded-sm shadow-lg"
                loading="lazy"
                decoding="async"
                onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'album-cover-placeholder rounded-sm bg-gray-800 shadow-lg\\'><svg width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\' class=\\'text-gray-600\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\' ry=\\'2\\'></rect><circle cx=\\'8.5\\' cy=\\'8.5\\' r=\\'1.5\\'></circle><polyline points=\\'21 15 16 10 5 21\\'></polyline></svg></div>'"
            >
          `
              : `
            <div class="album-cover-placeholder rounded-sm bg-gray-800 shadow-lg">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-600">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
            </div>
          `
          }
          ${summaryBadgeHtml}
          ${recommendationBadgeHtml}
        </div>
      </div>
      <div class="flex flex-col justify-center">
        <div class="flex items-center gap-2">
          <span class="album-name font-semibold text-gray-200 truncate">${data.albumName}</span>
          ${
            data.playcountDisplay.isNotFound
              ? `<span class="text-xs text-red-500 shrink-0" data-playcount="${data.itemId}" data-status="not_found" title="Album not found on Last.fm"><i class="fas fa-times text-[10px]"></i></span>`
              : data.playcountDisplay.isEmpty
                ? `<span class="text-xs text-gray-500 shrink-0 hidden" data-playcount="${data.itemId}"></span>`
                : `<span class="text-xs text-gray-500 shrink-0" data-playcount="${data.itemId}" data-status="success" title="${data.playcount} plays on Last.fm"><i class="fas fa-headphones text-[10px] mr-1"></i>${data.playcountDisplay.html}</span>`
          }
        </div>
        <div class="text-xs mt-0.5 release-date-display ${data.yearMismatch ? 'text-red-500 cursor-help' : 'text-gray-400'}" ${data.yearMismatch ? `title="${data.yearMismatchTooltip}"` : ''}>${data.releaseDate}</div>
      </div>
      <div class="flex items-center">
        <span class="album-cell-text ${data.artist ? 'text-gray-300' : 'text-gray-800 italic'} truncate cursor-pointer hover:text-gray-100">${data.artist}</span>
      </div>
      <div class="flex items-center country-cell">
        <span class="album-cell-text ${data.countryClass} truncate cursor-pointer hover:text-gray-100">${data.countryDisplay}</span>
      </div>
      <div class="flex items-center genre-1-cell">
        <span class="album-cell-text ${data.genre1Class} truncate cursor-pointer hover:text-gray-100">${data.genre1Display}</span>
      </div>
      <div class="flex items-center genre-2-cell">
        <span class="album-cell-text ${data.genre2Class} truncate cursor-pointer hover:text-gray-100">${data.genre2Display}</span>
      </div>
      <div class="flex flex-col justify-start track-cell min-w-0 cursor-pointer overflow-hidden">
        ${
          data.primaryTrackDisplay
            ? `<div class="flex items-center min-w-0 overflow-hidden w-full">
            <span class="text-yellow-400 mr-1.5 text-base shrink-0" title="Primary track">★</span>
            <span class="album-cell-text ${data.primaryTrackClass} truncate hover:text-gray-100 flex-1 min-w-0" title="${data.primaryTrack || ''}">${data.primaryTrackDisplay}</span>
            ${data.primaryTrackDuration ? `<span class="text-xs text-gray-500 shrink-0 ml-2 tabular-nums">${data.primaryTrackDuration}</span>` : ''}
          </div>`
            : `<div class="flex items-center min-w-0">
            <span class="album-cell-text text-gray-800 italic hover:text-gray-100">Select Track</span>
          </div>`
        }
        ${
          data.hasSecondaryTrack
            ? `<div class="flex items-center min-w-0 mt-1 overflow-hidden w-full">
            <span class="text-yellow-400 mr-1.5 text-base shrink-0" title="Secondary track">☆</span>
            <span class="album-cell-text ${data.secondaryTrackClass} truncate hover:text-gray-100 text-sm flex-1 min-w-0" title="${data.secondaryTrack || ''}">${data.secondaryTrackDisplay}</span>
            ${data.secondaryTrackDuration ? `<span class="text-xs text-gray-500 shrink-0 ml-2 tabular-nums">${data.secondaryTrackDuration}</span>` : ''}
          </div>`
            : ''
        }
      </div>
      <div class="flex items-center comment-cell relative border-l border-gray-700 pl-2 self-stretch">
        <span class="album-cell-text ${data.comment ? 'text-gray-300' : 'text-gray-800 italic'} line-clamp-2 cursor-pointer hover:text-gray-100 comment-text">${data.comment || 'Comment'}</span>
      </div>
      <div class="flex items-center comment-2-cell relative pl-2 self-stretch">
        <span class="album-cell-text ${data.comment2 ? 'text-gray-300' : 'text-gray-800 italic'} line-clamp-2 cursor-pointer hover:text-gray-100 comment-2-text">${data.comment2 || 'Comment 2'}</span>
      </div>
    `;

    // Add shared event handlers
    attachDesktopEventHandlers(row, index);
    return row;
  }

  /**
   * Attach event handlers to desktop row
   * @param {HTMLElement} row - Row element
   * @param {number} index - Album index
   */
  function attachDesktopEventHandlers(row, index) {
    const currentList = getCurrentList();

    // Add click handler to album cover for preview
    const coverImage = row.querySelector('.album-cover');
    if (coverImage) {
      coverImage.style.cursor = 'zoom-in';
      coverImage.addEventListener('click', (e) => {
        e.stopPropagation();
        openCoverPreview(coverImage);
      });
    }

    // Add click handler to track cell for quick selection
    const trackCell = row.querySelector('.track-cell');
    if (trackCell) {
      trackCell.onclick = async () => {
        const currentIndex = parseInt(row.dataset.index);
        const albumsForTrack = getListData(currentList);
        const album = albumsForTrack && albumsForTrack[currentIndex];
        if (!album) return;
        if (!album.tracks || album.tracks.length === 0) {
          showToast('Fetching tracks...', 'info');
          try {
            await fetchTracksForAlbum(album);
            await saveList(currentList, albumsForTrack);
          } catch (_err) {
            showToast('Error fetching tracks', 'error');
            return;
          }
        }

        const rect = trackCell.getBoundingClientRect();
        showTrackSelectionMenu(album, currentIndex, rect.left, rect.bottom);
      };
    }

    // Add click handler to country cell
    const countryCell = row.querySelector('.country-cell');
    countryCell.onclick = () => {
      const currentIndex = parseInt(row.dataset.index);
      makeCountryEditable(countryCell, currentIndex);
    };

    // Add click handlers to genre cells
    const genre1Cell = row.querySelector('.genre-1-cell');
    genre1Cell.onclick = () => {
      const currentIndex = parseInt(row.dataset.index);
      makeGenreEditable(genre1Cell, currentIndex, 'genre_1');
    };

    const genre2Cell = row.querySelector('.genre-2-cell');
    genre2Cell.onclick = () => {
      const currentIndex = parseInt(row.dataset.index);
      makeGenreEditable(genre2Cell, currentIndex, 'genre_2');
    };

    // Add click handler to comment cell
    const commentCell = row.querySelector('.comment-cell');
    commentCell.onclick = () => {
      const currentIndex = parseInt(row.dataset.index);
      makeCommentEditable(commentCell, currentIndex);
    };

    // Add click handler to comment 2 cell
    const comment2Cell = row.querySelector('.comment-2-cell');
    comment2Cell.onclick = () => {
      const currentIndex = parseInt(row.dataset.index);
      makeComment2Editable(comment2Cell, currentIndex);
    };

    // Attach link preview
    const albumsForPreview = getListData(currentList);
    const album = albumsForPreview && albumsForPreview[index];
    const comment = album ? album.comments || album.comment || '' : '';
    attachLinkPreview(commentCell, comment);

    const comment2 = album ? album.comments_2 || '' : '';
    attachLinkPreview(comment2Cell, comment2);

    // Add tooltip only if comment is truncated
    const commentTextEl = commentCell.querySelector('.comment-text');
    if (commentTextEl && comment) {
      setTimeout(() => {
        if (isTextTruncated(commentTextEl)) {
          commentTextEl.setAttribute('data-comment', comment);
        }
      }, 0);
    }

    // Add tooltip only if comment 2 is truncated
    const comment2TextEl = comment2Cell.querySelector('.comment-2-text');
    if (comment2TextEl && comment2) {
      setTimeout(() => {
        if (isTextTruncated(comment2TextEl)) {
          comment2TextEl.setAttribute('data-comment', comment2);
        }
      }, 0);
    }

    // Double-click handler for opening edit modal on the entire row
    row.addEventListener('dblclick', (e) => {
      const isInteractiveCell =
        e.target.closest('.country-cell') ||
        e.target.closest('.genre-1-cell') ||
        e.target.closest('.genre-2-cell') ||
        e.target.closest('.comment-cell') ||
        e.target.closest('.comment-2-cell') ||
        e.target.closest('.track-cell');

      if (isInteractiveCell) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const currentIndex = parseInt(row.dataset.index);
      const albumsForDblClick = getListData(getCurrentList());
      if (albumsForDblClick && albumsForDblClick[currentIndex]) {
        showMobileEditForm(currentIndex);
      } else {
        showToast('Album not found', 'error');
      }
    });

    // Right-click handler for album rows
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();

      hideAllContextMenus();

      const currentIndex = parseInt(row.dataset.index);
      const albumsForContext = getListData(getCurrentList());
      const album = albumsForContext && albumsForContext[currentIndex];
      if (!album) return;
      const albumId =
        `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();

      // Set context album state via injected function
      if (setContextAlbum) {
        setContextAlbum(currentIndex, albumId);
      }

      const contextMenu = document.getElementById('albumContextMenu');
      if (!contextMenu) return;

      // Show/hide Last.fm discovery options based on connection status
      const hasLastfm = !!window.currentUser?.lastfmUsername;
      const lastfmDivider = document.getElementById('lastfmMenuDivider');
      const similarOption = document.getElementById('similarArtistsOption');

      if (lastfmDivider) lastfmDivider.classList.toggle('hidden', !hasLastfm);
      if (similarOption) similarOption.classList.toggle('hidden', !hasLastfm);

      // Show/hide admin-only options based on user role
      const isAdmin = window.currentUser?.role === 'admin';
      const adminDivider = document.getElementById('adminMenuDivider');
      const reidentifyOption = document.getElementById('reidentifyAlbumOption');

      if (adminDivider) adminDivider.classList.toggle('hidden', !isAdmin);
      if (reidentifyOption)
        reidentifyOption.classList.toggle('hidden', !isAdmin);

      // Show/hide recommend option based on whether current list is year-based
      // and not currently viewing recommendations
      const recommendOption = document.getElementById('recommendAlbumOption');
      if (recommendOption) {
        const currentListId = getCurrentList();
        const listMeta = window.lists && window.lists[currentListId];
        const isYearBased =
          listMeta && listMeta.year !== null && listMeta.year !== undefined;
        const isViewingRecommendations =
          window.isViewingRecommendations && window.isViewingRecommendations();

        // Show recommend option only for year-based lists (not when viewing recommendations)
        const showRecommend = isYearBased && !isViewingRecommendations;
        recommendOption.classList.toggle('hidden', !showRecommend);
      }

      // Position the menu
      positionContextMenu(contextMenu, e.clientX, e.clientY);
    });
  }

  /**
   * Create mobile album card
   * @param {Object} data - Processed album data
   * @param {number} index - Album index
   * @returns {HTMLElement} Card element
   */
  /**
   * Create mobile album card
   *
   * LAYOUT STRUCTURE:
   * ┌────────────────────────────────────────────────────────────────────────┐
   * │ cardWrapper (.album-card-wrapper) - h-[130px]                         │
   * │  └─ card (.album-card.album-row) - relative, h-[130px]               │
   * │     ├─ positionBadge (absolute, top-right of card)                   │
   * │     └─ contentRow (flex row, h-full)                                  │
   * │        ├─ coverSection (w-[88px], flex-shrink-0)                     │
   * │        │   ├─ albumCover (.mobile-album-cover, 80x80)                │
   * │        │   │   ├─ coverImage (75x75, .album-cover-blur)              │
   * │        │   │   └─ summaryBadge (absolute, top-right of cover)        │
   * │        │   └─ releaseDate (centered below cover)                      │
   * │        ├─ infoSection (flex-1, min-w-0 for truncation)               │
   * │        │   ├─ albumName                                               │
   * │        │   ├─ artist + playcount                                      │
   * │        │   ├─ country                                                 │
   * │        │   ├─ genres                                                  │
   * │        │   ├─ primaryTrack                                           │
   * │        │   └─ secondaryTrack (optional)                              │
   * │        └─ menuSection (w-[25px], border-left separator)              │
   * │            └─ menuButton (three-dot)                                  │
   * └────────────────────────────────────────────────────────────────────────┘
   *
   * CSS DEPENDENCIES (from input.css):
   * - .album-card-wrapper: Sortable drag states (lines 311-438)
   * - .album-card: Touch feedback, transitions (lines 171-240, 500-502)
   * - .album-row: Inset box-shadow separators (lines 492-499)
   * - .mobile-album-cover: Now-playing animated border (lines 511-592)
   * - .album-cover-blur: Glow effect on cover (lines 505-513)
   * - .summary-badge-mobile: AI badge styling (lines 2092-2160)
   * - .no-drag: Prevents drag on interactive elements (lines 482-488)
   *
   * @param {Object} data - Processed album data
   * @param {number} index - Album index
   * @returns {HTMLElement} Card wrapper element
   */
  function createMobileAlbumCard(data, index) {
    // === WRAPPER ELEMENT ===
    // Container for sortable drag functionality
    const cardWrapper = document.createElement('div');
    cardWrapper.className = 'album-card-wrapper h-[130px]';

    // === CARD ELEMENT ===
    // Main card with:
    // - album-card: Touch feedback, box-shadow transitions
    // - album-row: Inset top/bottom separators (subtle white lines)
    // - relative: Positioning context for absolute children
    // - h-[130px]: Fixed height matching wrapper
    const card = document.createElement('div');
    card.className = 'album-card album-row relative h-[130px] bg-gray-900';
    card.dataset.index = index;

    // === COVER IMAGE SOURCE ===
    const mobileCoverSrc = data.coverImage
      ? `data:image/${data.imageFormat};base64,${data.coverImage}`
      : data.coverImageUrl || null;

    // === SUMMARY BADGE (AI indicator on cover) ===
    let summaryBadgeHtml = '';
    if (data.summary) {
      summaryBadgeHtml = `
        <div class="summary-badge summary-badge-mobile claude-badge" 
             data-summary="${escapeHtml(data.summary)}" 
             data-source-url="${escapeHtml('')}" 
             data-source="${escapeHtml(data.summarySource || '')}"
             data-album-name="${escapeHtml(data.albumName)}" 
             data-artist="${escapeHtml(data.artist)}">
          <i class="fas fa-robot"></i>
        </div>`;
    }

    // === RECOMMENDATION BADGE (shown if album is on the year's recommendations) ===
    let mobileRecommendationBadgeHtml = '';
    if (data.recommendedBy) {
      mobileRecommendationBadgeHtml = `
        <div class="recommendation-badge recommendation-badge-mobile"
             data-recommended-by="${escapeHtml(data.recommendedBy)}"
             data-recommended-at="${escapeHtml(data.recommendedAt || '')}"
             data-album-name="${escapeHtml(data.albumName)}"
             data-artist="${escapeHtml(data.artist)}">
          <i class="fas fa-thumbs-up"></i>
        </div>`;
    }

    // === POSITION BADGE ===
    // Circular badge showing album rank, positioned in top-right of menu section
    const getPositionBadgeHtml = (position) => {
      if (position === null) return '';

      // Color coding: gold (1st), silver (2nd), bronze (3rd), gray (rest)
      const colors = {
        1: { border: '#eab308', shadow: 'rgba(255,215,0,1.0)', size: '8px' },
        2: { border: '#9ca3af', shadow: 'rgba(192,192,192,1.0)', size: '8px' },
        3: { border: '#b45309', shadow: 'rgba(205,127,50,1.0)', size: '8px' },
        default: {
          border: '#6b7280',
          shadow: 'rgba(255,255,255,0.25)',
          size: '5px',
        },
      };
      const c = colors[position] || colors.default;

      // Positioned absolute within the card (which has position: relative)
      return `
        <div class="mobile-position-badge"
             style="position: absolute; top: 8px; right: -20px; z-index: 10;
                    width: 17px; height: 17px;
                    display: flex; align-items: center; justify-content: center;
                    border: 1px solid ${c.border}; border-radius: 50%;
                    background: rgba(17, 24, 39, 0.7);
                    box-shadow: 0 0 ${c.size} ${c.shadow};
                    color: white; font-size: 9px; font-weight: 500;"
             data-position-element="true">
          <span style="transform: translateY(0.5px)">${position}</span>
        </div>`;
    };

    // === BUILD CARD HTML ===
    card.innerHTML = `
      <!-- POSITION BADGE (positioned relative to card) -->
      ${getPositionBadgeHtml(data.position)}
      
      <div class="flex items-stretch h-full">
        
        <!-- COVER SECTION -->
        <div class="shrink-0 w-[88px] flex flex-col items-center pt-2 pl-1">
          <!-- Album cover with optional summary badge -->
          <div class="mobile-album-cover relative w-20 h-20 flex items-center justify-center ${!mobileCoverSrc ? 'bg-gray-800 rounded-lg' : ''}">
            ${
              mobileCoverSrc
                ? `<img src="${PLACEHOLDER_GIF}"
                       data-lazy-src="${mobileCoverSrc}"
                       alt="${escapeHtml(data.albumName)}"
                       class="album-cover-blur w-[75px] h-[75px] rounded-lg object-cover"
                       loading="lazy" decoding="async">`
                : `<i class="fas fa-compact-disc text-xl text-gray-600"></i>`
            }
            ${summaryBadgeHtml}
            ${mobileRecommendationBadgeHtml}
          </div>
          <!-- Release date -->
          <div class="flex-1 flex items-center mt-1">
            <span class="release-date-display text-xs whitespace-nowrap ${data.yearMismatch ? 'text-red-500' : 'text-gray-500'}"
                  ${data.yearMismatch ? `title="${escapeHtml(data.yearMismatchTooltip || '')}"` : ''}>
              ${data.releaseDate}
            </span>
          </div>
        </div>
        
        <!-- INFO SECTION -->
        <div class="flex-1 min-w-0 py-1 pl-2 pr-1 flex flex-col justify-between h-[122px]">
          <!-- Album name -->
          <div class="flex items-center">
            <h3 class="font-semibold text-gray-200 text-sm leading-tight truncate">
              <i class="fas fa-compact-disc fa-xs mr-2"></i>${escapeHtml(data.albumName)}
            </h3>
          </div>
          <!-- Artist + playcount -->
          <div class="flex items-center">
            <p class="text-[13px] text-gray-500 truncate">
              <i class="fas fa-user fa-xs mr-2"></i>
              <span data-field="artist-mobile-text">${escapeHtml(data.artist)}</span>
              ${
                data.playcountDisplay.isNotFound
                  ? `<span class="text-red-500 ml-4" data-playcount-mobile="${data.itemId}" data-status="not_found" title="Album not found on Last.fm">
                     <i class="fas fa-times text-[10px]"></i></span>`
                  : data.playcountDisplay.isEmpty
                    ? `<span class="text-gray-600 ml-4 hidden" data-playcount-mobile="${data.itemId}"></span>`
                    : `<span class="text-gray-600 ml-4" data-playcount-mobile="${data.itemId}" data-status="success">
                       <i class="fas fa-headphones text-[10px]"></i> ${data.playcountDisplay.html}</span>`
              }
            </p>
          </div>
          <!-- Country -->
          <div class="flex items-center">
            <span class="text-[13px] text-gray-500">
              <i class="fas fa-globe fa-xs mr-2"></i>
              <span data-field="country-mobile-text">${escapeHtml(data.country || '')}</span>
            </span>
          </div>
          <!-- Genres -->
          <div class="flex items-center">
            <span class="text-[13px] text-gray-500 truncate">
              <i class="fas fa-music fa-xs mr-2"></i>
              <span data-field="genre-mobile-text">${escapeHtml(data.genre1 && data.genre2 ? `${data.genre1} / ${data.genre2}` : data.genre1 || data.genre2 || '')}</span>
            </span>
          </div>
          <!-- Primary track -->
          <div class="flex items-center ${data.primaryTrackDisplay ? 'cursor-pointer active:opacity-70' : ''}"
               data-track-play-btn="${data.primaryTrackDisplay ? 'true' : ''}"
               data-track-identifier="${data.primaryTrack || ''}">
            <span class="text-[13px] text-green-400 truncate">
              <i class="fas fa-play fa-xs mr-2"></i>
              ${data.primaryTrackDisplay ? '<span class="text-yellow-400 text-xs mr-1">★</span>' : ''}
              <span data-field="track-mobile-text">${escapeHtml(data.primaryTrackDisplay || '')}</span>
            </span>
          </div>
          <!-- Secondary track (optional) -->
          ${
            data.hasSecondaryTrack
              ? `<div class="flex items-center cursor-pointer active:opacity-70"
                     data-track-play-btn="true"
                     data-track-identifier="${data.secondaryTrack || ''}">
                  <span class="text-[13px] text-green-400 truncate">
                    <i class="fas fa-play fa-xs mr-2"></i>
                    <span class="text-yellow-400 text-xs mr-1">☆</span>
                    <span data-field="secondary-track-mobile-text">${escapeHtml(data.secondaryTrackDisplay || '')}</span>
                  </span>
                </div>`
              : ''
          }
        </div>
        
        <!-- MENU SECTION -->
        <div class="shrink-0 w-[25px] border-l border-gray-800/50" style="display: flex; align-items: center; justify-content: center;">
          <button data-album-menu-btn class="no-drag text-gray-400 active:text-gray-200" style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; transform: translateX(7px);">
            <i class="fas fa-ellipsis-v fa-fw"></i>
          </button>
        </div>
        
      </div>
    `;

    cardWrapper.appendChild(card);
    attachMobileEventHandlers(card, index);
    return cardWrapper;
  }

  /**
   * Attach event handlers to mobile card
   * @param {HTMLElement} card - Card element
   * @param {number} index - Album index
   */
  function attachMobileEventHandlers(card, index) {
    const currentList = getCurrentList();

    // Attach link preview to content area
    const albumsForMobile = getListData(currentList);
    const album = albumsForMobile && albumsForMobile[index];
    const comment = album ? album.comments || album.comment || '' : '';
    const contentDiv = card.querySelector('.flex-1.min-w-0');
    if (contentDiv) attachLinkPreview(contentDiv, comment);

    // Attach summary badge handler (if summary exists)
    const summaryBadge = card.querySelector('.summary-badge-mobile');
    if (summaryBadge && showMobileSummarySheet) {
      summaryBadge.addEventListener(
        'touchstart',
        (e) => {
          e.stopPropagation();
        },
        { passive: true }
      );

      summaryBadge.addEventListener(
        'touchend',
        (e) => {
          e.stopPropagation();
        },
        { passive: true }
      );

      summaryBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const summary = summaryBadge.dataset.summary;
        const albumName = summaryBadge.dataset.albumName;
        const artist = summaryBadge.dataset.artist;
        if (summary) {
          showMobileSummarySheet(summary, albumName, artist);
        }
      });
    }

    // Attach recommendation badge handler (if recommended)
    const recBadge = card.querySelector('.recommendation-badge-mobile');
    if (recBadge) {
      recBadge.addEventListener(
        'touchstart',
        (e) => {
          e.stopPropagation();
        },
        { passive: true }
      );

      recBadge.addEventListener(
        'touchend',
        (e) => {
          e.stopPropagation();
        },
        { passive: true }
      );

      recBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        showMobileRecommendationSheet(recBadge);
      });
    }

    // Attach three-dot menu button handler
    const menuBtn = card.querySelector('[data-album-menu-btn]');
    if (menuBtn) {
      menuBtn.addEventListener(
        'touchstart',
        (e) => {
          e.stopPropagation();
        },
        { passive: true }
      );

      menuBtn.addEventListener(
        'touchend',
        (e) => {
          e.stopPropagation();
        },
        { passive: true }
      );

      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        showMobileAlbumMenu(menuBtn);
      });
    }

    // Attach track play button handlers (for both primary and secondary tracks)
    const trackPlayBtns = card.querySelectorAll('[data-track-play-btn="true"]');
    trackPlayBtns.forEach((trackPlayBtn) => {
      trackPlayBtn.addEventListener(
        'touchstart',
        (e) => {
          e.stopPropagation();
        },
        { passive: true }
      );

      trackPlayBtn.addEventListener(
        'touchend',
        (e) => {
          e.stopPropagation();
        },
        { passive: true }
      );

      trackPlayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const trackIdentifier = trackPlayBtn.dataset.trackIdentifier;
        if (trackIdentifier && window.playSpecificTrack) {
          // Play the specific track using its identifier
          window.playSpecificTrack(index, trackIdentifier);
        } else {
          // Fallback to album's default track
          const albumsForTrackPlay = getListData(getCurrentList());
          const albumForTrackPlay =
            albumsForTrackPlay && albumsForTrackPlay[index];
          if (albumForTrackPlay) {
            const albumId =
              `${albumForTrackPlay.artist}::${albumForTrackPlay.album}::${albumForTrackPlay.release_date || ''}`.toLowerCase();
            playTrackSafe(albumId);
          }
        }
      });
    });
  }

  /**
   * Create album item (router for desktop/mobile)
   * @param {Object} album - Album data
   * @param {number} index - Album index
   * @param {boolean} isMobile - Whether to create mobile view
   * @returns {HTMLElement} Album element
   */
  function createAlbumItem(album, index, isMobile = false) {
    const data = processAlbumData(album, index);

    if (isMobile) {
      return createMobileAlbumCard(data, index);
    } else {
      return createDesktopAlbumRow(data, index);
    }
  }

  /**
   * Get album ID for comparison
   * @param {Object} album - Album object
   * @returns {string} Album identifier
   */
  function getAlbumId(album) {
    return (
      album._id ||
      `${album.artist}::${album.album}::${album.release_date || ''}`
    );
  }

  /**
   * Extract album ID from a mutable fingerprint string.
   * Fingerprint format: "_id|artist|album|release_date|..."
   * @param {string} fp - Fingerprint string
   * @returns {string} Album identifier
   */
  function getAlbumIdFromFingerprint(fp) {
    const pipeIdx = fp.indexOf('|');
    const id = pipeIdx >= 0 ? fp.substring(0, pipeIdx) : fp;
    if (id) return id;
    // Fallback: extract artist::album::release_date for composite ID
    const parts = fp.split('|');
    return `${parts[1] || ''}::${parts[2] || ''}::${parts[3] || ''}`;
  }

  /**
   * Find single addition in list
   * @param {Array<string>} oldFingerprints - Previous fingerprint strings
   * @param {Array} newAlbums - New album array
   * @returns {Object|null} { album, index } or null
   */
  function findSingleAddition(oldFingerprints, newAlbums) {
    if (newAlbums.length !== oldFingerprints.length + 1) return null;

    const oldIds = new Set(oldFingerprints.map(getAlbumIdFromFingerprint));

    for (let i = 0; i < newAlbums.length; i++) {
      const newId = getAlbumId(newAlbums[i]);
      if (!oldIds.has(newId)) {
        // Found the added album - verify rest of list matches
        const beforeMatch = newAlbums
          .slice(0, i)
          .every(
            (a, idx) =>
              getAlbumId(a) === getAlbumIdFromFingerprint(oldFingerprints[idx])
          );
        const afterMatch = newAlbums
          .slice(i + 1)
          .every(
            (a, idx) =>
              getAlbumId(a) ===
              getAlbumIdFromFingerprint(oldFingerprints[i + idx])
          );

        if (beforeMatch && afterMatch) {
          return { album: newAlbums[i], index: i };
        }
      }
    }
    return null;
  }

  /**
   * Find single removal in list
   * @param {Array<string>} oldFingerprints - Previous fingerprint strings
   * @param {Array} newAlbums - New album array
   * @returns {number} Index of removed item or -1
   */
  function findSingleRemoval(oldFingerprints, newAlbums) {
    if (newAlbums.length !== oldFingerprints.length - 1) return -1;

    const newIds = new Set(newAlbums.map(getAlbumId));

    for (let i = 0; i < oldFingerprints.length; i++) {
      const oldId = getAlbumIdFromFingerprint(oldFingerprints[i]);
      if (!newIds.has(oldId)) {
        // Found the removed album - verify rest of list matches
        const beforeMatch = newAlbums
          .slice(0, i)
          .every(
            (a, idx) =>
              getAlbumId(a) === getAlbumIdFromFingerprint(oldFingerprints[idx])
          );
        const afterMatch = newAlbums
          .slice(i)
          .every(
            (a, idx) =>
              getAlbumId(a) ===
              getAlbumIdFromFingerprint(oldFingerprints[i + 1 + idx])
          );

        if (beforeMatch && afterMatch) {
          return i;
        }
      }
    }
    return -1;
  }

  /**
   * Detect what type of update is needed.
   * Compares fingerprint strings instead of objects to reduce allocations.
   * @param {Array<string>|null} oldFingerprints - Previous fingerprint strings (from extractMutableFingerprints)
   * @param {Array} newAlbums - New album array
   * @returns {string|Object} Update type string or object with details for add/remove
   */
  function detectUpdateType(oldFingerprints, newAlbums) {
    if (!ENABLE_INCREMENTAL_UPDATES || !oldFingerprints) {
      return 'FULL_REBUILD';
    }

    // Check for single addition
    if (newAlbums.length === oldFingerprints.length + 1) {
      const addition = findSingleAddition(oldFingerprints, newAlbums);
      if (addition) {
        return {
          type: 'SINGLE_ADD',
          album: addition.album,
          index: addition.index,
        };
      }
    }

    // Check for single removal
    if (newAlbums.length === oldFingerprints.length - 1) {
      const removalIndex = findSingleRemoval(oldFingerprints, newAlbums);
      if (removalIndex !== -1) {
        return { type: 'SINGLE_REMOVE', index: removalIndex };
      }
    }

    // Length must match for other incremental updates
    if (oldFingerprints.length !== newAlbums.length) {
      return 'FULL_REBUILD';
    }

    let positionChanges = 0;
    let fieldChanges = 0;

    for (let i = 0; i < newAlbums.length; i++) {
      const oldId = getAlbumIdFromFingerprint(oldFingerprints[i]);
      const newId = getAlbumId(newAlbums[i]);

      if (oldId !== newId) {
        positionChanges++;
      } else {
        // Build new fingerprint inline and compare as string -- cheaper than
        // comparing 8+ object properties individually, and avoids allocating objects.
        const newAlbum = newAlbums[i];
        const newFp = `${newAlbum._id || ''}|${newAlbum.artist || ''}|${newAlbum.album || ''}|${newAlbum.release_date || ''}|${newAlbum.country || ''}|${newAlbum.genre_1 || ''}|${newAlbum.genre_2 || ''}|${newAlbum.comments || ''}|${newAlbum.comments_2 || ''}|${newAlbum.track_pick || ''}`;
        if (oldFingerprints[i] !== newFp) {
          fieldChanges++;
        }
      }
    }

    // Note: cover_image changes now always trigger full rebuild via fingerprint mismatch
    // since we don't track cover_image in mutable state (too expensive)
    if (positionChanges === 0 && fieldChanges > 0 && fieldChanges <= 10) {
      return 'FIELD_UPDATE';
    }
    if (fieldChanges === 0 && positionChanges > 0) {
      return 'POSITION_UPDATE';
    }
    if (positionChanges + fieldChanges <= 15) {
      return 'HYBRID_UPDATE';
    }

    return 'FULL_REBUILD';
  }

  /**
   * Insert a single album at a specific index without full rebuild
   * @param {Array} albums - Full album array (for data)
   * @param {number} index - Index to insert at
   * @param {boolean} isMobile - Whether mobile view
   * @returns {boolean} Success
   */
  function insertAlbumAtIndex(albums, index, isMobile) {
    const container = document.getElementById('albumContainer');
    if (!container) return false;

    const rowsContainer = isMobile
      ? container.querySelector('.mobile-album-list')
      : container.querySelector('.album-rows-container');

    if (!rowsContainer) return false;

    const album = albums[index];
    if (!album) return false;

    // Create the new row/card
    const newRow = createAlbumItem(album, index, isMobile);

    // Insert at the correct position
    const existingRows = rowsContainer.children;
    if (index >= existingRows.length) {
      rowsContainer.appendChild(newRow);
    } else {
      rowsContainer.insertBefore(newRow, existingRows[index]);
    }

    // Update indices for all rows after insertion
    for (let i = index; i < rowsContainer.children.length; i++) {
      const row = rowsContainer.children[i];
      row.dataset.index = i;
      // Also update inner card for mobile
      const innerCard = row.querySelector('.album-card');
      if (innerCard) {
        innerCard.dataset.index = i;
      }
    }

    // Update position numbers
    updatePositionNumbers(rowsContainer, isMobile);

    // Observe lazy images for the new row
    observeLazyImages(container);

    // Initialize tooltips for desktop
    if (!isMobile) {
      initSummaryTooltips(newRow);
    }

    return true;
  }

  /**
   * Remove a single album at a specific index without full rebuild
   * @param {number} index - Index to remove
   * @param {boolean} isMobile - Whether mobile view
   * @returns {boolean} Success
   */
  function removeAlbumAtIndex(index, isMobile) {
    const container = document.getElementById('albumContainer');
    if (!container) return false;

    const rowsContainer = isMobile
      ? container.querySelector('.mobile-album-list')
      : container.querySelector('.album-rows-container');

    if (!rowsContainer) return false;

    const row = rowsContainer.children[index];
    if (!row) return false;

    // Remove the row
    row.remove();

    // Update indices for remaining rows
    for (let i = index; i < rowsContainer.children.length; i++) {
      const r = rowsContainer.children[i];
      r.dataset.index = i;
      // Also update inner card for mobile
      const innerCard = r.querySelector('.album-card');
      if (innerCard) {
        innerCard.dataset.index = i;
      }
    }

    // Update position numbers
    updatePositionNumbers(rowsContainer, isMobile);

    return true;
  }

  /**
   * Update only changed fields in existing DOM elements
   * Uses cached element references for performance
   * @param {Array} albums - Album array
   * @param {boolean} isMobile - Whether mobile view
   * @returns {boolean} Success
   */
  function updateAlbumFields(albums, isMobile) {
    const container = document.getElementById('albumContainer');
    if (!container) return false;

    const rowsContainer = isMobile
      ? container.querySelector('.mobile-album-list')
      : container.querySelector('.album-rows-container');

    if (!rowsContainer) return false;

    const rows = Array.from(rowsContainer.children);

    if (rows.length !== albums.length) {
      console.warn('DOM/data length mismatch, falling back');
      return false;
    }

    try {
      albums.forEach((album, index) => {
        const row = rows[index];
        if (!row) return;

        row.dataset.index = index;
        const data = extractFieldUpdateData(album, index);

        // Get cached element references (creates cache if missing)
        const cache = getCachedElements(row, isMobile);

        // Update position number (only for main lists where position is not null)
        if (cache.position && data.position !== null) {
          if (cache.position.textContent !== data.position.toString()) {
            cache.position.textContent = data.position;
          }
        }

        // Update artist
        if (!isMobile) {
          if (cache.artist) {
            cache.artist.textContent = data.artist;
            cache.artist.className = `text-sm ${data.artist ? 'text-gray-300' : 'text-gray-800 italic'} truncate cursor-pointer hover:text-gray-100`;
          }
        } else {
          if (cache.artistText) {
            cache.artistText.textContent = data.artist;
          }
        }

        // Update album name and release date
        if (!isMobile) {
          if (cache.albumName) cache.albumName.textContent = data.albumName;

          if (cache.releaseDate) {
            cache.releaseDate.textContent = data.releaseDate;
            cache.releaseDate.className = `text-xs mt-0.5 release-date-display ${data.yearMismatch ? 'text-red-500 cursor-help' : 'text-gray-400'}`;
            if (data.yearMismatch) {
              cache.releaseDate.title = data.yearMismatchTooltip;
            } else {
              cache.releaseDate.removeAttribute('title');
            }
          }
        } else {
          if (cache.releaseDate) {
            cache.releaseDate.textContent = data.releaseDate;
            cache.releaseDate.className = `text-xs mt-1 whitespace-nowrap release-date-display ${data.yearMismatch ? 'text-red-500' : 'text-gray-500'}`;
            if (data.yearMismatch) {
              cache.releaseDate.title = data.yearMismatchTooltip;
            } else {
              cache.releaseDate.removeAttribute('title');
            }
          }
        }

        if (!isMobile) {
          // Update country using cached span
          if (cache.countrySpan) {
            cache.countrySpan.textContent = data.countryDisplay;
            cache.countrySpan.className = `text-sm ${data.countryClass} truncate cursor-pointer hover:text-gray-100`;
          }

          // Update genre 1 using cached span
          if (cache.genre1Span) {
            cache.genre1Span.textContent = data.genre1Display;
            cache.genre1Span.className = `text-sm ${data.genre1Class} truncate cursor-pointer hover:text-gray-100`;
          }

          // Update genre 2 using cached span
          if (cache.genre2Span) {
            cache.genre2Span.textContent = data.genre2Display;
            cache.genre2Span.className = `text-sm ${data.genre2Class} truncate cursor-pointer hover:text-gray-100`;
          }

          // Update comment using cached span
          if (cache.commentSpan) {
            cache.commentSpan.textContent = data.comment || 'Comment';
            cache.commentSpan.className = `text-sm ${data.comment ? 'text-gray-300' : 'text-gray-800 italic'} line-clamp-2 cursor-pointer hover:text-gray-100 comment-text`;

            if (data.comment) {
              cache.commentSpan.setAttribute('data-comment', data.comment);
            } else {
              cache.commentSpan.removeAttribute('data-comment');
            }
          }

          // Update comment 2 using cached span
          if (cache.comment2Span) {
            cache.comment2Span.textContent = data.comment2 || 'Comment 2';
            cache.comment2Span.className = `text-sm ${data.comment2 ? 'text-gray-300' : 'text-gray-800 italic'} line-clamp-2 cursor-pointer hover:text-gray-100 comment-2-text`;

            if (data.comment2) {
              cache.comment2Span.setAttribute('data-comment', data.comment2);
            } else {
              cache.comment2Span.removeAttribute('data-comment');
            }
          }

          // Update track pick using cached span
          if (cache.trackSpan) {
            cache.trackSpan.textContent = data.trackPickDisplay;
            cache.trackSpan.className = `text-sm ${data.trackPickClass} truncate cursor-pointer hover:text-gray-100`;
            cache.trackSpan.title = data.trackPick || 'Click to select track';
            // Update duration span (sibling of trackSpan)
            const trackCell = cache.trackSpan.parentElement;
            if (trackCell) {
              const existingDuration = trackCell.querySelector('.shrink-0');
              if (data.trackPickDuration) {
                if (existingDuration) {
                  existingDuration.textContent = data.trackPickDuration;
                } else {
                  const durationSpan = document.createElement('span');
                  durationSpan.className =
                    'text-xs text-gray-500 shrink-0 ml-2';
                  durationSpan.textContent = data.trackPickDuration;
                  trackCell.appendChild(durationSpan);
                }
              } else if (existingDuration) {
                existingDuration.remove();
              }
            }
          }
        } else {
          // Mobile: use cached elements
          if (cache.countryText) {
            cache.countryText.textContent = data.country || '';
          }

          if (cache.genreText) {
            const genreDisplay =
              data.genre1 && data.genre2
                ? `${data.genre1} / ${data.genre2}`
                : data.genre1 || data.genre2 || '';
            cache.genreText.textContent = genreDisplay;
          }

          const trackMobile = cache.trackText;
          if (trackMobile) {
            const trackDisplay =
              data.trackPick && data.trackPickDisplay !== 'Select Track'
                ? data.trackPickDisplay
                : '';
            trackMobile.textContent = trackDisplay;

            const trackPlayBtn = trackMobile.closest('[data-track-play-btn]');
            if (trackPlayBtn) {
              const hasTrack =
                data.trackPick && data.trackPickDisplay !== 'Select Track';
              trackPlayBtn.setAttribute(
                'data-track-play-btn',
                hasTrack ? 'true' : ''
              );

              if (hasTrack) {
                trackPlayBtn.classList.add(
                  'cursor-pointer',
                  'active:opacity-70'
                );
                const newBtn = trackPlayBtn.cloneNode(true);
                trackPlayBtn.parentNode.replaceChild(newBtn, trackPlayBtn);

                newBtn.addEventListener(
                  'touchstart',
                  (e) => e.stopPropagation(),
                  { passive: true }
                );
                newBtn.addEventListener(
                  'touchend',
                  (e) => e.stopPropagation(),
                  {
                    passive: true,
                  }
                );
                newBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const albumsForPlay = getListData(getCurrentList());
                  const albumForPlay = albumsForPlay && albumsForPlay[index];
                  if (albumForPlay) {
                    const albumId =
                      `${albumForPlay.artist}::${albumForPlay.album}::${albumForPlay.release_date || ''}`.toLowerCase();
                    playTrackSafe(albumId);
                  }
                });
              } else {
                trackPlayBtn.classList.remove(
                  'cursor-pointer',
                  'active:opacity-70'
                );
              }
            }
          }
        }
      });

      return true;
    } catch (err) {
      console.error('Field update failed:', err);
      return false;
    }
  }

  /**
   * Verify DOM integrity
   * @param {Array} albums - Album array
   * @param {boolean} isMobile - Whether mobile view
   * @returns {boolean} Integrity check passed
   */
  function verifyDOMIntegrity(albums, isMobile) {
    const container = document.getElementById('albumContainer');
    if (!container) return false;

    const rowsContainer = isMobile
      ? container.querySelector('.mobile-album-list')
      : container.querySelector('.album-rows-container');

    if (!rowsContainer) return false;

    const rows = rowsContainer.children;
    return rows.length === albums.length;
  }

  /**
   * Pre-populate position element cache for better performance
   * @param {HTMLElement} container - Container element
   * @param {boolean} isMobile - Whether mobile view
   */
  function prePopulatePositionCache(container, isMobile) {
    let rows;

    if (isMobile) {
      rows = container.children;
    } else {
      const rowsContainer = container.querySelector('.album-rows-container');
      rows = rowsContainer ? rowsContainer.children : container.children;
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let positionEl = row.querySelector('[data-position-element="true"]');

      if (!positionEl) {
        positionEl = row.querySelector('.position-display');
      }

      if (positionEl) {
        positionElementCache.set(row, positionEl);
      }
    }
  }

  /**
   * Update position numbers after reorder
   * Only updates positions for main lists (where positions have semantic meaning)
   * @param {HTMLElement} container - Container element
   * @param {boolean} isMobile - Whether mobile view
   */
  function updatePositionNumbers(container, isMobile) {
    // Check if current list is a main list - positions only exist for main lists
    const currentList = getCurrentList();
    const listMeta = getListMetadata(currentList);
    const isMain = listMeta?.isMain || false;

    let rows;

    if (isMobile) {
      rows = container.children;
    } else {
      const rowsContainer = container.querySelector('.album-rows-container');
      rows = rowsContainer ? rowsContainer.children : container.children;
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const position = i + 1;

      // Always update data-index for drag-drop functionality
      row.dataset.index = i;
      const innerCard = row.querySelector('.album-card');
      if (innerCard) {
        innerCard.dataset.index = i;
      }

      // Only update position display for main lists
      if (!isMain) continue;

      let positionEl = positionElementCache.get(row);
      if (!positionEl) {
        positionEl = row.querySelector('[data-position-element="true"]');

        if (!positionEl) {
          positionEl = row.querySelector('.position-display');
        }

        if (positionEl) {
          positionElementCache.set(row, positionEl);
        }
      }

      if (positionEl) {
        const textEl = positionEl.querySelector('span') || positionEl;
        textEl.textContent = position;

        if (positionEl.classList.contains('position-badge')) {
          positionEl.classList.remove(
            'border-yellow-500',
            'border-gray-400',
            'border-amber-700',
            'border-gray-500'
          );
          if (position === 1) {
            positionEl.classList.add('border-yellow-500');
          } else if (position === 2) {
            positionEl.classList.add('border-gray-400');
          } else if (position === 3) {
            positionEl.classList.add('border-amber-700');
          } else {
            positionEl.classList.add('border-gray-500');
          }

          if (position === 1) {
            positionEl.style.boxShadow = '0 0 8px rgba(255,215,0,1.0)';
          } else if (position === 2) {
            positionEl.style.boxShadow = '0 0 8px rgba(192,192,192,1.0)';
          } else if (position === 3) {
            positionEl.style.boxShadow = '0 0 8px rgba(205,127,50,1.0)';
          } else {
            positionEl.style.boxShadow = '0 0 5px rgba(255,255,255,0.25)';
          }
        }
      }
    }
  }

  // Summary tooltip state
  let activeTooltip = null;
  let activeBadge = null; // Track which badge the tooltip is for
  let tooltipHideTimeout = null;
  let tooltipRemoveTimeout = null; // Track the removal animation timeout
  const TOOLTIP_HIDE_DELAY = 80; // 80ms delay before hiding (prevents accidental dismissal)

  /**
   * Initialize summary and recommendation tooltips for badges
   * @param {HTMLElement} container - Container element
   */
  function initSummaryTooltips(container) {
    const summaryBadges = container.querySelectorAll('.summary-badge');
    summaryBadges.forEach((badge) => {
      badge.addEventListener('mouseenter', handleBadgeMouseEnter);
      badge.addEventListener('mouseleave', handleBadgeMouseLeave);
    });

    // Also initialize recommendation badge tooltips (desktop only)
    const recBadges = container.querySelectorAll(
      '.recommendation-badge:not(.recommendation-badge-mobile)'
    );
    recBadges.forEach((badge) => {
      badge.addEventListener('mouseenter', handleRecommendationBadgeMouseEnter);
      badge.addEventListener('mouseleave', handleBadgeMouseLeave);
    });
  }

  // Backwards compatibility alias
  function initLastfmTooltips(container) {
    initSummaryTooltips(container);
  }

  /**
   * Handle mouse enter on summary badge
   * @param {MouseEvent} e - Mouse event
   */
  function handleBadgeMouseEnter(e) {
    const badge = e.currentTarget;
    const summary = badge.dataset.summary;
    const _sourceUrl = badge.dataset.sourceUrl;
    const _source = badge.dataset.source || 'lastfm';
    const albumName = badge.dataset.albumName;
    const artist = badge.dataset.artist;

    if (!summary) return;

    // Clear any pending hide timeout
    if (tooltipHideTimeout) {
      clearTimeout(tooltipHideTimeout);
      tooltipHideTimeout = null;
    }

    // Cancel any pending removal animation
    if (tooltipRemoveTimeout) {
      clearTimeout(tooltipRemoveTimeout);
      tooltipRemoveTimeout = null;
    }

    // If tooltip is already showing for this badge, just ensure it's visible
    if (activeTooltip && activeBadge === badge && activeTooltip.parentNode) {
      activeTooltip.classList.add('visible');
      positionTooltip(badge, activeTooltip);
      return;
    }

    // Remove existing tooltip if any (for a different badge)
    if (activeTooltip && activeBadge !== badge) {
      hideTooltip();
    }

    // All summaries now use Claude styling
    const tooltipClass = 'summary-tooltip claude-tooltip';
    const iconClass = 'fas fa-robot';
    const sourceName = 'Claude AI';

    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.className = tooltipClass;
    tooltip.innerHTML = `
      <div class="summary-tooltip-header">
        <i class="${iconClass}"></i>
        <span>${escapeHtml(albumName)} - ${escapeHtml(artist)}</span>
      </div>
      <div class="summary-tooltip-content">${escapeHtml(summary)}</div>
      <div class="summary-tooltip-footer">
        <span class="summary-tooltip-link" style="cursor: default; opacity: 0.7;">
          <i class="fas fa-robot"></i>
          Generated by ${sourceName}
        </span>
      </div>
    `;

    // Add event listeners to tooltip for hover persistence
    tooltip.addEventListener('mouseenter', handleTooltipMouseEnter);
    tooltip.addEventListener('mouseleave', handleTooltipMouseLeave);

    document.body.appendChild(tooltip);
    activeTooltip = tooltip;
    activeBadge = badge; // Track which badge this tooltip is for

    // Position tooltip to the right of the badge, top-aligned
    positionTooltip(badge, tooltip);

    // Show tooltip with animation
    requestAnimationFrame(() => {
      tooltip.classList.add('visible');
    });
  }

  /**
   * Format a recommendation date for display.
   * @param {string} dateStr - ISO date string
   * @returns {string} Formatted date (e.g. "Jan 15, 2025")
   */
  function formatRecommendationDate(dateStr) {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch (_e) {
      return '';
    }
  }

  /**
   * Handle mouse enter on recommendation badge (creates styled tooltip)
   * @param {MouseEvent} e - Mouse event
   */
  function handleRecommendationBadgeMouseEnter(e) {
    const badge = e.currentTarget;
    const recommendedBy = badge.dataset.recommendedBy;
    const recommendedAt = badge.dataset.recommendedAt;
    const albumName = badge.dataset.albumName;
    const artist = badge.dataset.artist;

    if (!recommendedBy) return;

    // Clear any pending hide/removal timeouts
    if (tooltipHideTimeout) {
      clearTimeout(tooltipHideTimeout);
      tooltipHideTimeout = null;
    }
    if (tooltipRemoveTimeout) {
      clearTimeout(tooltipRemoveTimeout);
      tooltipRemoveTimeout = null;
    }

    // If tooltip already showing for this badge, just reposition
    if (activeTooltip && activeBadge === badge && activeTooltip.parentNode) {
      activeTooltip.classList.add('visible');
      positionTooltip(badge, activeTooltip);
      return;
    }

    // Remove existing tooltip if showing for a different badge
    if (activeTooltip && activeBadge !== badge) {
      hideTooltip();
    }

    const dateDisplay = formatRecommendationDate(recommendedAt);

    const tooltip = document.createElement('div');
    tooltip.className = 'summary-tooltip recommendation-tooltip';
    tooltip.innerHTML = `
      <div class="summary-tooltip-header">
        <i class="fas fa-thumbs-up"></i>
        <span>${escapeHtml(albumName)} - ${escapeHtml(artist)}</span>
      </div>
      <div class="summary-tooltip-content">
        Recommended by <strong style="color: #bfdbfe;">${escapeHtml(recommendedBy)}</strong>${dateDisplay ? ` on ${dateDisplay}` : ''}
      </div>
    `;

    tooltip.addEventListener('mouseenter', handleTooltipMouseEnter);
    tooltip.addEventListener('mouseleave', handleTooltipMouseLeave);

    document.body.appendChild(tooltip);
    activeTooltip = tooltip;
    activeBadge = badge;

    positionTooltip(badge, tooltip);

    requestAnimationFrame(() => {
      tooltip.classList.add('visible');
    });
  }

  /**
   * Handle mouse leave on summary badge
   */
  function handleBadgeMouseLeave(e) {
    const badge = e.currentTarget;
    // Only schedule hide if this badge is the one showing the tooltip
    // This prevents hiding when moving between badges
    if (activeBadge === badge) {
      scheduleHideTooltip();
    }
  }

  /**
   * Show mobile recommendation sheet (similar to mobile summary sheet).
   * @param {HTMLElement} badge - The recommendation badge element
   */
  function showMobileRecommendationSheet(badge) {
    const recommendedBy = badge.dataset.recommendedBy;
    const recommendedAt = badge.dataset.recommendedAt;
    const albumName = badge.dataset.albumName;
    const artist = badge.dataset.artist;

    if (!recommendedBy) return;

    const dateDisplay = formatRecommendationDate(recommendedAt);

    // Remove any existing recommendation modals
    const existing = document.querySelectorAll('[data-recommendation-modal]');
    existing.forEach((m) => m.remove());

    // Hide FAB when modal is shown
    const fab = document.getElementById('addAlbumFAB');
    if (fab) {
      fab.style.display = 'none';
    }

    const modal = document.createElement('div');
    modal.className =
      'fixed inset-0 z-50 flex items-center justify-center p-4 safe-area-modal';
    modal.setAttribute('data-recommendation-modal', 'true');
    modal.innerHTML = `
      <div class="absolute inset-0 bg-black bg-opacity-50" data-backdrop></div>
      <div class="relative bg-gray-900 rounded-lg shadow-2xl flex flex-col w-full max-w-lg overflow-hidden">
        <div class="flex items-center justify-between p-4 border-b border-gray-800 shrink-0">
          <button data-close-rec class="p-2 -m-2 text-gray-400 hover:text-white active:text-white">
            <i class="fas fa-times text-xl"></i>
          </button>
          <div class="flex-1 text-center px-4">
            <div class="flex items-center justify-center gap-2 mb-1">
              <i class="fas fa-thumbs-up text-blue-400"></i>
              <h3 class="text-lg font-semibold text-white truncate">${escapeHtml(albumName)}</h3>
            </div>
            <p class="text-sm text-gray-400 truncate">${escapeHtml(artist)}</p>
          </div>
          <div class="w-10"></div>
        </div>
        <div class="p-4">
          <p class="text-sm text-gray-300 leading-relaxed">
            Recommended by <strong class="text-blue-300">${escapeHtml(recommendedBy)}</strong>${dateDisplay ? ` on ${dateDisplay}` : ''}
          </p>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
      modal.remove();
      const fabEl = document.getElementById('addAlbumFAB');
      if (fabEl && getCurrentList()) {
        fabEl.style.display = 'flex';
      }
    };

    const backdrop = modal.querySelector('[data-backdrop]');
    if (backdrop) backdrop.addEventListener('click', closeModal);

    const closeBtn = modal.querySelector('[data-close-rec]');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      });
    }
  }

  /**
   * Handle mouse enter on tooltip (keep it visible)
   */
  function handleTooltipMouseEnter() {
    if (tooltipHideTimeout) {
      clearTimeout(tooltipHideTimeout);
      tooltipHideTimeout = null;
    }
  }

  /**
   * Handle mouse leave on tooltip
   */
  function handleTooltipMouseLeave() {
    scheduleHideTooltip();
  }

  /**
   * Schedule hiding the tooltip with short delay
   */
  function scheduleHideTooltip() {
    if (tooltipHideTimeout) {
      clearTimeout(tooltipHideTimeout);
    }
    tooltipHideTimeout = setTimeout(() => {
      hideTooltip();
      tooltipHideTimeout = null;
    }, TOOLTIP_HIDE_DELAY);
  }

  /**
   * Hide and remove the active tooltip
   */
  function hideTooltip() {
    if (activeTooltip) {
      activeTooltip.classList.remove('visible');
      // Remove after animation
      tooltipRemoveTimeout = setTimeout(() => {
        if (activeTooltip && activeTooltip.parentNode) {
          activeTooltip.parentNode.removeChild(activeTooltip);
        }
        activeTooltip = null;
        activeBadge = null;
        tooltipRemoveTimeout = null;
      }, 200);
    }
  }

  /**
   * Position tooltip to the right of the badge
   * @param {HTMLElement} badge - Badge element
   * @param {HTMLElement} tooltip - Tooltip element
   */
  function positionTooltip(badge, tooltip) {
    const badgeRect = badge.getBoundingClientRect();
    const tooltipWidth = 320; // Match CSS width
    const gap = 8; // Gap between badge and tooltip

    // Position to the right of the badge, top-aligned
    let left = badgeRect.right + gap;
    let top = badgeRect.top;

    // Check if tooltip would overflow right edge of viewport
    if (left + tooltipWidth > window.innerWidth - 16) {
      // Position to the left of the badge instead
      left = badgeRect.left - tooltipWidth - gap;

      // Check if left position would overflow left edge
      if (left < 16) {
        // Center tooltip horizontally in viewport
        left = Math.max(16, (window.innerWidth - tooltipWidth) / 2);
      }
    }

    // Check if tooltip would overflow bottom of viewport
    const tooltipHeight = Math.min(400, tooltip.scrollHeight || 300);
    if (top + tooltipHeight > window.innerHeight - 16) {
      top = window.innerHeight - tooltipHeight - 16;
    }

    // Ensure tooltip doesn't go above viewport
    if (top < 16) {
      top = 16;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  /**
   * Open album cover preview with smooth animation
   * @param {HTMLElement} coverImage - The cover image element clicked
   */
  function openCoverPreview(coverImage) {
    // Don't open if already active or image is placeholder
    if (coverPreviewActive || coverImage.src === PLACEHOLDER_GIF) return;

    // Get high-quality image source
    const highQualitySrc = coverImage.dataset.lazySrc || coverImage.src;
    if (!highQualitySrc || highQualitySrc === PLACEHOLDER_GIF) return;

    // Get original position
    const originalRect = coverImage.getBoundingClientRect();

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'album-cover-preview-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0);
      z-index: 9998;
      cursor: zoom-out;
      transition: background 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    `;

    // Create clone
    const clone = document.createElement('img');
    clone.src = highQualitySrc;
    clone.className = 'album-cover-preview-clone';
    clone.style.cssText = `
      position: fixed;
      left: ${originalRect.left}px;
      top: ${originalRect.top}px;
      width: ${originalRect.width}px;
      height: ${originalRect.height}px;
      object-fit: contain;
      z-index: 9999;
      cursor: zoom-out;
      border-radius: 0.125rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(clone);

    // Store state
    coverPreviewActive = { overlay, clone, originalRect };

    // Blur background rows
    const albumContainer = document.getElementById('albumContainer');
    if (albumContainer) {
      albumContainer.classList.add('album-cover-preview-active');
    }

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Animate after paint
    requestAnimationFrame(() => {
      // Calculate centered position (0.64 = 75% of original 0.85)
      const maxHeight = window.innerHeight * 0.64;
      const maxWidth = window.innerWidth * 0.64;

      // Determine final size (maintain aspect ratio)
      const aspectRatio = originalRect.width / originalRect.height;
      let finalWidth, finalHeight;

      if (aspectRatio > 1) {
        // Landscape
        finalWidth = Math.min(maxWidth, maxHeight * aspectRatio);
        finalHeight = finalWidth / aspectRatio;
      } else {
        // Portrait or square
        finalHeight = Math.min(maxHeight, maxWidth / aspectRatio);
        finalWidth = finalHeight * aspectRatio;
      }

      const finalLeft = (window.innerWidth - finalWidth) / 2;
      const finalTop = (window.innerHeight - finalHeight) / 2;

      // Animate overlay
      overlay.style.background = 'rgba(0, 0, 0, 0.85)';

      // Animate clone
      clone.style.left = `${finalLeft}px`;
      clone.style.top = `${finalTop}px`;
      clone.style.width = `${finalWidth}px`;
      clone.style.height = `${finalHeight}px`;
      clone.style.borderRadius = '0.5rem';
      clone.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.8)';
    });

    // Close on click
    const closePreview = () => closeCoverPreview();
    overlay.addEventListener('click', closePreview);
    clone.addEventListener('click', closePreview);
  }

  /**
   * Close album cover preview with smooth animation
   */
  function closeCoverPreview() {
    if (!coverPreviewActive) return;

    const { overlay, clone, originalRect } = coverPreviewActive;

    // Animate back to original position
    overlay.style.background = 'rgba(0, 0, 0, 0)';
    clone.style.left = `${originalRect.left}px`;
    clone.style.top = `${originalRect.top}px`;
    clone.style.width = `${originalRect.width}px`;
    clone.style.height = `${originalRect.height}px`;
    clone.style.borderRadius = '0.125rem';
    clone.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.25)';

    // Remove blur from background
    const albumContainer = document.getElementById('albumContainer');
    if (albumContainer) {
      albumContainer.classList.remove('album-cover-preview-active');
    }

    // Restore body scroll
    document.body.style.overflow = '';

    // Remove elements after animation
    setTimeout(() => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (clone.parentNode) clone.parentNode.removeChild(clone);
    }, 400);

    coverPreviewActive = null;
  }

  /**
   * Handle ESC key to close cover preview
   * @param {KeyboardEvent} e - Keyboard event
   */
  function handleCoverPreviewKeydown(e) {
    if (e.key === 'Escape' && coverPreviewActive) {
      closeCoverPreview();
    }
  }

  /**
   * Add visual banner indicating the year is locked
   * @param {HTMLElement} container - Container element
   * @param {number} year - Locked year
   */
  function addYearLockedBanner(container, year) {
    // Remove existing banner if present
    const existingBanner = container.querySelector('.year-locked-banner');
    if (existingBanner) {
      existingBanner.remove();
    }

    // Create lock banner
    const banner = document.createElement('div');
    banner.className =
      'year-locked-banner bg-yellow-900 bg-opacity-20 border border-yellow-700 rounded-lg p-3 mb-4 flex items-center gap-3 text-yellow-200';
    banner.innerHTML = `
      <i class="fas fa-lock text-yellow-500"></i>
      <span class="text-sm">
        Year ${year} is locked. You cannot reorder, add, or edit albums in this list.
      </span>
    `;

    // Insert at the beginning of the container
    container.insertBefore(banner, container.firstChild);
  }

  /**
   * Main display function - renders albums to the container
   * @param {Array} albums - Album array to display
   * @param {Object} options - Display options
   * @param {boolean} options.forceFullRebuild - Force full rebuild
   * @param {boolean} options.skipCoverFetch - Skip fetching covers (useful for field-only updates)
   */
  function displayAlbums(albums, options = {}) {
    const { forceFullRebuild = false, _skipCoverFetch = false } = options;
    const isMobile = window.innerWidth < 1024;
    const container = document.getElementById('albumContainer');

    if (!container) {
      console.error('Album container not found!');
      return;
    }

    // Try incremental update first using fingerprint comparison
    if (!forceFullRebuild) {
      const newFingerprint = generateAlbumFingerprint(albums);

      // Quick fingerprint check - if unchanged, no update needed at all
      if (newFingerprint === lastRenderedFingerprint) {
        return; // No changes detected
      }

      const updateType = detectUpdateType(lastRenderedMutableState, albums);

      // Handle single album addition
      if (
        updateType &&
        typeof updateType === 'object' &&
        updateType.type === 'SINGLE_ADD'
      ) {
        const success = insertAlbumAtIndex(albums, updateType.index, isMobile);

        if (success) {
          // Update lightweight state
          requestAnimationFrame(() => {
            lastRenderedFingerprint = newFingerprint;
            lastRenderedMutableState = extractMutableFingerprints(albums);
          });

          reapplyNowPlayingBorder();
          console.log(`Album inserted at index ${updateType.index}`);
          return;
        }
        console.warn('Single add failed, falling back to full rebuild');
      }

      // Handle single album removal
      if (
        updateType &&
        typeof updateType === 'object' &&
        updateType.type === 'SINGLE_REMOVE'
      ) {
        const success = removeAlbumAtIndex(updateType.index, isMobile);

        if (success) {
          // Update lightweight state
          requestAnimationFrame(() => {
            lastRenderedFingerprint = newFingerprint;
            lastRenderedMutableState = extractMutableFingerprints(albums);
          });

          reapplyNowPlayingBorder();
          console.log(`Album removed from index ${updateType.index}`);
          return;
        }
        console.warn('Single remove failed, falling back to full rebuild');
      }

      // FIELD_UPDATE and HYBRID_UPDATE don't need cover refetch - covers don't change
      if (updateType === 'FIELD_UPDATE' || updateType === 'HYBRID_UPDATE') {
        const success = updateAlbumFields(albums, isMobile);

        if (success && verifyDOMIntegrity(albums, isMobile)) {
          // Update lightweight state instead of expensive deep clone
          requestAnimationFrame(() => {
            lastRenderedFingerprint = newFingerprint;
            lastRenderedMutableState = extractMutableFingerprints(albums);
          });

          const albumContainer = isMobile
            ? container.querySelector('.mobile-album-list')
            : container.querySelector('.album-rows-container');
          if (albumContainer) {
            prePopulatePositionCache(albumContainer, isMobile);
          }

          reapplyNowPlayingBorder();
          return;
        }
        console.warn(
          `Incremental update (${updateType}) failed, falling back to full rebuild`
        );
      }
    }

    // Full rebuild path - clear element caches
    positionElementCache = new WeakMap();
    rowElementsCache = new WeakMap();

    let albumContainer;

    if (!albums || albums.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'text-center text-gray-500 mt-20 px-4';
      emptyDiv.innerHTML = `
        <p class="text-xl mb-2">This list is empty</p>
        <p class="text-sm">Click the + button to add albums${isMobile ? '' : ' or use the Add Album button'}</p>
      `;
      container.replaceChildren(emptyDiv);
      return;
    }

    if (!isMobile) {
      // Desktop: Table layout with header
      // Create header as direct child of scrolling container
      const header = document.createElement('div');
      header.className =
        'album-header album-grid gap-4 py-2 text-base font-semibold uppercase tracking-wider text-gray-200 border-b border-gray-800 sticky top-0 bg-black z-10 shrink-0';
      header.style.alignItems = 'center';
      header.innerHTML = `
        <div class="text-center"></div>
        <div>Album</div>
        <div></div>
        <div>Artist</div>
        <div>Country</div>
        <div>Genre 1</div>
        <div>Genre 2</div>
        <div>Track</div>
        <div>Comment</div>
        <div>Comment 2</div>
      `;

      // Create rows container
      const rowsContainer = document.createElement('div');
      rowsContainer.className = 'album-rows-container relative flex-1';

      const fragment = document.createDocumentFragment();
      albums.forEach((album, index) => {
        const row = createAlbumItem(album, index, false);
        fragment.appendChild(row);
      });
      rowsContainer.appendChild(fragment);

      // Create a fragment to hold both header and rows
      albumContainer = document.createDocumentFragment();
      albumContainer.appendChild(header);
      albumContainer.appendChild(rowsContainer);
    } else {
      // Mobile: Card layout
      albumContainer = document.createElement('div');
      albumContainer.className = 'mobile-album-list';

      const fragment = document.createDocumentFragment();
      albums.forEach((album, index) => {
        const card = createAlbumItem(album, index, true);
        fragment.appendChild(card);
      });
      albumContainer.appendChild(fragment);
    }

    container.replaceChildren(albumContainer);

    // Note: After replaceChildren, if albumContainer was a DocumentFragment,
    // it's now empty - the children are in `container`. Use `container` for lookups.
    prePopulatePositionCache(container, isMobile);

    // Only enable sorting if the list is not locked (main list in locked year)
    const currentList = getCurrentList();
    const listMeta = getListMetadata(currentList);
    const listYear = listMeta?.year || null;
    const listIsMain = listMeta?.isMain || false;

    if (listYear && listIsMain) {
      // Only check lock status for main lists
      isListLocked(listYear, listIsMain).then((locked) => {
        if (!locked) {
          initializeUnifiedSorting(container, isMobile);
          // Remove lock banner if it exists
          const existingBanner = container.querySelector('.year-locked-banner');
          if (existingBanner) {
            existingBanner.remove();
          }
        } else {
          // Main list is locked - destroy any existing sortable instance
          if (destroySorting) {
            destroySorting(container);
          }
          // Add visual indicator that the list is locked
          addYearLockedBanner(container, listYear);
        }
      });
    } else {
      // Non-main lists or collections - always enable sorting
      initializeUnifiedSorting(container, isMobile);
      // Remove lock banner if it exists
      const existingBanner = container.querySelector('.year-locked-banner');
      if (existingBanner) {
        existingBanner.remove();
      }
    }

    // Initialize lazy loading for album cover images
    observeLazyImages(container);

    // Initialize Last.fm summary tooltips (desktop only)
    if (!isMobile) {
      initLastfmTooltips(container);
    }

    // Update lightweight state instead of expensive deep clone
    requestAnimationFrame(() => {
      lastRenderedFingerprint = generateAlbumFingerprint(albums);
      lastRenderedMutableState = extractMutableFingerprints(albums);
    });

    reapplyNowPlayingBorder();
  }

  /**
   * Clear the last rendered albums cache
   * Used when switching lists
   */
  function clearLastRenderedCache() {
    lastRenderedFingerprint = null;
    lastRenderedMutableState = null;
  }

  /**
   * Clear the playcount cache
   * Used when switching lists or users
   */
  function clearPlaycountCache() {
    // Cancel all active polling sessions
    pollingControllers.forEach((controller) => {
      controller.abort();
    });
    pollingControllers.clear();

    playcountCache = {};
  }

  /**
   * Cancel active polling for a specific list
   * @param {string} listId - List ID to cancel polling for
   */
  function cancelPollingForList(listId) {
    const controller = pollingControllers.get(listId);
    if (controller) {
      controller.abort();
      pollingControllers.delete(listId);
    }
  }

  /**
   * Fetch and display playcounts for a list from Last.fm
   * @param {string} listId - List ID to fetch playcounts for
   * @param {boolean} forceRefresh - Force refresh stale data
   */
  async function fetchAndDisplayPlaycounts(listId, forceRefresh = false) {
    if (!listId || playcountFetchInProgress) return;

    playcountFetchInProgress = true;

    try {
      const response = await apiCall(
        `/api/lastfm/list-playcounts/${listId}${forceRefresh ? '?refresh=true' : ''}`
      );

      if (response.error) {
        // User might not have Last.fm connected - that's OK
        if (response.error !== 'Last.fm not connected') {
          console.warn('Failed to fetch playcounts:', response.error);
        }
        return;
      }

      const { playcounts, refreshing } = response;

      // Update cache
      Object.assign(playcountCache, playcounts);

      // Update DOM elements
      updatePlaycountElements(playcounts);

      // If background refresh is happening, poll for updates until complete
      if (refreshing > 0) {
        pollForRefreshedPlaycounts(listId, refreshing);
      }
    } catch (err) {
      // Silently fail - playcounts are not critical
      console.warn('Playcount fetch error:', err);
    } finally {
      playcountFetchInProgress = false;
    }
  }

  /**
   * Update playcount elements in the DOM
   * @param {Object} playcounts - Map of itemId to { playcount, status } or null
   */
  function updatePlaycountElements(playcounts) {
    for (const [itemId, data] of Object.entries(playcounts)) {
      // Skip if no data yet
      if (data === null || data === undefined) continue;

      const { playcount, status } = data;

      // Update desktop elements
      const desktopEl = document.querySelector(`[data-playcount="${itemId}"]`);
      if (desktopEl) {
        if (status === 'not_found') {
          // Album not found - show red X
          desktopEl.innerHTML = `<i class="fas fa-times text-[10px]"></i>`;
          desktopEl.title = 'Album not found on Last.fm';
          desktopEl.className = 'text-xs text-red-500 shrink-0';
          desktopEl.dataset.status = 'not_found';
          desktopEl.classList.remove('hidden');
        } else if (status === 'success') {
          // Success - show playcount
          const display = formatPlaycount(playcount);
          desktopEl.innerHTML = `<i class="fas fa-headphones text-[10px] mr-1"></i>${display}`;
          desktopEl.title = `${playcount} plays on Last.fm`;
          desktopEl.className = 'text-xs text-gray-500 shrink-0';
          desktopEl.dataset.status = 'success';
          desktopEl.classList.remove('hidden');
        }
        // For 'error' status, keep hidden (will retry later)
      }

      // Update mobile elements
      const mobileEl = document.querySelector(
        `[data-playcount-mobile="${itemId}"]`
      );
      if (mobileEl) {
        if (status === 'not_found') {
          // Album not found - show red X
          mobileEl.innerHTML = `<i class="fas fa-times text-[10px]"></i>`;
          mobileEl.title = 'Album not found on Last.fm';
          mobileEl.className = 'text-red-500 ml-4';
          mobileEl.dataset.status = 'not_found';
          mobileEl.classList.remove('hidden');
        } else if (status === 'success') {
          // Success - show playcount
          const display = formatPlaycount(playcount);
          mobileEl.innerHTML = `<i class="fas fa-headphones text-[10px]"></i> ${display}`;
          mobileEl.className = 'text-gray-600 ml-4';
          mobileEl.dataset.status = 'success';
          mobileEl.classList.remove('hidden');
        }
        // For 'error' status, keep hidden (will retry later)
      }
    }
  }

  /**
   * Poll for refreshed playcounts until all data is loaded
   * @param {string} listId - List ID
   * @param {number} expectedCount - Number of albums being refreshed
   */
  async function pollForRefreshedPlaycounts(listId, expectedCount) {
    // Cancel any existing polling for this list before starting new session
    cancelPollingForList(listId);

    // Create new AbortController for this polling session
    const controller = new AbortController();
    pollingControllers.set(listId, controller);
    const { signal } = controller;

    // Calculate expected time: ~5 albums per batch, ~1.1s per batch
    // With variant detection, each album may take longer (multiple API calls)
    const estimatedBatches = Math.ceil(expectedCount / 3);
    const estimatedTimeMs = estimatedBatches * 1500 + 3000; // Add buffer for variant lookups

    // Poll interval and max attempts
    const POLL_INTERVAL = 3000; // Poll every 3 seconds
    const MAX_POLLS = Math.max(
      5,
      Math.ceil(estimatedTimeMs / POLL_INTERVAL) + 2
    );

    // Minimum polls to ensure we catch background refresh updates
    // Even if no nulls, we should poll at least a few times for stale data updates
    const MIN_POLLS = 3;

    let pollCount = 0;
    let previousPlaycounts = { ...playcountCache };

    const poll = async () => {
      // Check if polling was cancelled
      if (signal.aborted) {
        return;
      }

      pollCount++;

      try {
        const response = await apiCall(
          `/api/lastfm/list-playcounts/${listId}`,
          {
            signal,
          }
        );

        if (response.playcounts) {
          // Check if any values changed since last poll
          // Compare by playcount and status since values are now objects
          let changedCount = 0;
          for (const [itemId, data] of Object.entries(response.playcounts)) {
            const prev = previousPlaycounts[itemId];
            const hasChanged =
              (data === null) !== (prev === null) ||
              (data &&
                prev &&
                (data.playcount !== prev.playcount ||
                  data.status !== prev.status));
            if (hasChanged) {
              changedCount++;
            }
          }

          // Update cache and DOM
          Object.assign(playcountCache, response.playcounts);
          updatePlaycountElements(response.playcounts);
          previousPlaycounts = JSON.parse(JSON.stringify(response.playcounts));

          // Count how many are still null/missing (not yet fetched or error)
          const missingCount = Object.values(response.playcounts).filter(
            (v) => v === null || (v && v.status === 'error')
          ).length;

          // Log progress
          if (changedCount > 0) {
            console.log(
              `Playcounts updated: ${changedCount} changed, ${missingCount} missing`
            );
          }

          // Stop conditions:
          // 1. All loaded (no nulls) AND no changes AND polled at least MIN_POLLS times
          // 2. Reached MAX_POLLS
          if (
            missingCount === 0 &&
            changedCount === 0 &&
            pollCount >= MIN_POLLS
          ) {
            console.log('All playcounts loaded');
            pollingControllers.delete(listId); // Clean up on success
            return;
          }

          // Continue polling if under max
          if (pollCount < MAX_POLLS) {
            // If values are still changing or nulls remain, poll at normal rate
            // Otherwise slow down
            const interval =
              changedCount > 0 || missingCount > 0
                ? POLL_INTERVAL
                : POLL_INTERVAL * 1.5;
            setTimeout(poll, interval);
          } else {
            // Max polls reached, clean up
            pollingControllers.delete(listId);
          }
        }
      } catch (err) {
        // Polling was cancelled - exit cleanly
        if (err.name === 'AbortError') {
          console.log(`Playcount polling cancelled for list ${listId}`);
          return;
        }

        // List was deleted (404) - stop polling
        if (err.message?.includes('List not found')) {
          console.log(
            `List ${listId} no longer exists, stopping playcount poll`
          );
          pollingControllers.delete(listId); // Clean up controller reference
          return;
        }

        console.warn('Playcount poll failed:', err);
        // Retry if under max and not aborted
        if (pollCount < MAX_POLLS && !signal.aborted) {
          setTimeout(poll, POLL_INTERVAL);
        }
      }
    };

    // Start polling after initial delay
    setTimeout(poll, POLL_INTERVAL);
  }

  /**
   * Update summary for a single album without full refresh
   * @param {string} albumId - Album ID to update
   * @param {Object} summaryData - Summary data from API
   * @param {string} summaryData.summary - Summary text
   * @param {string} summaryData.summarySource - Summary source
   */
  async function updateAlbumSummaryInPlace(albumId, summaryData) {
    const isMobile = window.innerWidth < 1024;
    const container = document.getElementById('albumContainer');
    if (!container) return;

    // Find album row/card by album_id
    const albumRows = isMobile
      ? container.querySelectorAll('.album-card')
      : container.querySelectorAll('.album-row');

    for (const row of albumRows) {
      // Try to find album_id from row dataset or nested element
      const rowIndex = parseInt(row.dataset.index, 10);
      if (rowIndex === undefined || rowIndex < 0) continue;

      const currentList = getCurrentList();
      const albums = getListData(currentList);
      const album = albums?.[rowIndex];

      if (album && album.album_id === albumId) {
        // Found the album - update summary badge
        const coverContainer = row.querySelector(
          '.album-cover-container, .mobile-album-cover'
        );
        if (!coverContainer) continue;

        const badge = coverContainer.querySelector(
          '.summary-badge, .summary-badge-mobile'
        );

        if (summaryData.summary) {
          // Add or update badge
          if (!badge) {
            // Create badge (reuse existing badge creation logic)
            const data = processAlbumData(album, rowIndex);
            const source = summaryData.summarySource || '';
            const badgeClass = 'claude-badge';
            const iconClass = 'fas fa-robot';
            const badgeClassMobile = isMobile ? 'summary-badge-mobile' : '';

            const badgeHtml = `<div class="summary-badge ${badgeClassMobile} ${badgeClass}" 
              data-summary="${escapeHtml(summaryData.summary)}" 
              data-source-url="" 
              data-source="${escapeHtml(source)}"
              data-album-name="${escapeHtml(data.albumName)}" 
              data-artist="${escapeHtml(data.artist)}">
              <i class="${iconClass}"></i>
            </div>`;

            // Insert badge into cover container
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = badgeHtml;
            const newBadge = tempDiv.firstElementChild;
            coverContainer.appendChild(newBadge);

            // Attach event handlers for the new badge
            if (isMobile && showMobileSummarySheet) {
              newBadge.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                showMobileSummarySheet(
                  summaryData.summary,
                  data.albumName,
                  data.artist
                );
              });
            } else {
              newBadge.addEventListener('mouseenter', handleBadgeMouseEnter);
              newBadge.addEventListener('mouseleave', handleBadgeMouseLeave);
            }
          } else {
            // Update existing badge
            badge.dataset.summary = escapeHtml(summaryData.summary);
            badge.dataset.source = escapeHtml(summaryData.summarySource || '');
          }
        } else if (badge) {
          // Remove badge if summary was removed
          badge.remove();
        }

        // Update local state
        if (album) {
          album.summary = summaryData.summary || '';
          album.summary_source = summaryData.summarySource || '';
        }

        break;
      }
    }
  }

  // Set up global event listeners for cover preview
  document.addEventListener('keydown', handleCoverPreviewKeydown);

  // Return public API
  return {
    displayAlbums,
    fetchAndDisplayPlaycounts,
    updatePositionNumbers,
    clearLastRenderedCache,
    clearPlaycountCache,
    cancelPollingForList,
    updateAlbumSummaryInPlace,
    invalidateFingerprint,
    // Granular DOM updates
    insertAlbumAtIndex,
    removeAlbumAtIndex,
    // Expose for testing
    processAlbumData,
    createAlbumItem,
    detectUpdateType,
  };
}
