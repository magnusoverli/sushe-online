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

// Feature flag for incremental updates (can be disabled if issues arise)
const ENABLE_INCREMENTAL_UPDATES = true;

// Module-level state
// Store lightweight fingerprint instead of deep-cloned array for performance
let lastRenderedFingerprint = null;
// Store only mutable fields needed for detectUpdateType (no cover_image)
let lastRenderedMutableState = null;
let positionElementCache = new WeakMap();

// Cache all frequently-updated DOM elements per row for faster incremental updates
// Structure: WeakMap<row, { position, artist, country, genre1, genre2, comment, track, releaseDate }>
let rowElementsCache = new WeakMap();

// Lazy loading observer for album cover images
let coverImageObserver = null;

// 1x1 transparent GIF placeholder for lazy loading
const PLACEHOLDER_GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

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
 * @param {Array} albums - Album array
 * @returns {string} Fingerprint string
 */
function generateAlbumFingerprint(albums) {
  if (!albums || albums.length === 0) return '';
  return albums
    .map(
      (a) =>
        `${a._id || ''}|${a.track_pick || ''}|${a.country || ''}|${a.genre_1 || ''}|${a.genre_2 || ''}|${a.comments || ''}`
    )
    .join('::');
}

/**
 * Extract lightweight mutable state for detectUpdateType comparisons
 * Excludes heavy fields like cover_image to avoid expensive cloning
 * @param {Array} albums - Album array
 * @returns {Array} Array of lightweight album objects
 */
function extractMutableState(albums) {
  if (!albums || albums.length === 0) return null;
  return albums.map((a) => ({
    _id: a._id,
    artist: a.artist,
    album: a.album,
    release_date: a.release_date,
    country: a.country,
    genre_1: a.genre_1,
    genre_2: a.genre_2,
    comments: a.comments,
    track_pick: a.track_pick,
  }));
}

// Last.fm playcount cache: { listItemId: playcount }
let playcountCache = {};
let playcountFetchInProgress = false;

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
 * @param {Function} deps.attachLinkPreview - Attach link preview to element
 * @param {Function} deps.showTrackSelectionMenu - Show track selection menu
 * @param {Function} deps.showMobileEditForm - Show mobile edit form
 * @param {Function} deps.showMobileAlbumMenu - Show mobile album menu
 * @param {Function} deps.showMobileSummarySheet - Show mobile summary sheet
 * @param {Function} deps.playTrackSafe - Play track safely by album ID
 * @param {Function} deps.reapplyNowPlayingBorder - Re-apply now playing border
 * @param {Function} deps.initializeUnifiedSorting - Initialize drag-drop sorting
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
    attachLinkPreview,
    showTrackSelectionMenu,
    showMobileEditForm,
    showMobileAlbumMenu,
    showMobileSummarySheet,
    playTrackSafe,
    reapplyNowPlayingBorder,
    initializeUnifiedSorting,
    setContextAlbum,
    getTrackName,
  } = deps;

  /**
   * Process album data into display-ready format
   * @param {Object} album - Raw album data
   * @param {number} index - Album index in list
   * @returns {Object} Processed album data for rendering
   */
  function processAlbumData(album, index) {
    const currentList = getCurrentList();
    const position = index + 1;
    const albumId = album.album_id || '';
    const albumName = album.album || 'Unknown Album';
    const artist = album.artist || 'Unknown Artist';
    const rawReleaseDate = album.release_date || '';
    const releaseDate = formatReleaseDate(rawReleaseDate);

    // Check for year mismatch with current list
    const listMeta = getListMetadata(currentList);
    const listYear = listMeta?.year || null;
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

    // Support both URL-based images (new) and base64 (fallback/legacy)
    const coverImageUrl = album.cover_image_url || '';
    const coverImage = album.cover_image || '';
    const imageFormat = album.cover_image_format || 'PNG';

    // Process track pick
    const trackPick = album.track_pick || '';
    let trackPickDisplay = '';
    let trackPickClass = 'text-gray-800 italic';

    if (trackPick && album.tracks && Array.isArray(album.tracks)) {
      const trackMatch = album.tracks.find(
        (t) => getTrackName(t) === trackPick
      );
      if (trackMatch) {
        const trackName = getTrackName(trackMatch);
        const match = trackName.match(/^(\d+)[.\s-]?\s*(.*)$/);
        if (match) {
          const trackNum = match[1];
          const displayName = match[2] || '';
          trackPickDisplay = displayName
            ? `${trackNum}. ${displayName}`
            : `Track ${trackNum}`;
          trackPickClass = 'text-gray-300';
        } else {
          trackPickDisplay = trackName;
          trackPickClass = 'text-gray-300';
        }
      } else if (trackPick.match(/^\d+$/)) {
        trackPickDisplay = `Track ${trackPick}`;
        trackPickClass = 'text-gray-300';
      } else {
        trackPickDisplay = trackPick;
        trackPickClass = 'text-gray-300';
      }
    }

    if (!trackPickDisplay) {
      trackPickDisplay = 'Select Track';
    }

    // Album summary (from Last.fm or Wikipedia)
    const summary = album.summary || '';
    const lastfmUrl = album.lastfm_url || album.lastfmUrl || '';
    const wikipediaUrl = album.wikipedia_url || album.wikipediaUrl || '';
    const summarySource = album.summary_source || album.summarySource || '';

    // Get playcount from cache (keyed by list item _id)
    const itemId = album._id || '';
    const playcount = playcountCache[itemId];
    const playcountDisplay = formatPlaycount(playcount);

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
      coverImageUrl,
      coverImage,
      imageFormat,
      trackPick,
      trackPickDisplay,
      trackPickClass,
      itemId,
      playcount,
      playcountDisplay,
      summary,
      lastfmUrl,
      wikipediaUrl,
      summarySource,
    };
  }

  /**
   * Format playcount for display
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
   * Escape HTML special characters for safe attribute values
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
   * Hide all context menus
   */
  function hideAllContextMenus() {
    const currentList = getCurrentList();

    const contextMenu = document.getElementById('contextMenu');
    if (contextMenu) {
      contextMenu.classList.add('hidden');
    }

    const albumContextMenu = document.getElementById('albumContextMenu');
    if (albumContextMenu) {
      albumContextMenu.classList.add('hidden');
    }

    const albumMoveSubmenu = document.getElementById('albumMoveSubmenu');
    if (albumMoveSubmenu) {
      albumMoveSubmenu.classList.add('hidden');
    }

    const playAlbumSubmenu = document.getElementById('playAlbumSubmenu');
    if (playAlbumSubmenu) {
      playAlbumSubmenu.classList.add('hidden');
    }

    // Remove highlights from submenu parent options
    const moveOption = document.getElementById('moveAlbumOption');
    const playOption = document.getElementById('playAlbumOption');
    moveOption?.classList.remove('bg-gray-700', 'text-white');
    playOption?.classList.remove('bg-gray-700', 'text-white');

    // Restore FAB visibility if a list is selected
    const fab = document.getElementById('addAlbumFAB');
    if (fab && currentList) {
      fab.style.display = 'flex';
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

    row.innerHTML = `
      <div class="flex items-center justify-center text-gray-400 font-medium text-sm position-display" data-position-element="true">${data.position}</div>
      <div class="flex items-center">
        <div class="album-cover-container">
          ${
            coverImageSrc
              ? `
            <img src="${PLACEHOLDER_GIF}" 
                data-lazy-src="${coverImageSrc}"
                alt="${data.albumName}" 
                class="album-cover rounded shadow-lg"
                loading="lazy"
                decoding="async"
                onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'album-cover-placeholder rounded bg-gray-800 shadow-lg\\'><svg width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\' class=\\'text-gray-600\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\' ry=\\'2\\'></rect><circle cx=\\'8.5\\' cy=\\'8.5\\' r=\\'1.5\\'></circle><polyline points=\\'21 15 16 10 5 21\\'></polyline></svg></div>'"
            >
          `
              : `
            <div class="album-cover-placeholder rounded bg-gray-800 shadow-lg">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-600">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
            </div>
          `
          }
          ${summaryBadgeHtml}
        </div>
      </div>
      <div class="flex flex-col justify-center">
        <div class="flex items-center gap-2">
          <span class="font-semibold text-gray-100 truncate">${data.albumName}</span>
          ${data.playcountDisplay ? `<span class="text-xs text-gray-500 flex-shrink-0" data-playcount="${data.itemId}" title="${data.playcount} plays on Last.fm"><i class="fas fa-headphones text-[10px] mr-1"></i>${data.playcountDisplay}</span>` : `<span class="text-xs text-gray-500 flex-shrink-0 hidden" data-playcount="${data.itemId}"></span>`}
        </div>
        <div class="text-xs mt-0.5 release-date-display ${data.yearMismatch ? 'text-red-500 cursor-help' : 'text-gray-400'}" ${data.yearMismatch ? `title="${data.yearMismatchTooltip}"` : ''}>${data.releaseDate}</div>
      </div>
      <div class="flex items-center">
        <span class="text-sm ${data.artist ? 'text-gray-300' : 'text-gray-800 italic'} truncate cursor-pointer hover:text-gray-100">${data.artist}</span>
      </div>
      <div class="flex items-center country-cell">
        <span class="text-sm ${data.countryClass} truncate cursor-pointer hover:text-gray-100">${data.countryDisplay}</span>
      </div>
      <div class="flex items-center genre-1-cell">
        <span class="text-sm ${data.genre1Class} truncate cursor-pointer hover:text-gray-100">${data.genre1Display}</span>
      </div>
      <div class="flex items-center genre-2-cell">
        <span class="text-sm ${data.genre2Class} truncate cursor-pointer hover:text-gray-100">${data.genre2Display}</span>
      </div>
      <div class="flex items-center comment-cell relative">
        <span class="text-sm ${data.comment ? 'text-gray-300' : 'text-gray-800 italic'} line-clamp-2 cursor-pointer hover:text-gray-100 comment-text">${data.comment || 'Comment'}</span>
      </div>
      <div class="flex items-center track-cell">
        <span class="text-sm ${data.trackPickClass} truncate cursor-pointer hover:text-gray-100" title="${data.trackPick || 'Click to select track'}">${data.trackPickDisplay}</span>
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

    // Attach link preview
    const albumsForPreview = getListData(currentList);
    const album = albumsForPreview && albumsForPreview[index];
    const comment = album ? album.comments || album.comment || '' : '';
    attachLinkPreview(commentCell, comment);

    // Add tooltip only if comment is truncated
    const commentTextEl = commentCell.querySelector('.comment-text');
    if (commentTextEl && comment) {
      setTimeout(() => {
        if (isTextTruncated(commentTextEl)) {
          commentTextEl.setAttribute('data-comment', comment);
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

      // Position the menu
      positionContextMenu(contextMenu, e.clientX, e.clientY);
    });
  }

  /**
   * Position a context menu, adjusting if it would overflow viewport
   * @param {HTMLElement} menu - Menu element
   * @param {number} x - X position
   * @param {number} y - Y position
   */
  function positionContextMenu(menu, x, y) {
    // Hide FAB when context menu is shown
    const fab = document.getElementById('addAlbumFAB');
    if (fab) {
      fab.style.display = 'none';
    }

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.remove('hidden');

    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = x;
      let adjustedY = y;

      if (rect.right > viewportWidth) {
        adjustedX = x - rect.width;
      }
      if (rect.bottom > viewportHeight) {
        adjustedY = y - rect.height;
      }

      if (adjustedX !== x || adjustedY !== y) {
        menu.style.left = `${adjustedX}px`;
        menu.style.top = `${adjustedY}px`;
      }
    });
  }

  /**
   * Create mobile album card
   * @param {Object} data - Processed album data
   * @param {number} index - Album index
   * @returns {HTMLElement} Card element
   */
  function createMobileAlbumCard(data, index) {
    const cardWrapper = document.createElement('div');
    cardWrapper.className = 'album-card-wrapper h-[110px]';

    const card = document.createElement('div');
    card.className =
      'album-card album-row bg-gray-900 transition-all relative overflow-hidden h-[110px]';
    card.dataset.index = index;

    // Determine cover image source:
    // 1. Base64 cover (takes priority - may be locally edited or custom cover)
    // 2. URL-based loading - uses coverImageUrl from API (efficient for unmodified covers)
    // 3. Placeholder if no cover available
    const mobileCoverSrc = data.coverImage
      ? `data:image/${data.imageFormat};base64,${data.coverImage}`
      : data.coverImageUrl
        ? data.coverImageUrl
        : null;

    // Summary badge HTML (shown if album has a summary from any source)
    // All summaries now use Claude badge (even if originally from Last.fm/Wikipedia)
    let mobileSummaryBadgeHtml = '';
    if (data.summary) {
      const source = data.summarySource || '';
      // Always show Claude badge for all summaries
      const badgeClass = 'claude-badge';
      const iconClass = 'fas fa-robot';
      // No source URL for Claude summaries
      const sourceUrl = null;

      mobileSummaryBadgeHtml = `<div class="summary-badge summary-badge-mobile ${badgeClass}" 
        data-summary="${escapeHtml(data.summary)}" 
        data-source-url="${escapeHtml(sourceUrl || '')}" 
        data-source="${escapeHtml(source)}"
        data-album-name="${escapeHtml(data.albumName)}" 
        data-artist="${escapeHtml(data.artist)}">
        <i class="${iconClass}"></i>
      </div>`;
    }

    card.innerHTML = `
      <!-- Position badge (upper right, above action column) -->
      <div class="absolute top-[6px] right-1 w-[17px] h-[17px] flex items-center justify-center border ${data.position === 1 ? 'border-yellow-500' : data.position === 2 ? 'border-gray-400' : data.position === 3 ? 'border-amber-700' : 'border-gray-500'} text-white text-[9px] font-medium rounded-full position-badge" 
           style="background-color: rgba(17, 24, 39, 0.4); box-shadow: 0 0 ${data.position <= 3 ? '8px' : '5px'} ${data.position === 1 ? 'rgba(255,215,0,1.0)' : data.position === 2 ? 'rgba(192,192,192,1.0)' : data.position === 3 ? 'rgba(205,127,50,1.0)' : 'rgba(255,255,255,0.25)'};"
           data-position-element="true">
        <span style="margin-top: 1px;">${data.position}</span>
      </div>
      <div class="flex items-stretch h-full bg-gray-900">
        <!-- Left section: Album cover and Release date -->
        <div class="flex-shrink-0 flex items-stretch h-full">
          <!-- Album cover with release date below -->
          <div class="flex flex-col items-center pl-[4px] pt-2 self-stretch">
            <div class="flex-shrink-0">
              ${
                mobileCoverSrc
                  ? `
                <div class="mobile-album-cover w-20 h-20 flex items-center justify-center relative">
                  <img src="${PLACEHOLDER_GIF}"
                      data-lazy-src="${mobileCoverSrc}"
                      alt="${data.albumName}"
                      class="w-[75px] h-[75px] rounded-lg object-cover album-cover-blur"
                      loading="lazy"
                      decoding="async">
                  ${mobileSummaryBadgeHtml}
                </div>
              `
                  : `
                <div class="mobile-album-cover w-20 h-20 bg-gray-800 rounded-lg shadow-md flex items-center justify-center relative">
                  <i class="fas fa-compact-disc text-xl text-gray-600"></i>
                  ${mobileSummaryBadgeHtml}
                </div>
              `
              }
            </div>
            <!-- Release date centered in remaining space below image -->
            <div class="flex-1 flex items-center">
              <div class="text-xs whitespace-nowrap release-date-display ${data.yearMismatch ? 'text-red-500' : 'text-gray-500'}" ${data.yearMismatch ? `title="${data.yearMismatchTooltip}"` : ''}>
                ${data.releaseDate}
              </div>
            </div>
          </div>
        </div>
        
        <!-- Main content -->
        <div class="flex-1 min-w-0 pt-[3px] pb-0.5 pl-[7px] flex flex-col h-[102px]">
          <!-- Line 1: Album name (always present) -->
          <div class="h-5 flex items-center -ml-[2.5px]">
            <h3 class="font-semibold text-gray-200 text-lg leading-tight truncate"><i class="fas fa-compact-disc fa-xs mr-1"></i>${data.albumName}</h3>
          </div>
          
          <!-- Line 2: Artist + Playcount -->
          <div class="h-4 flex items-center">
            <p class="text-[13px] text-gray-500 truncate">
              <i class="fas fa-user fa-xs mr-[7px]"></i>
              <span data-field="artist-mobile-text">${data.artist}</span>
              ${data.playcountDisplay ? `<span class="text-gray-600 ml-2" data-playcount-mobile="${data.itemId}">· <i class="fas fa-headphones text-[10px]"></i> ${data.playcountDisplay}</span>` : `<span class="text-gray-600 ml-2 hidden" data-playcount-mobile="${data.itemId}"></span>`}
            </p>
          </div>
          
          <!-- Line 3: Country (may be empty) -->
          <div class="h-4 flex items-center mt-[3px]">
            <span class="text-[13px] text-gray-500">
              <i class="fas fa-globe fa-xs mr-[7px]"></i>
              <span data-field="country-mobile-text">${data.country || ''}</span>
            </span>
          </div>
          
          <!-- Line 4: Genres (may be empty) -->
          <div class="h-4 flex items-center mt-[3px]">
            <span class="text-[13px] text-gray-500 truncate">
              <i class="fas fa-music fa-xs mr-[7px]"></i>
              <span data-field="genre-mobile-text">${data.genre1 && data.genre2 ? `${data.genre1} / ${data.genre2}` : data.genre1 || data.genre2 || ''}</span>
            </span>
          </div>
          
          <!-- Line 5: Track selection (clickable to play) -->
          <div class="h-4 flex items-center mt-[3px] ${data.trackPick && data.trackPickDisplay !== 'Select Track' ? 'cursor-pointer active:opacity-70' : ''}" 
               data-track-play-btn="${data.trackPick && data.trackPickDisplay !== 'Select Track' ? 'true' : ''}">
            <span class="text-[13px] text-green-400 truncate">
              <i class="fas fa-play fa-xs ml-[2px] mr-[8px]"></i>
              <span data-field="track-mobile-text">${data.trackPick && data.trackPickDisplay !== 'Select Track' ? data.trackPickDisplay : ''}</span>
            </span>
          </div>
        </div>

        <!-- Actions on the right -->
        <div class="flex items-center justify-center flex-shrink-0 w-[25px] border-l border-gray-800/50">
          <button data-album-menu-btn
                  class="p-2 text-gray-400 active:text-gray-200 no-drag">
            <i class="fas fa-ellipsis-v"></i>
          </button>
        </div>
      </div>
    `;

    cardWrapper.appendChild(card);

    // Add shared event handlers
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

    // Attach track play button handler (only if track is selected)
    const trackPlayBtn = card.querySelector('[data-track-play-btn="true"]');
    if (trackPlayBtn) {
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
        const albumsForTrackPlay = getListData(getCurrentList());
        const albumForTrackPlay =
          albumsForTrackPlay && albumsForTrackPlay[index];
        if (albumForTrackPlay) {
          const albumId =
            `${albumForTrackPlay.artist}::${albumForTrackPlay.album}::${albumForTrackPlay.release_date || ''}`.toLowerCase();
          playTrackSafe(albumId);
        }
      });
    }
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
   * Detect what type of update is needed
   * Uses lightweight mutable state instead of full album objects
   * @param {Array} oldState - Previous lightweight state (from extractMutableState)
   * @param {Array} newAlbums - New album array
   * @returns {string} Update type
   */
  function detectUpdateType(oldState, newAlbums) {
    if (!ENABLE_INCREMENTAL_UPDATES || !oldState) {
      return 'FULL_REBUILD';
    }

    if (oldState.length !== newAlbums.length) {
      return 'FULL_REBUILD';
    }

    let positionChanges = 0;
    let fieldChanges = 0;

    for (let i = 0; i < newAlbums.length; i++) {
      const oldAlbum = oldState[i];
      const newAlbum = newAlbums[i];

      const oldId =
        oldAlbum._id ||
        `${oldAlbum.artist}::${oldAlbum.album}::${oldAlbum.release_date}`;
      const newId =
        newAlbum._id ||
        `${newAlbum.artist}::${newAlbum.album}::${newAlbum.release_date}`;

      if (oldId !== newId) {
        positionChanges++;
      } else {
        if (
          oldAlbum.artist !== newAlbum.artist ||
          oldAlbum.album !== newAlbum.album ||
          oldAlbum.release_date !== newAlbum.release_date ||
          oldAlbum.country !== newAlbum.country ||
          oldAlbum.genre_1 !== newAlbum.genre_1 ||
          oldAlbum.genre_2 !== newAlbum.genre_2 ||
          oldAlbum.comments !== newAlbum.comments ||
          oldAlbum.track_pick !== newAlbum.track_pick
        ) {
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
        const data = processAlbumData(album, index);

        // Get cached element references (creates cache if missing)
        const cache = getCachedElements(row, isMobile);

        // Update position number
        if (
          cache.position &&
          cache.position.textContent !== data.position.toString()
        ) {
          cache.position.textContent = data.position;
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

          // Update track pick using cached span
          if (cache.trackSpan) {
            cache.trackSpan.textContent = data.trackPickDisplay;
            cache.trackSpan.className = `text-sm ${data.trackPickClass} truncate cursor-pointer hover:text-gray-100`;
            cache.trackSpan.title = data.trackPick || 'Click to select track';
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
   * @param {HTMLElement} container - Container element
   * @param {boolean} isMobile - Whether mobile view
   */
  function updatePositionNumbers(container, isMobile) {
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
      row.dataset.index = i;
      const innerCard = row.querySelector('.album-card');
      if (innerCard) {
        innerCard.dataset.index = i;
      }
    }
  }

  // Summary tooltip state
  let activeTooltip = null;
  let tooltipHideTimeout = null;
  const TOOLTIP_HIDE_DELAY = 500; // 500ms delay before hiding

  /**
   * Initialize summary tooltips for badges (Last.fm and Wikipedia)
   * @param {HTMLElement} container - Container element
   */
  function initSummaryTooltips(container) {
    const badges = container.querySelectorAll('.summary-badge');

    badges.forEach((badge) => {
      badge.addEventListener('mouseenter', handleBadgeMouseEnter);
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

    // Remove existing tooltip if any
    hideTooltip();

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

    // Position tooltip to the right of the badge, top-aligned
    positionTooltip(badge, tooltip);

    // Show tooltip with animation
    requestAnimationFrame(() => {
      tooltip.classList.add('visible');
    });
  }

  /**
   * Handle mouse leave on summary badge
   */
  function handleBadgeMouseLeave() {
    scheduleHideTooltip();
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
   * Schedule hiding the tooltip with delay
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
      setTimeout(() => {
        if (activeTooltip && activeTooltip.parentNode) {
          activeTooltip.parentNode.removeChild(activeTooltip);
        }
        activeTooltip = null;
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

      // FIELD_UPDATE and HYBRID_UPDATE don't need cover refetch - covers don't change
      if (updateType === 'FIELD_UPDATE' || updateType === 'HYBRID_UPDATE') {
        const success = updateAlbumFields(albums, isMobile);

        if (success && verifyDOMIntegrity(albums, isMobile)) {
          // Update lightweight state instead of expensive deep clone
          requestAnimationFrame(() => {
            lastRenderedFingerprint = newFingerprint;
            lastRenderedMutableState = extractMutableState(albums);
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
        'album-header album-grid gap-4 py-2 text-base font-semibold uppercase tracking-wider text-gray-200 border-b border-gray-800 sticky top-0 bg-black z-10 flex-shrink-0';
      header.style.alignItems = 'center';
      header.innerHTML = `
        <div class="text-center"></div>
        <div>Album</div>
        <div></div>
        <div>Artist</div>
        <div>Country</div>
        <div>Genre 1</div>
        <div>Genre 2</div>
        <div>Comment</div>
        <div>Track</div>
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
    initializeUnifiedSorting(container, isMobile);

    // Initialize lazy loading for album cover images
    observeLazyImages(container);

    // Initialize Last.fm summary tooltips (desktop only)
    if (!isMobile) {
      initLastfmTooltips(container);
    }

    // Update lightweight state instead of expensive deep clone
    requestAnimationFrame(() => {
      lastRenderedFingerprint = generateAlbumFingerprint(albums);
      lastRenderedMutableState = extractMutableState(albums);
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
    playcountCache = {};
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
   * @param {Object} playcounts - Map of itemId to playcount
   */
  function updatePlaycountElements(playcounts) {
    for (const [itemId, count] of Object.entries(playcounts)) {
      if (count === null || count === undefined) continue;

      const display = formatPlaycount(count);

      // Update desktop elements
      const desktopEl = document.querySelector(`[data-playcount="${itemId}"]`);
      if (desktopEl) {
        desktopEl.innerHTML = `<i class="fas fa-headphones text-[10px] mr-1"></i>${display}`;
        desktopEl.title = `${count} plays on Last.fm`;
        desktopEl.classList.remove('hidden');
      }

      // Update mobile elements
      const mobileEl = document.querySelector(
        `[data-playcount-mobile="${itemId}"]`
      );
      if (mobileEl) {
        mobileEl.innerHTML = `· <i class="fas fa-headphones text-[10px]"></i> ${display}`;
        mobileEl.classList.remove('hidden');
      }
    }
  }

  /**
   * Poll for refreshed playcounts until all data is loaded
   * @param {string} listId - List ID
   * @param {number} expectedCount - Number of albums being refreshed
   */
  async function pollForRefreshedPlaycounts(listId, expectedCount) {
    // Calculate expected time: ~5 albums per batch, ~1.1s per batch
    const estimatedBatches = Math.ceil(expectedCount / 5);
    const estimatedTimeMs = estimatedBatches * 1100 + 2000; // Add 2s buffer

    // Poll interval and max attempts
    const POLL_INTERVAL = 3000; // Poll every 3 seconds
    const MAX_POLLS = Math.max(
      5,
      Math.ceil(estimatedTimeMs / POLL_INTERVAL) + 2
    );

    let pollCount = 0;
    let lastMissingCount = expectedCount;

    const poll = async () => {
      pollCount++;

      try {
        const response = await apiCall(`/api/lastfm/list-playcounts/${listId}`);

        if (response.playcounts) {
          Object.assign(playcountCache, response.playcounts);
          updatePlaycountElements(response.playcounts);

          // Count how many are still null/missing
          const missingCount = Object.values(response.playcounts).filter(
            (v) => v === null
          ).length;

          // If all loaded or no progress being made, stop polling
          if (missingCount === 0) {
            console.log('All playcounts loaded');
            return;
          }

          // If still making progress and under max polls, continue
          if (pollCount < MAX_POLLS && missingCount < lastMissingCount) {
            lastMissingCount = missingCount;
            setTimeout(poll, POLL_INTERVAL);
          } else if (
            pollCount < MAX_POLLS &&
            missingCount === lastMissingCount
          ) {
            // No progress - maybe API rate limited, try a couple more times
            if (pollCount < MAX_POLLS - 2) {
              setTimeout(poll, POLL_INTERVAL * 2); // Slower poll
            }
          }
        }
      } catch (err) {
        console.warn('Playcount poll failed:', err);
        // Retry if under max
        if (pollCount < MAX_POLLS) {
          setTimeout(poll, POLL_INTERVAL);
        }
      }
    };

    // Start polling after initial delay
    setTimeout(poll, POLL_INTERVAL);
  }

  // Return public API
  return {
    displayAlbums,
    fetchAndDisplayPlaycounts,
    updatePositionNumbers,
    clearLastRenderedCache,
    clearPlaycountCache,
    // Expose for testing
    processAlbumData,
    createAlbumItem,
    detectUpdateType,
  };
}
