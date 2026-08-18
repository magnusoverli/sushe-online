/**
 * Album Display Module
 *
 * Handles rendering and display of albums in both desktop and mobile views.
 * Uses dependency injection for testability and decoupling from global state.
 *
 * @module album-display
 */

import { isMobileViewport } from '../utils/viewport.js';
import {
  formatReleaseDate,
  isYearMismatch,
  extractYearFromDate,
} from './date-utils.js';
import { escapeHtmlAttr as escapeHtml } from './html-utils.js';
import { isListLocked, showYearLockUI, clearYearLockUI } from './year-lock.js';
import {
  positionContextMenu,
  hideAllContextMenus as hideAllMenusBase,
} from './context-menu.js';
import {
  isColumnVisible,
  getVisibleColumns,
  getAllColumns,
  getToggleableColumns,
  computeGridTemplate,
  toggleColumn,
  setAllColumns,
} from './column-config.js';
import {
  createAlbumDisplayShared,
  PLACEHOLDER_GIF,
} from './album-display-shared.js';
import { detectUpdateType } from './album-display/incremental-update-detector.js';
import {
  createAlbumDataProcessor,
  formatPlaycount,
  processTrackPick,
} from './album-display/album-data.js';
import { createPlaycountSync } from './album-display/playcount-sync.js';
import { renderAvailabilityBadges } from './album-display/availability-badges.js';
import { getPositionBadgeColor } from './album-display/position-badge.js';
import {
  renderTaxonomyContent,
  renderTaxonomyTrigger,
} from './album-display/taxonomy-details.js';
import { createModal, destroyModalForElement } from './modal-factory.js';
import {
  renderDesktopAlbumCell,
  renderDesktopArtistCell,
  renderDesktopCoverCell,
  renderDesktopGenreCell,
  renderMobileArtistRow,
  renderMobileCoverSection,
  renderMobileGenreRow,
  renderMobileTaxonomyBadge,
  renderMobilePlaycountRow,
  renderMobilePositionBadge,
  renderMobileTitleRow,
  renderRecommendationBadge,
  renderSummaryBadge,
} from './album-display/render-parts.js';

// Feature flag for incremental updates (can be disabled if issues arise)
const ENABLE_INCREMENTAL_UPDATES = true;
const PROGRESSIVE_RENDER_THRESHOLD = 120;
const PROGRESSIVE_RENDER_BATCH_SIZE = 60;

// Module-level state
// Store lightweight fingerprint instead of deep-cloned array for performance
let lastRenderedFingerprint = null;
// Store mutable field fingerprints for detectUpdateType (strings, not objects)
let lastRenderedMutableState = null;
let positionElementCache = new WeakMap();
let renderGeneration = 0;
let progressiveRenderInProgress = false;
let pendingHydration = null;

// Album cover preview state
let coverPreviewActive = null; // Stores { overlay, clone, originalRect }

const albumDisplayShared = createAlbumDisplayShared({
  computeGridTemplate,
  getVisibleColumns,
  getToggleableColumns,
  isColumnVisible,
});

const {
  applyVisibilityInPlace,
  loadCoverImages,
  updateCoverInPlace,
  getCachedElements,
  resetRowElementsCache,
  generateAlbumFingerprint,
  invalidateFingerprint,
  extractMutableFingerprints,
} = albumDisplayShared;

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
 * @param {Function} deps.playAlbumByMetadata - Play album by artist/album metadata
 * @param {Function} deps.playTrackSafe - Play track safely by album ID
 * @param {Function} deps.playSpecificTrack - Play a specific track by index + identifier
 * @param {Function} deps.isViewingRecommendations - Check if recommendations view is active
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
    playAlbumByMetadata,
    playTrackSafe,
    playSpecificTrack,
    isViewingRecommendations,
    initializeUnifiedSorting,
    destroySorting,
    isListLocked: isListLockedFn = isListLocked,
    showYearLockUI: showYearLockUIFn = showYearLockUI,
    clearYearLockUI: clearYearLockUIFn = clearYearLockUI,
    setContextAlbum,
    getTrackName,
    getTrackLength,
    formatTrackTime,
    reapplyNowPlayingHighlight = () => {},
  } = deps;

  const playcountSync = createPlaycountSync({
    apiCall,
    formatPlaycount,
  });

  const { processAlbumData } = createAlbumDataProcessor({
    getCurrentList,
    getListMetadata,
    getTrackName,
    getTrackLength,
    formatTrackTime,
    getPlaycountCacheEntry: playcountSync.getPlaycountCacheEntry,
  });

  /**
   * Extract only the fields needed for DOM field updates (updateAlbumFields).
   * Lightweight data for updating an existing row without rebuilding it.
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
    const genre1 = album.genre_1 || '';
    let genre2 = album.genre_2 || '';
    if (genre2 === 'Genre 2' || genre2 === '-') genre2 = '';
    let comment = album.comments || '';
    if (comment === 'Comment') comment = '';
    let comment2 = album.comments_2 || '';
    if (comment2 === 'Comment 2') comment2 = '';
    const availability = Array.isArray(album.availability)
      ? album.availability
      : [];
    const availabilityLinks = Array.isArray(album.availability_links)
      ? album.availability_links
      : [];
    const taxonomy = album.taxonomy || null;
    const inlineCover = album.cover_image
      ? `data:image/${album.cover_image_format || 'PNG'};base64,${album.cover_image}`
      : '';
    const coverImageUrl = album.cover_image_url || inlineCover;
    const coverThumbUrl = inlineCover || album.cover_thumb_url || coverImageUrl;
    const summary = album.summary || '';
    const summarySource = album.summary_source || album.summarySource || '';
    const recommendedBy = album.recommended_by || null;
    const recommendedAt = album.recommended_at || null;

    const primaryTrack = album.primary_track || '';

    const primaryTrackData = processTrackPick(primaryTrack, album.tracks, {
      getTrackName,
      getTrackLength,
      formatTrackTime,
    });
    const primaryTrackDisplay = primaryTrackData.display || 'Select Track';
    const primaryTrackClass = primaryTrackData.class;
    const primaryTrackDuration = primaryTrackData.duration;

    const secondaryTrack = album.secondary_track || '';
    const secondaryTrackData = processTrackPick(secondaryTrack, album.tracks, {
      getTrackName,
      getTrackLength,
      formatTrackTime,
    });
    const secondaryTrackDisplay = secondaryTrackData.display;
    const secondaryTrackDuration = secondaryTrackData.duration;

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
      primaryTrack,
      primaryTrackDisplay,
      primaryTrackClass,
      primaryTrackDuration,
      secondaryTrack,
      secondaryTrackDisplay,
      secondaryTrackDuration,
      availability,
      availabilityLinks,
      taxonomy,
      coverImageUrl,
      coverThumbUrl,
      summary,
      summarySource,
      recommendedBy,
      recommendedAt,
    };
  }

  function updateTrackDuration(trackText, duration, field, className) {
    const trackLine = trackText?.parentElement;
    if (!trackLine) return;

    const existingDuration = trackLine.querySelector(`[data-field="${field}"]`);
    if (duration) {
      if (existingDuration) {
        existingDuration.textContent = `(${duration})`;
      } else {
        const durationSpan = document.createElement('span');
        durationSpan.className = className;
        durationSpan.dataset.field = field;
        durationSpan.textContent = `(${duration})`;
        trackLine.appendChild(durationSpan);
      }
    } else if (existingDuration) {
      existingDuration.remove();
    }
  }

  function getMobileBadgeData(data) {
    const badges = [
      renderSummaryBadge(data, { mobile: true }),
      renderRecommendationBadge(data, { mobile: true }),
      renderMobileTaxonomyBadge(data),
    ].filter(Boolean);
    const padding = badges.length ? 31 : 0;

    return {
      html: badges.join(''),
      paddingRight: `${padding}px`,
      state: `${data.recommendedBy || ''}|${data.recommendedAt || ''}|${data.summary || ''}|${data.summarySource || ''}|${JSON.stringify(data.taxonomy || {})}|${data.albumName}|${data.artist}`,
    };
  }

  function updateMobileBadgePadding(row, cache, paddingRight) {
    if (cache.titleRow) {
      cache.titleRow.style.paddingRight = paddingRight;
    }
    row.querySelectorAll('[data-mobile-badge-padding]').forEach((element) => {
      element.style.paddingRight = paddingRight;
    });
  }

  function reconcileAlbumBadges(row, cache, data, isMobile) {
    const mobileBadgeData = isMobile ? getMobileBadgeData(data) : null;
    const badgeHtml = mobileBadgeData
      ? mobileBadgeData.html
      : `${renderRecommendationBadge(data)}${renderSummaryBadge(data)}`;
    const badgeState = mobileBadgeData
      ? mobileBadgeData.state
      : `${data.recommendedBy || ''}|${data.recommendedAt || ''}|${data.summary || ''}|${data.summarySource || ''}|${data.albumName}|${data.artist}`;
    if (cache.badgeContainer?.dataset.badgeState === badgeState) return;
    if (cache.badgeContainer) {
      cache.badgeContainer.dataset.badgeState = badgeState;
    }

    if (isMobile) {
      if (!cache.badgeContainer) return;
      cache.badgeContainer.innerHTML = badgeHtml;
      updateMobileBadgePadding(row, cache, mobileBadgeData.paddingRight);
      attachMobileBadgeHandlers(row);
      return;
    }

    if (!cache.badgeContainer) return;
    cache.badgeContainer
      .querySelectorAll('.summary-badge, .recommendation-badge')
      .forEach((badge) => badge.remove());
    if (badgeHtml) {
      cache.badgeContainer.insertAdjacentHTML('beforeend', badgeHtml);
      initSummaryTooltips(cache.badgeContainer);
    }
  }

  function updateAvailabilityBadges(
    row,
    cache,
    releaseDate,
    availability,
    availabilityLinks,
    isMobile
  ) {
    const html = renderAvailabilityBadges(
      availability,
      isMobile
        ? { variant: 'mobile', links: availabilityLinks }
        : { links: availabilityLinks }
    );
    if (cache.availabilityHtml === html) return;
    cache.availabilityHtml = html;
    const existing =
      cache.availabilityBadges || row.querySelector('.album-availability');

    if (existing) {
      if (html) {
        existing.outerHTML = html;
        cache.availabilityBadges = row.querySelector('.album-availability');
      } else {
        existing.remove();
        cache.availabilityBadges = null;
      }
      return;
    }

    if (html && releaseDate) {
      releaseDate.insertAdjacentHTML('afterend', html);
      cache.availabilityBadges = row.querySelector('.album-availability');
    }
  }

  function updateTaxonomyDetails(row, cache, data, isMobile) {
    if (isMobile) return;
    if (!cache.taxonomySlot) return;
    const html = renderTaxonomyTrigger(data.taxonomy, {
      mobile: isMobile,
      albumName: data.albumName,
      artist: data.artist,
    });
    if (cache.taxonomySlot.innerHTML !== html) {
      cache.taxonomySlot.innerHTML = html;
      if (isMobile) {
        attachMobileTaxonomyHandler(row);
      } else {
        initSummaryTooltips(cache.taxonomySlot);
      }
    }
  }

  function playTrackButton(index, trackIdentifier) {
    if (trackIdentifier && typeof playSpecificTrack === 'function') {
      playSpecificTrack(index, trackIdentifier);
      return;
    }

    const albumsForTrackPlay = getListData(getCurrentList());
    const albumForTrackPlay = albumsForTrackPlay && albumsForTrackPlay[index];
    if (albumForTrackPlay) {
      const albumId =
        `${albumForTrackPlay.artist}::${albumForTrackPlay.album}::${albumForTrackPlay.release_date || ''}`.toLowerCase();
      playTrackSafe(albumId);
    }
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
    const badgeHtml = `${renderRecommendationBadge(data)}${renderSummaryBadge(data)}`;
    const badgeState = `${data.recommendedBy || ''}|${data.recommendedAt || ''}|${data.summary || ''}|${data.summarySource || ''}|${data.albumName}|${data.artist}`;

    // Build cell HTML map — each column produces its own cell
    const cellMap = {
      position:
        data.position !== null
          ? `<div class="position-cell flex items-center justify-center text-gray-400 font-medium text-sm position-display" data-position-element="true">${data.position}</div>`
          : '<div class="position-cell"></div>',
      cover: renderDesktopCoverCell(data, index),
      album: renderDesktopAlbumCell(data, {
        alwaysShowReleaseDate: true,
        badgesHtml: badgeHtml,
        badgeState,
        includeAvailabilityLinks: true,
        includeTaxonomy: true,
      }),
      artist: renderDesktopArtistCell(data),
      country: `<div class="flex items-center country-cell">
        <span class="album-cell-text ${data.countryClass} truncate cursor-pointer hover:text-gray-100">${data.countryDisplay}</span>
      </div>`,
      genre_1: renderDesktopGenreCell(data, 1),
      genre_2: renderDesktopGenreCell(data, 2),
      track: `<div class="flex flex-col justify-start track-cell min-w-0 cursor-pointer overflow-hidden">
        ${
          data.primaryTrackDisplay
            ? `<div class="flex items-center min-w-0 overflow-hidden w-full">
            <span class="inline-block w-5 text-center mr-1 shrink-0 text-2xs font-semibold font-[Georgia,serif] text-green-400" title="Primary track">I:</span>
            <span data-field="primary-track-text" class="album-cell-text ${data.primaryTrackClass} truncate hover:text-gray-100 flex-1 min-w-0" title="${data.primaryTrack || ''}">${data.primaryTrackDisplay}</span>
            ${data.primaryTrackDuration ? `<span data-field="primary-track-duration" class="text-xs text-gray-500 shrink-0 ml-2 tabular-nums">(${data.primaryTrackDuration})</span>` : ''}
          </div>`
            : `<div class="flex items-center min-w-0">
            <span class="album-cell-text text-gray-800 italic hover:text-gray-100">Select Track</span>
          </div>`
        }
        ${
          data.hasSecondaryTrack
            ? `<div class="flex items-center min-w-0 mt-1 overflow-hidden w-full">
            <span class="inline-block w-5 text-center mr-1 shrink-0 text-2xs font-semibold font-[Georgia,serif] text-green-400" title="Secondary track">II:</span>
            <span data-field="secondary-track-text" class="album-cell-text ${data.secondaryTrackClass} truncate hover:text-gray-100 text-sm flex-1 min-w-0" title="${data.secondaryTrack || ''}">${data.secondaryTrackDisplay}</span>
            ${data.secondaryTrackDuration ? `<span data-field="secondary-track-duration" class="text-xs text-gray-500 shrink-0 ml-2 tabular-nums">(${data.secondaryTrackDuration})</span>` : ''}
          </div>`
            : ''
        }
      </div>`,
      comment: `<div class="flex items-center comment-cell relative border-l border-gray-700 pl-2 self-stretch">
        <span class="album-cell-text ${data.comment ? 'text-gray-300 hover:text-gray-100' : 'text-transparent hover:text-gray-600 italic'} line-clamp-2 cursor-pointer comment-text">${data.comment || 'Comment'}</span>
      </div>`,
      comment_2: `<div class="flex items-center comment-2-cell relative pl-2 self-stretch">
        <span class="album-cell-text ${data.comment2 ? 'text-gray-300 hover:text-gray-100' : 'text-transparent hover:text-gray-600 italic'} line-clamp-2 cursor-pointer comment-2-text">${data.comment2 || 'Comment 2'}</span>
      </div>`,
    };

    // Render ALL columns; hidden ones get .column-hidden for zero-cost toggling
    const allCols = getAllColumns();
    const visibleCols = getVisibleColumns();
    row.style.gridTemplateColumns = computeGridTemplate(visibleCols);
    row.innerHTML = allCols
      .map((col) => {
        const html = cellMap[col.id];
        if (isColumnVisible(col.id)) return html;
        // Inject column-hidden class into the outermost div
        return html.replace(/^(<div\s+class=")/, '$1column-hidden ');
      })
      .join('\n');

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
    attachDesktopCoverPreview(coverImage);

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

    // Add click handler to country cell (hidden when column is toggled off)
    const countryCell = row.querySelector('.country-cell');
    if (countryCell) {
      countryCell.onclick = () => {
        const currentIndex = parseInt(row.dataset.index);
        makeCountryEditable(countryCell, currentIndex);
      };
    }

    // Add click handlers to genre cells
    const genre1Cell = row.querySelector('.genre-1-cell');
    if (genre1Cell) {
      genre1Cell.onclick = () => {
        const currentIndex = parseInt(row.dataset.index);
        makeGenreEditable(genre1Cell, currentIndex, 'genre_1');
      };
    }

    const genre2Cell = row.querySelector('.genre-2-cell');
    if (genre2Cell) {
      genre2Cell.onclick = () => {
        const currentIndex = parseInt(row.dataset.index);
        makeGenreEditable(genre2Cell, currentIndex, 'genre_2');
      };
    }

    // Add click handler to comment cell
    const commentCell = row.querySelector('.comment-cell');
    if (commentCell) {
      commentCell.onclick = () => {
        const currentIndex = parseInt(row.dataset.index);
        makeCommentEditable(commentCell, currentIndex);
      };
    }

    // Add click handler to comment 2 cell
    const comment2Cell = row.querySelector('.comment-2-cell');
    if (comment2Cell) {
      comment2Cell.onclick = () => {
        const currentIndex = parseInt(row.dataset.index);
        makeComment2Editable(comment2Cell, currentIndex);
      };
    }

    // Attach link preview
    const albumsForPreview = getListData(currentList);
    const album = albumsForPreview && albumsForPreview[index];
    const comment = album ? album.comments || '' : '';
    if (commentCell) {
      attachLinkPreview(commentCell, comment);
    }

    const comment2 = album ? album.comments_2 || '' : '';
    if (comment2Cell) {
      attachLinkPreview(comment2Cell, comment2);
    }

    // Add tooltip only if comment is truncated
    const commentTextEl = commentCell?.querySelector('.comment-text');
    if (commentTextEl && comment) {
      setTimeout(() => {
        if (isTextTruncated(commentTextEl)) {
          commentTextEl.setAttribute('data-comment', comment);
        }
      }, 0);
    }

    // Add tooltip only if comment 2 is truncated
    const comment2TextEl = comment2Cell?.querySelector('.comment-2-text');
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
        e.target.closest('.track-cell') ||
        e.target.closest('.taxonomy-trigger');

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
      const regenerateSummaryOption = document.getElementById(
        'regenerateSummaryOption'
      );

      if (adminDivider) adminDivider.classList.toggle('hidden', !isAdmin);
      if (reidentifyOption)
        reidentifyOption.classList.toggle('hidden', !isAdmin);
      if (regenerateSummaryOption)
        regenerateSummaryOption.classList.toggle('hidden', !isAdmin);

      // Show/hide recommend option based on whether current list is year-based
      // and not currently viewing recommendations
      const recommendOption = document.getElementById('recommendAlbumOption');
      if (recommendOption) {
        const currentListId = getCurrentList();
        const listMeta = getListMetadata(currentListId);
        const isYearBased =
          listMeta && listMeta.year !== null && listMeta.year !== undefined;
        const viewingRecommendations =
          typeof isViewingRecommendations === 'function'
            ? isViewingRecommendations()
            : false;

        // Show recommend option only for year-based lists (not when viewing recommendations)
        const showRecommend = isYearBased && !viewingRecommendations;
        recommendOption.classList.toggle('hidden', !showRecommend);
      }

      // Position the menu
      positionContextMenu(contextMenu, e.clientX, e.clientY);
    });
  }

  function attachDesktopCoverPreview(coverImage) {
    if (!coverImage || coverImage.dataset.coverPreviewAttached === 'true') {
      return;
    }
    coverImage.dataset.coverPreviewAttached = 'true';
    coverImage.style.cursor = 'zoom-in';
    coverImage.addEventListener('click', (event) => {
      event.stopPropagation();
      openCoverPreview(coverImage);
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
   * │ cardWrapper (.album-card-wrapper) - h-[145px]                         │
   * │  └─ card (.album-card.album-row) - relative, h-[145px]               │
   * │     ├─ positionBadge (absolute, top-right of card)                   │
   * │     └─ contentRow (flex row, h-full)                                  │
   * │        ├─ coverSection (w-[88px], flex-shrink-0)                     │
   * │        │   ├─ albumCover (.mobile-album-cover, 80x80)                │
   * │        │   │   ├─ coverImage (75x75, .album-cover-blur)              │
   * │        │   │   └─ summaryBadge (absolute, top-right of cover)        │
   * │        │   ├─ releaseDate (below cover)                              │
   * │        │   └─ availabilityBadges (.album-availability--mobile)        │
   * │        ├─ infoSection (flex-1, min-w-0 for truncation)               │
   * │        │   ├─ albumName                                               │
   * │        │   ├─ artist                                                  │
   * │        │   ├─ playcount (.data-playcount-mobile)                      │
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
    cardWrapper.className = 'album-card-wrapper h-[145px]';

    // === CARD ELEMENT ===
    // Main card with:
    // - album-card: Touch feedback, box-shadow transitions
    // - album-row: Inset top/bottom separators (subtle white lines)
    // - relative: Positioning context for absolute children
    // - h-[145px]: Fixed height matching wrapper
    const card = document.createElement('div');
    card.className = 'album-card album-row relative h-[145px] bg-gray-900';
    card.dataset.index = index;
    const mobileBadgeData = getMobileBadgeData(data);

    // === BUILD CARD HTML ===
    card.innerHTML = `
      ${renderMobilePositionBadge(data.position)}

      <div class="flex items-stretch h-full">
        
        <!-- COVER SECTION -->
        <!-- h-full is REQUIRED, not cosmetic: the card carries the shared
             'album-row' class, and app.css's desktop-grid rule
             '.album-row > div { align-items: center }' (specificity 0,1,1) beats
             Tailwind's 'items-stretch' on the row wrapper, so the columns are NOT
             stretched to the card height. Without an explicit height this column
             collapses to its content (~104px) and centres, leaving justify-evenly
             with zero free space (all three sections touch, slack pools top/bottom).
             h-full pins it to the full 145px so justify-evenly can distribute. -->
        <!-- Full-height column with justify-evenly so the three stacked sections
             (cover, release date, availability badges) get four equal vertical
             gaps: top-border->cover, cover->date, date->badges, and
             badges->bottom-border all match. Competing margins are stripped
             (no pt on the column, no mt-1 on the date, margin-top:0 on the
             .album-availability--mobile badges) so the flex spacing is uniform.
             The date also uses leading-none: text-xs's 16px line-box carries
             ~2px of half-leading top/bottom that would otherwise inflate the two
             date-adjacent gaps; collapsing the box to the 12px glyph keeps all
             four gaps visually equal. The live-update twin (mobile branch of the
             release-date className reset, ~line 1310) MUST keep these same
             classes or the asymmetry returns on the next in-place update. -->
        ${renderMobileCoverSection(data, index, { includeAvailabilityLinks: true })}
        
        <!-- INFO SECTION -->
        <div class="flex-1 min-w-0 pl-0.5 pr-1 flex flex-col justify-evenly h-[130px] leading-[18px]">
          <!-- Album name -->
          <!-- The right padding reserves space on the title row, so the
               truncated title cuts off at (info-section width - this padding).
               The badge stack uses a narrow right-side lane. -->
          ${renderMobileTitleRow(data, { paddingRight: mobileBadgeData.paddingRight, badgesHtml: mobileBadgeData.html, badgeState: mobileBadgeData.state, stackBadges: true })}
          <!-- Artist -->
          ${renderMobileArtistRow(data, { paddingRight: mobileBadgeData.paddingRight })}
          <!-- Last.fm playcount -->
          ${renderMobilePlaycountRow(data, { paddingRight: mobileBadgeData.paddingRight })}
          <!-- Country -->
          <div data-mobile-badge-padding class="flex items-center" style="padding-right: ${mobileBadgeData.paddingRight}">
            <span class="text-[12px] text-gray-400">
              <i class="fas fa-globe fa-xs inline-block w-4 text-center mr-1"></i><span data-field="country-mobile-text">${escapeHtml(data.country || '')}</span>
            </span>
          </div>
          <!-- Genres -->
          ${renderMobileGenreRow(data, { paddingRight: mobileBadgeData.paddingRight })}
          <!-- Primary track (marker: 1) -->
          <div class="flex items-center ${data.primaryTrackDisplay ? 'cursor-pointer active:opacity-70' : ''}"
               data-track-play-btn="${data.primaryTrackDisplay ? 'true' : ''}"
               data-track-identifier="${data.primaryTrack || ''}">
            <span class="text-[12px] text-green-400 flex min-w-0 w-full">
              <span class="inline-block w-5 text-center mr-1 shrink-0 text-2xs font-semibold font-[Georgia,serif]">I:</span><span data-field="track-mobile-text" class="truncate flex-1 min-w-0">${escapeHtml(data.primaryTrackDisplay || '')}</span>${data.primaryTrackDuration ? `<span data-field="primary-track-mobile-duration" class="shrink-0 ml-1 tabular-nums">(${data.primaryTrackDuration})</span>` : ''}
            </span>
          </div>
          <!-- Secondary track (marker: 2) — always rendered for a consistent layout -->
          <div class="flex items-center ${data.secondaryTrackDisplay ? 'cursor-pointer active:opacity-70' : ''}"
               data-track-play-btn="${data.secondaryTrackDisplay ? 'true' : ''}"
               data-track-identifier="${data.secondaryTrack || ''}">
            <span class="text-[12px] text-green-400 flex min-w-0 w-full">
              <span class="inline-block w-5 text-center mr-1 shrink-0 text-2xs font-semibold font-[Georgia,serif]">II:</span><span data-field="secondary-track-mobile-text" class="truncate flex-1 min-w-0">${escapeHtml(data.secondaryTrackDisplay || '')}</span>${data.secondaryTrackDuration ? `<span data-field="secondary-track-mobile-duration" class="shrink-0 ml-1 tabular-nums">(${data.secondaryTrackDuration})</span>` : ''}
            </span>
          </div>
        </div>
        
        <!-- MENU SECTION -->
        <div class="shrink-0 w-[30px] border-l border-gray-700/80" style="display: flex; align-items: center; justify-content: center;">
          <button data-album-menu-btn class="no-drag text-gray-400 active:text-gray-200" style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
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
   * Trigger album playback from a mobile cover tap.
   * Uses metadata-based playback to route through the preferred music service.
   * @param {Object} album - Album object from list data
   * @returns {boolean} Whether playback was triggered
   */
  function playAlbumFromMobileCover(album) {
    if (!album) {
      showToast('Album not found', 'error');
      return false;
    }

    if (typeof playAlbumByMetadata !== 'function') {
      showToast('Play album is unavailable', 'error');
      return false;
    }

    playAlbumByMetadata(album.artist, album.album, {
      albumId: album.album_id,
      releaseDate: album.release_date,
    });

    return true;
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
    const comment = album ? album.comments || '' : '';
    const contentDiv = card.querySelector('.flex-1.min-w-0');
    if (contentDiv) attachLinkPreview(contentDiv, comment);

    // Tap album cover to play album in preferred music service
    const coverTapTarget = card.querySelector('.mobile-album-cover');
    if (coverTapTarget && album) {
      coverTapTarget.style.cursor = 'pointer';
      coverTapTarget.addEventListener(
        'touchstart',
        (e) => {
          e.stopPropagation();
        },
        { passive: true }
      );

      coverTapTarget.addEventListener(
        'touchend',
        (e) => {
          e.stopPropagation();
        },
        { passive: true }
      );

      coverTapTarget.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        playAlbumFromMobileCover(album);
      });
    }

    attachMobileBadgeHandlers(card);

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
        playTrackButton(index, trackPlayBtn.dataset.trackIdentifier);
      });
    });
  }

  function attachMobileBadgeHandlers(card) {
    const stopPropagation = (event) => event.stopPropagation();
    const summaryBadge = card.querySelector('.summary-badge-mobile');
    if (summaryBadge && showMobileSummarySheet) {
      summaryBadge.addEventListener('touchstart', stopPropagation, {
        passive: true,
      });
      summaryBadge.addEventListener('touchend', stopPropagation, {
        passive: true,
      });
      summaryBadge.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        if (summaryBadge.dataset.summary) {
          showMobileSummarySheet(
            summaryBadge.dataset.summary,
            summaryBadge.dataset.albumName,
            summaryBadge.dataset.artist
          );
        }
      });
    }

    const recommendationBadge = card.querySelector(
      '.recommendation-badge-mobile'
    );
    if (recommendationBadge) {
      recommendationBadge.addEventListener('touchstart', stopPropagation, {
        passive: true,
      });
      recommendationBadge.addEventListener('touchend', stopPropagation, {
        passive: true,
      });
      recommendationBadge.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        showMobileRecommendationSheet(recommendationBadge);
      });
    }
    attachMobileTaxonomyHandler(card);
  }

  function attachMobileTaxonomyHandler(card) {
    const trigger = card.querySelector('.taxonomy-trigger-mobile');
    if (!trigger || trigger.dataset.taxonomyBound === 'true') return;
    trigger.dataset.taxonomyBound = 'true';
    const stopPropagation = (event) => event.stopPropagation();
    trigger.addEventListener('touchstart', stopPropagation, { passive: true });
    trigger.addEventListener('touchend', stopPropagation, { passive: true });
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
      showMobileTaxonomySheet(trigger);
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
    data.availabilityLinks = Array.isArray(album.availability_links)
      ? album.availability_links
      : [];
    data.taxonomy = album.taxonomy || null;

    if (isMobile) {
      return createMobileAlbumCard(data, index);
    } else {
      return createDesktopAlbumRow(data, index);
    }
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

    // Load cover images for the new row
    loadCoverImages(container);
    reapplyNowPlayingHighlight();

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
    reapplyNowPlayingHighlight();

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

        const coverImage = updateCoverInPlace(cache.coverMedia, {
          src: data.coverThumbUrl,
          fullSrc: data.coverImageUrl,
          alt: data.albumName,
        });
        if (!isMobile) attachDesktopCoverPreview(coverImage);
        reconcileAlbumBadges(row, cache, data, isMobile);

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
            cache.artist.className = `text-sm ${data.artist ? 'text-gray-200' : 'text-gray-800 italic'} truncate cursor-pointer hover:text-gray-100`;
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
          if (cache.albumTitle) {
            cache.albumTitle.textContent = data.albumName;
          }

          if (cache.releaseDate) {
            cache.releaseDate.textContent = data.releaseDate;
            cache.releaseDate.className = `release-date-display text-xs leading-none whitespace-nowrap ${data.yearMismatch ? 'text-red-500' : 'text-gray-500'}`;
            if (data.yearMismatch) {
              cache.releaseDate.title = data.yearMismatchTooltip;
            } else {
              cache.releaseDate.removeAttribute('title');
            }
          }
        }

        updateAvailabilityBadges(
          row,
          cache,
          cache.releaseDate,
          data.availability,
          data.availabilityLinks,
          isMobile
        );
        updateTaxonomyDetails(row, cache, data, isMobile);

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
            cache.trackSpan.textContent = data.primaryTrackDisplay;
            cache.trackSpan.className = `album-cell-text ${data.primaryTrackClass} truncate hover:text-gray-100 flex-1 min-w-0`;
            cache.trackSpan.title =
              data.primaryTrack || 'Click to select track';
            updateTrackDuration(
              cache.trackSpan,
              data.primaryTrackDuration,
              'primary-track-duration',
              'text-xs text-gray-500 shrink-0 ml-2 tabular-nums'
            );
          }

          if (cache.secondaryTrackSpan) {
            cache.secondaryTrackSpan.textContent = data.secondaryTrackDisplay;
            cache.secondaryTrackSpan.title = data.secondaryTrack;
            updateTrackDuration(
              cache.secondaryTrackSpan,
              data.secondaryTrackDuration,
              'secondary-track-duration',
              'text-xs text-gray-500 shrink-0 ml-2 tabular-nums'
            );
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
              data.primaryTrack && data.primaryTrackDisplay !== 'Select Track'
                ? data.primaryTrackDisplay
                : '';
            trackMobile.textContent = trackDisplay;
            updateTrackDuration(
              trackMobile,
              data.primaryTrackDuration,
              'primary-track-mobile-duration',
              'shrink-0 ml-1 tabular-nums'
            );

            const trackPlayBtn = trackMobile.closest('[data-track-play-btn]');
            if (trackPlayBtn) {
              const hasTrack =
                data.primaryTrack &&
                data.primaryTrackDisplay !== 'Select Track';
              trackPlayBtn.setAttribute(
                'data-track-play-btn',
                hasTrack ? 'true' : ''
              );
              if (hasTrack) {
                trackPlayBtn.dataset.trackIdentifier = data.primaryTrack;
              } else {
                delete trackPlayBtn.dataset.trackIdentifier;
              }

              if (hasTrack) {
                trackPlayBtn.classList.add(
                  'cursor-pointer',
                  'active:opacity-70'
                );
                const newBtn = trackPlayBtn.cloneNode(true);
                trackPlayBtn.parentNode.replaceChild(newBtn, trackPlayBtn);
                cache.trackText = newBtn.querySelector(
                  '[data-field="track-mobile-text"]'
                );

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
                  playTrackButton(index, newBtn.dataset.trackIdentifier);
                });
              } else {
                trackPlayBtn.classList.remove(
                  'cursor-pointer',
                  'active:opacity-70'
                );
              }
            }
          }

          const secondaryTrackMobile = cache.secondaryTrackText;
          if (secondaryTrackMobile) {
            secondaryTrackMobile.textContent = data.secondaryTrackDisplay || '';
            updateTrackDuration(
              secondaryTrackMobile,
              data.secondaryTrackDuration,
              'secondary-track-mobile-duration',
              'shrink-0 ml-1 tabular-nums'
            );

            const secondaryPlayBtn = secondaryTrackMobile.closest(
              '[data-track-play-btn]'
            );
            if (secondaryPlayBtn) {
              const hasSecondary = !!data.secondaryTrackDisplay;
              secondaryPlayBtn.setAttribute(
                'data-track-play-btn',
                hasSecondary ? 'true' : ''
              );
              if (hasSecondary) {
                secondaryPlayBtn.dataset.trackIdentifier = data.secondaryTrack;
              } else {
                delete secondaryPlayBtn.dataset.trackIdentifier;
              }

              if (hasSecondary) {
                secondaryPlayBtn.classList.add(
                  'cursor-pointer',
                  'active:opacity-70'
                );
                const newSecondaryBtn = secondaryPlayBtn.cloneNode(true);
                secondaryPlayBtn.parentNode.replaceChild(
                  newSecondaryBtn,
                  secondaryPlayBtn
                );
                cache.secondaryTrackText = newSecondaryBtn.querySelector(
                  '[data-field="secondary-track-mobile-text"]'
                );

                newSecondaryBtn.addEventListener(
                  'touchstart',
                  (e) => e.stopPropagation(),
                  { passive: true }
                );
                newSecondaryBtn.addEventListener(
                  'touchend',
                  (e) => e.stopPropagation(),
                  { passive: true }
                );
                newSecondaryBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  playTrackButton(
                    index,
                    newSecondaryBtn.dataset.trackIdentifier
                  );
                });
              } else {
                secondaryPlayBtn.classList.remove(
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

        // Mobile rank badge uses inline styles (class name is
        // .mobile-position-badge), so recolor via style.* from the same shared
        // contract the initial render uses — keeps medal colors correct after
        // a drag-reorder.
        if (positionEl.classList.contains('mobile-position-badge')) {
          const c = getPositionBadgeColor(position);
          positionEl.style.borderColor = c.border;
          positionEl.style.boxShadow = `0 0 ${c.size} ${c.shadow}`;
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

    const taxonomyTriggers = container.querySelectorAll(
      '.taxonomy-trigger:not(.taxonomy-trigger-mobile)'
    );
    taxonomyTriggers.forEach((trigger) => {
      trigger.addEventListener('mouseenter', handleTaxonomyMouseEnter);
      trigger.addEventListener('mouseleave', handleBadgeMouseLeave);
      trigger.addEventListener('focus', handleTaxonomyMouseEnter);
      trigger.addEventListener('blur', handleBadgeMouseLeave);
    });
  }

  function showAlbumTooltip(badge, { className, iconClass, contentHtml }) {
    if (tooltipHideTimeout) {
      clearTimeout(tooltipHideTimeout);
      tooltipHideTimeout = null;
    }
    if (tooltipRemoveTimeout) {
      clearTimeout(tooltipRemoveTimeout);
      tooltipRemoveTimeout = null;
    }

    if (activeTooltip && activeBadge === badge && activeTooltip.parentNode) {
      activeTooltip.classList.add('visible');
      positionTooltip(badge, activeTooltip);
      return;
    }
    if (activeTooltip && activeBadge !== badge) {
      activeTooltip.remove();
      activeTooltip = null;
      activeBadge = null;
    }

    const tooltip = document.createElement('div');
    tooltip.className = `summary-tooltip ${className}`;
    tooltip.innerHTML = `
      <div class="summary-tooltip-header">
        <i class="${iconClass}"></i>
        <span>${escapeHtml(badge.dataset.albumName)} - ${escapeHtml(badge.dataset.artist)}</span>
      </div>
      <div class="summary-tooltip-content">${contentHtml}</div>
    `;
    tooltip.addEventListener('mouseenter', handleTooltipMouseEnter);
    tooltip.addEventListener('mouseleave', handleTooltipMouseLeave);
    document.body.appendChild(tooltip);
    activeTooltip = tooltip;
    activeBadge = badge;
    positionTooltip(badge, tooltip);
    requestAnimationFrame(() => tooltip.classList.add('visible'));
  }

  /**
   * Handle mouse enter on summary badge
   * @param {MouseEvent} e - Mouse event
   */
  function handleBadgeMouseEnter(e) {
    const badge = e.currentTarget;
    const summary = badge.dataset.summary;
    if (!summary) return;
    showAlbumTooltip(badge, {
      className: 'claude-tooltip',
      iconClass: 'fas fa-robot',
      contentHtml: escapeHtml(summary),
    });
  }

  function taxonomyFromTrigger(trigger) {
    try {
      const taxonomy = JSON.parse(trigger.dataset.taxonomy || '');
      return renderTaxonomyContent(taxonomy) ? taxonomy : null;
    } catch (_error) {
      return null;
    }
  }

  function handleTaxonomyMouseEnter(event) {
    const trigger = event.currentTarget;
    const taxonomy = taxonomyFromTrigger(trigger);
    if (!taxonomy) return;
    showAlbumTooltip(trigger, {
      className: 'taxonomy-tooltip',
      iconClass: 'fas fa-tags',
      contentHtml: renderTaxonomyContent(taxonomy),
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
    if (!recommendedBy) return;

    const dateDisplay = formatRecommendationDate(recommendedAt);
    showAlbumTooltip(badge, {
      className: 'recommendation-tooltip',
      iconClass: 'fas fa-thumbs-up',
      contentHtml: `Recommended by <strong style="color: #bfdbfe;">${escapeHtml(recommendedBy)}</strong>${dateDisplay ? ` on ${dateDisplay}` : ''}`,
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
    existing.forEach((modal) => destroyModalForElement(modal));

    // Hide FAB when modal is shown
    const fab = document.getElementById('addAlbumFAB');
    if (fab) {
      fab.style.display = 'none';
    }

    const modal = document.createElement('div');
    modal.className =
      'fixed inset-0 modal-layer flex items-center justify-center p-4 safe-area-modal';
    modal.setAttribute('data-recommendation-modal', 'true');
    modal.innerHTML = `
      <div class="absolute inset-0 modal-overlay" data-backdrop></div>
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

    // Backdrop, close button, Escape and scroll lock via the shared controller;
    // restore the FAB on close.
    const controller = createModal({
      element: modal,
      backdrop: modal.querySelector('[data-backdrop]'),
      closeButton: modal.querySelector('[data-close-rec]'),
      label: 'Recommendation',
      onClose: () => {
        modal.remove();
        const fabEl = document.getElementById('addAlbumFAB');
        if (fabEl && getCurrentList()) {
          fabEl.style.display = 'flex';
        }
      },
    });
    controller.open();
  }

  function showMobileTaxonomySheet(trigger) {
    const taxonomy = taxonomyFromTrigger(trigger);
    if (!taxonomy) return;

    document
      .querySelectorAll('[data-taxonomy-modal]')
      .forEach((modal) => destroyModalForElement(modal));
    const fab = document.getElementById('addAlbumFAB');
    if (fab) fab.style.display = 'none';

    const modal = document.createElement('div');
    modal.className =
      'fixed inset-0 modal-layer flex items-center justify-center p-4 safe-area-modal';
    modal.setAttribute('data-taxonomy-modal', 'true');
    modal.innerHTML = `
      <div class="absolute inset-0 modal-overlay" data-backdrop></div>
      <div class="relative bg-gray-900 rounded-lg shadow-2xl flex flex-col w-full max-w-lg max-h-[85vh] overflow-hidden">
        <div class="flex items-center justify-between p-4 border-b border-gray-800 shrink-0">
          <button data-close-taxonomy class="p-2 -m-2 text-gray-400 hover:text-white active:text-white" aria-label="Close taxonomy">
            <i class="fas fa-times text-xl"></i>
          </button>
          <div class="flex-1 text-center px-4 min-w-0">
            <div class="flex items-center justify-center gap-2 mb-1">
              <i class="fas fa-tags taxonomy-modal-icon"></i>
              <h3 class="text-lg font-semibold text-white truncate">${escapeHtml(trigger.dataset.albumName)}</h3>
            </div>
            <p class="text-sm text-gray-400 truncate">${escapeHtml(trigger.dataset.artist)}</p>
          </div>
          <div class="w-10"></div>
        </div>
        <div class="taxonomy-modal-content flex-1 overflow-y-auto overflow-x-hidden -webkit-overflow-scrolling-touch p-4">
          ${renderTaxonomyContent(taxonomy)}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const controller = createModal({
      element: modal,
      backdrop: modal.querySelector('[data-backdrop]'),
      closeButton: modal.querySelector('[data-close-taxonomy]'),
      label: 'Album taxonomy',
      onClose: () => {
        modal.remove();
        const fabEl = document.getElementById('addAlbumFAB');
        if (fabEl && getCurrentList()) fabEl.style.display = 'flex';
      },
    });
    controller.open();
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
      const tooltipToRemove = activeTooltip;
      tooltipToRemove.classList.remove('visible');
      // Remove after animation
      tooltipRemoveTimeout = setTimeout(() => {
        tooltipToRemove.remove();
        if (activeTooltip === tooltipToRemove) {
          activeTooltip = null;
          activeBadge = null;
        }
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
    const tooltipWidth = tooltip.offsetWidth || 320;
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
    const highQualitySrc =
      coverImage.dataset.fullSrc ||
      coverImage.dataset.lazySrc ||
      coverImage.src;
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
   * Main display function - renders albums to the container
   * @param {Array} albums - Album array to display
   * @param {Object} options - Display options
   * @param {boolean} options.forceFullRebuild - Force full rebuild
   * @param {boolean} options.hydrate - Reconcile same-order core-to-full metadata in place
   */
  function displayAlbums(albums, options = {}) {
    const { forceFullRebuild = false, hydrate = false } = options;
    const isMobile = isMobileViewport();
    const container = document.getElementById('albumContainer');

    if (!container) {
      console.error('Album container not found!');
      return;
    }

    if (hydrate && progressiveRenderInProgress) {
      pendingHydration = albums;
      return;
    }
    if (forceFullRebuild) pendingHydration = null;

    // Clear lock UI eagerly on full rebuild (list switch) to prevent stale
    // indicators from a previous list's async isListLocked check
    if (forceFullRebuild) {
      clearYearLockUIFn(container);
    }

    // Try incremental update first using fingerprint comparison
    if (!forceFullRebuild) {
      const newFingerprint = generateAlbumFingerprint(albums);

      // Quick fingerprint check - if unchanged, no update needed at all
      if (newFingerprint === lastRenderedFingerprint) {
        return; // No changes detected
      }

      const updateType = detectUpdateType(lastRenderedMutableState, albums, {
        incrementalEnabled: ENABLE_INCREMENTAL_UPDATES,
        allowBulkFieldUpdate: hydrate,
      });

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

          console.log(`Album removed from index ${updateType.index}`);
          return;
        }
        console.warn('Single remove failed, falling back to full rebuild');
      }

      // Reconcile mutable fields, including versioned cover URLs, in place.
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

          reapplyNowPlayingHighlight();

          return;
        }
        console.warn(
          `Incremental update (${updateType}) failed, falling back to full rebuild`
        );
      }
    }

    // Full rebuild path - clear element caches
    renderGeneration += 1;
    const activeRenderGeneration = renderGeneration;
    positionElementCache = new WeakMap();
    resetRowElementsCache();

    let albumContainer;
    let progressiveParent = null;
    const useProgressiveRender = albums.length > PROGRESSIVE_RENDER_THRESHOLD;
    progressiveRenderInProgress = useProgressiveRender;

    const appendAlbumBatch = (parent, startIndex, endIndex) => {
      const fragment = document.createDocumentFragment();
      for (let index = startIndex; index < endIndex; index++) {
        const item = createAlbumItem(albums[index], index, isMobile);
        fragment.appendChild(item);
      }
      parent.appendChild(fragment);
      loadCoverImages(parent);
      reapplyNowPlayingHighlight();
    };

    const scheduleRenderBatch = (callback) => {
      if (window.requestIdleCallback) {
        window.requestIdleCallback(callback, { timeout: 100 });
        return;
      }
      window.setTimeout(callback, 0);
    };

    const finalizeRenderedList = () => {
      if (activeRenderGeneration !== renderGeneration) return;
      progressiveRenderInProgress = false;

      prePopulatePositionCache(container, isMobile);

      // Only enable sorting if the list is not locked (main list in locked year)
      const currentList = getCurrentList();
      const listMeta = getListMetadata(currentList);
      const listYear = listMeta?.year || null;
      const listIsMain = listMeta?.isMain || false;

      if (listYear && listIsMain) {
        // Only check lock status for main lists
        isListLockedFn(listYear, listIsMain).then((locked) => {
          if (activeRenderGeneration !== renderGeneration) return;
          if (!locked) {
            initializeUnifiedSorting(container, isMobile);
            clearYearLockUIFn(container);
          } else {
            // Main list is locked - destroy any existing sortable instance
            if (destroySorting) {
              destroySorting(container);
            }
            showYearLockUIFn(container, listYear);
          }
        });
      } else {
        // Non-main lists or collections - always enable sorting
        initializeUnifiedSorting(container, isMobile);
        clearYearLockUIFn(container);
      }

      // Initialize Last.fm summary tooltips (desktop only)
      if (!isMobile) {
        initSummaryTooltips(container);
      }

      // Update lightweight state instead of expensive deep clone
      requestAnimationFrame(() => {
        if (activeRenderGeneration !== renderGeneration) return;
        lastRenderedFingerprint = generateAlbumFingerprint(albums);
        lastRenderedMutableState = extractMutableFingerprints(albums);
        if (pendingHydration) {
          const hydrationData = pendingHydration;
          pendingHydration = null;
          displayAlbums(hydrationData, { hydrate: true });
        }
      });
    };

    const renderRemainingBatches = (parent, nextIndex) => {
      if (activeRenderGeneration !== renderGeneration) return;
      if (nextIndex >= albums.length) {
        finalizeRenderedList();
        return;
      }

      const endIndex = Math.min(
        nextIndex + PROGRESSIVE_RENDER_BATCH_SIZE,
        albums.length
      );
      appendAlbumBatch(parent, nextIndex, endIndex);
      scheduleRenderBatch(() => renderRemainingBatches(parent, endIndex));
    };

    if (!albums || albums.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'text-center text-gray-500 mt-20 px-4';
      emptyDiv.innerHTML = `
        <p class="text-xl mb-2">This list is empty</p>
        <p class="text-sm">Click the + button to add albums${isMobile ? '' : ' or use the Add Album button'}</p>
      `;
      container.replaceChildren(emptyDiv);
      finalizeRenderedList();
      return;
    }

    if (!isMobile) {
      // Desktop: Table layout with header
      // Build header with ALL columns; hidden ones get .column-hidden
      const allCols = getAllColumns();
      const visibleCols = getVisibleColumns();
      const gridTemplate = computeGridTemplate(visibleCols);

      const header = document.createElement('div');
      header.className =
        'album-header album-grid gap-4 py-2 text-[0.8125rem] font-medium text-gray-200 border-b border-gray-800 sticky top-0 z-10 shrink-0';
      header.style.alignItems = 'center';
      header.style.gridTemplateColumns = gridTemplate;
      header.style.position = 'relative';

      // Header cell extra classes by column ID
      const headerExtras = {
        position: ' text-center',
        album: ' pl-2',
        comment: ' pl-2',
        comment_2: ' pl-2',
      };

      const headerCells = allCols
        .map((col) => {
          const hidden = !isColumnVisible(col.id) ? ' column-hidden' : '';
          return `<div class="${col.cellClass}${headerExtras[col.id] || ''}${hidden}">${col.label}</div>`;
        })
        .join('\n        ');
      header.innerHTML = headerCells;

      // Column visibility toggle button + dropdown
      const toggleBtn = document.createElement('button');
      toggleBtn.className =
        'column-toggle-btn absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-300 transition-colors duration-150 z-20';
      toggleBtn.title = 'Show/hide columns';
      toggleBtn.innerHTML = '<i class="fas fa-columns text-xs"></i>';

      // Dropdown appended to body with fixed positioning to avoid
      // clipping by #albumContainer's overflow-y: auto
      const dropdown = document.createElement('div');
      dropdown.className =
        'column-toggle-dropdown hidden fixed w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50';

      // Build checkbox list
      const toggleableCols = getToggleableColumns();
      dropdown.innerHTML = `
        <div class="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
          <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Columns</span>
          <button class="column-toggle-reset text-xs text-gray-400 hover:text-gray-200 transition-colors cursor-pointer ml-4">Reset</button>
        </div>
        <div class="py-1">
          ${toggleableCols
            .map(
              (col) => `
            <label class="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-gray-700/50 transition-colors duration-100">
              <input type="checkbox" data-column-id="${col.id}"
                ${isColumnVisible(col.id) ? 'checked' : ''}
                class="w-3.5 h-3.5 rounded-sm border-gray-600 bg-gray-900 text-red-600 focus:ring-red-500 focus:ring-offset-gray-800 cursor-pointer accent-[var(--accent-color)]" />
              <span class="text-sm text-gray-300">${col.label}</span>
            </label>`
            )
            .join('')}
        </div>
      `;
      document.body.appendChild(dropdown);

      /** Position the dropdown below the button, right-aligned */
      function positionDropdown() {
        const rect = toggleBtn.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + 4}px`;
        dropdown.style.left = `${rect.right - dropdown.offsetWidth}px`;
      }

      // Toggle dropdown on button click
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasHidden = dropdown.classList.contains('hidden');
        dropdown.classList.toggle('hidden');
        if (wasHidden) positionDropdown();
      });

      // Reset button — show all columns
      dropdown
        .querySelector('.column-toggle-reset')
        .addEventListener('click', (e) => {
          e.stopPropagation();
          setAllColumns(true);
          applyVisibilityInPlace();
          // Sync dropdown checkboxes
          dropdown
            .querySelectorAll('input[data-column-id]')
            .forEach((cb) => (cb.checked = true));
        });

      // Checkbox change handlers
      dropdown.querySelectorAll('input[data-column-id]').forEach((cb) => {
        cb.addEventListener('change', (e) => {
          e.stopPropagation();
          toggleColumn(cb.dataset.columnId);
          applyVisibilityInPlace();
        });
      });

      // Close dropdown on outside click
      const closeDropdown = (e) => {
        if (
          !dropdown.contains(e.target) &&
          e.target !== toggleBtn &&
          !toggleBtn.contains(e.target)
        ) {
          dropdown.classList.add('hidden');
        }
      };
      document.addEventListener('click', closeDropdown);

      // Close on Escape
      const escHandler = (e) => {
        if (e.key === 'Escape' && !dropdown.classList.contains('hidden')) {
          dropdown.classList.add('hidden');
        }
      };
      document.addEventListener('keydown', escHandler);

      header.appendChild(toggleBtn);

      // Clean up previous body-appended dropdown on rebuild
      const oldDropdown = document.querySelector(
        'body > .column-toggle-dropdown'
      );
      if (oldDropdown && oldDropdown !== dropdown) oldDropdown.remove();

      // Create rows container
      const rowsContainer = document.createElement('div');
      rowsContainer.className = 'album-rows-container relative flex-1';

      const initialEnd = useProgressiveRender
        ? Math.min(PROGRESSIVE_RENDER_BATCH_SIZE, albums.length)
        : albums.length;
      appendAlbumBatch(rowsContainer, 0, initialEnd);
      if (useProgressiveRender) {
        progressiveParent = rowsContainer;
      }

      // Create a fragment to hold both header and rows
      albumContainer = document.createDocumentFragment();
      albumContainer.appendChild(header);
      albumContainer.appendChild(rowsContainer);
    } else {
      // Mobile: Card layout
      albumContainer = document.createElement('div');
      albumContainer.className = 'mobile-album-list';

      const initialEnd = useProgressiveRender
        ? Math.min(PROGRESSIVE_RENDER_BATCH_SIZE, albums.length)
        : albums.length;
      appendAlbumBatch(albumContainer, 0, initialEnd);
      if (useProgressiveRender) {
        progressiveParent = albumContainer;
      }
    }

    container.replaceChildren(albumContainer);
    reapplyNowPlayingHighlight();

    // Kick off cover-image loading for every album (not just the visible ones)
    loadCoverImages(container);

    if (progressiveParent) {
      scheduleRenderBatch(() =>
        renderRemainingBatches(progressiveParent, PROGRESSIVE_RENDER_BATCH_SIZE)
      );
      return;
    }

    finalizeRenderedList();
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
   * Update summary for a single album without full refresh
   * @param {string} albumId - Album ID to update
   * @param {Object} summaryData - Summary data from API
   * @param {string} summaryData.summary - Summary text
   * @param {string} summaryData.summarySource - Summary source
   */
  async function updateAlbumSummaryInPlace(albumId, summaryData) {
    const isMobile = isMobileViewport();
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
        const badgeContainer = isMobile
          ? row.querySelector('[data-mobile-album-badges]')
          : row.querySelector('[data-desktop-album-badges]');
        if (!badgeContainer) continue;

        const badge = badgeContainer.querySelector(
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

            // Mobile badges belong in the title-row overlay, not beside the cover.
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = badgeHtml;
            const newBadge = tempDiv.firstElementChild;
            badgeContainer.appendChild(newBadge);

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
            // Update existing badge. No escapeHtml here: setting a dataset
            // property writes the attribute verbatim, where the HTML-string
            // path at render time is decoded by the parser. Escaping both
            // would show a literal &quot; in the tooltip.
            badge.dataset.summary = summaryData.summary;
            badge.dataset.source = summaryData.summarySource || '';
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

  // Listen for column visibility changes from external sources (e.g. settings drawer)
  window.addEventListener('columnvisibilitychange', () => {
    const isMobile = isMobileViewport();
    if (isMobile) return; // Column visibility only applies to desktop
    applyVisibilityInPlace();
  });

  // Return public API
  return {
    displayAlbums,
    fetchAndDisplayPlaycounts: playcountSync.fetchAndDisplayPlaycounts,
    prefetchPlaycountsForRender: playcountSync.prefetchPlaycountsForRender,
    primePlaycountCache: playcountSync.primePlaycountCache,
    updatePositionNumbers,
    clearLastRenderedCache,
    clearPlaycountCache: playcountSync.clearPlaycountCache,
    cancelPollingForList: playcountSync.cancelPollingForList,
    updateAlbumSummaryInPlace,
    invalidateFingerprint,
    // Granular DOM updates
    insertAlbumAtIndex,
    removeAlbumAtIndex,
    // Expose for testing
    processAlbumData,
    createAlbumItem,
    detectUpdateType,
    playAlbumFromMobileCover,
  };
}
