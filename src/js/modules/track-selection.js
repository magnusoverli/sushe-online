/**
 * Track Selection Module
 *
 * Handles the quick track selection menu, track cell display updates,
 * and track utility functions (getTrackName, getTrackLength, fetchTracksForAlbum).
 *
 * @param {Object} deps - External dependencies
 * @returns {Object} Public API
 */
import { createTrackPickService } from './track-pick-service.js';
import { fetchTracksForAlbum } from './track-loading.js';
import { stateEvents } from './state-events.js';
import { escapeHtml } from './html-utils.js';
import { resolveTrackTitle } from '../utils/track-reference.js';

export function createTrackSelection(deps = {}) {
  const {
    apiCall,
    showToast,
    getListData,
    getCurrentListId,
    formatTrackTime,
    saveList: _saveList,
    refreshAlbumDisplay = () => {},
  } = deps;
  const trackPickService = createTrackPickService({ apiCall });
  let disposeMenu = () => {};

  // ============ PURE HELPERS ============

  /**
   * Extract track name from a track argument.
   * @param {string|Object} track - Track as string or object with .name
   * @returns {string} Track name
   */
  function getTrackName(track) {
    if (!track) return '';
    if (typeof track === 'string') return track;
    if (typeof track === 'object' && track.name) return track.name;
    return String(track);
  }

  /**
   * Get track length in milliseconds from a track object.
   * @param {string|Object} track - Track as string or object with .length
   * @returns {number|null} Track length in ms or null
   */
  function getTrackLength(track) {
    if (!track || typeof track !== 'object') return null;
    return track.length || null;
  }

  // ============ TRACK CELL DISPLAY ============

  /**
   * Re-render the album card after a track-pick mutation. Album display owns the
   * selected-track markup, preventing this immediate update from drifting from
   * the normal desktop and mobile card renderers.
   */
  function updateTrackCellDisplayDual() {
    refreshAlbumDisplay();
  }

  // ============ TRACK SELECTION MENU ============

  /**
   * Show the quick track selection menu.
   * Supports dual selection: click once = secondary, click again = primary.
   * @param {Object} album - Album object with .tracks array
   * @param {number} albumIndex - Index in current list
   * @param {number} x - X position
   * @param {number} y - Y position
   */
  function showTrackSelectionMenu(album, albumIndex, x, y) {
    disposeMenu();
    const ownerListId = getCurrentListId();
    const findItem = () =>
      getListData(ownerListId)?.find((item) => item._id === album._id);
    // Remove existing menu
    const existingMenu = document.getElementById('quickTrackMenu');
    if (existingMenu) existingMenu.remove();

    // Sort tracks by track number
    const sortedTracks = [...(album.tracks || [])].sort((a, b) => {
      const numA = typeof a === 'object' ? a.position || 0 : 0;
      const numB = typeof b === 'object' ? b.position || 0 : 0;
      return numA - numB;
    });

    // Get current picks
    const currentPrimary = album.primary_track;
    const currentSecondary = album.secondary_track || null;
    const currentPrimaryName = resolveTrackTitle(currentPrimary, album.tracks);
    const currentSecondaryName = resolveTrackTitle(
      currentSecondary,
      album.tracks
    );

    // Track current selections (mutable during menu interaction)
    let selectedPrimary = currentPrimaryName || null;
    let selectedSecondary = currentSecondaryName || null;

    // Build menu
    const menu = document.createElement('div');
    menu.id = 'quickTrackMenu';
    menu.className =
      'fixed z-[10000] bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-h-80 overflow-y-auto min-w-[280px] max-w-[350px]';

    // Header
    const header = document.createElement('div');
    header.className =
      'sticky top-0 bg-gray-900 border-b border-gray-700 px-3 py-2 text-xs text-gray-400';
    header.innerHTML =
      'Click: select <span class="font-[Georgia,serif] font-semibold text-green-400">II</span> &nbsp;|&nbsp; Click again: promote to <span class="font-[Georgia,serif] font-semibold text-green-400">I</span> &nbsp;|&nbsp; Click <span class="font-[Georgia,serif] font-semibold text-green-400">I</span>: deselect';
    menu.appendChild(header);

    // Clear button
    const clearBtn = document.createElement('button');
    clearBtn.className =
      'w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800 border-b border-gray-700';
    clearBtn.textContent = 'Clear all picks';
    clearBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const currentAlbum = findItem();
        if (!currentAlbum?._id) return;

        const result = await trackPickService.clearTrackPicks(currentAlbum._id);
        selectedPrimary = result.primaryTrack || null;
        selectedSecondary = result.secondaryTrack || null;
        currentAlbum.primary_track = selectedPrimary;
        currentAlbum.secondary_track = selectedSecondary;
        updateMenuUI();
        if (getCurrentListId() === ownerListId)
          updateTrackCellDisplayDual(
            albumIndex,
            { primary: null, secondary: null },
            album.tracks
          );
      } catch (err) {
        console.error('Error clearing track picks:', err);
        showToast('Error clearing track picks', 'error');
      }
    });
    menu.appendChild(clearBtn);

    // Track options
    sortedTracks.forEach((track) => {
      const trackName = getTrackName(track);
      const trackLength = getTrackLength(track);
      const formattedLength = trackLength ? formatTrackTime(trackLength) : '';

      const numMatch = trackName.match(/^(\d+)\.\s*(.*)$/);
      const displayName = numMatch
        ? `<span class="text-gray-500 font-mono text-xs mr-1">${numMatch[1]}.</span>${escapeHtml(numMatch[2])}`
        : escapeHtml(trackName);

      const option = document.createElement('button');
      option.className =
        'track-option w-full text-left px-3 py-1.5 text-sm hover:bg-gray-800 flex items-center gap-2 transition-colors';
      option.dataset.trackName = trackName;

      option.innerHTML = `
        <span class="track-indicator w-4 text-center shrink-0"></span>
        <span class="truncate flex-1">${displayName}</span>
        ${formattedLength ? `<span class="text-gray-500 text-xs shrink-0">${formattedLength}</span>` : ''}
      `;

      option.addEventListener('click', async (e) => {
        e.stopPropagation();

        const currentAlbum = findItem();
        if (!currentAlbum?._id) return;

        // Persist via API - backend is the source of truth
        try {
          const result = await trackPickService.updateTrackPick(
            currentAlbum._id,
            trackName,
            () => ({
              primaryTrack: selectedPrimary,
              secondaryTrack: selectedSecondary,
            })
          );

          selectedPrimary = result.primaryTrack || null;
          selectedSecondary = result.secondaryTrack || null;

          // Update album data
          currentAlbum.primary_track = selectedPrimary;
          currentAlbum.secondary_track = selectedSecondary;

          updateMenuUI();
          if (getCurrentListId() === ownerListId)
            updateTrackCellDisplayDual(
              albumIndex,
              {
                primary: selectedPrimary,
                secondary: selectedSecondary,
              },
              album.tracks
            );
        } catch (err) {
          console.error('Error saving track picks:', err);
          showToast('Error saving track pick', 'error');
        }
      });

      menu.appendChild(option);
    });

    function updateMenuUI() {
      menu.querySelectorAll('.track-option').forEach((opt) => {
        const name = opt.dataset.trackName;
        const indicator = opt.querySelector('.track-indicator');

        opt.classList.remove('bg-gray-700/30', 'text-white', 'text-gray-300');

        if (
          name ===
          resolveTrackTitle(selectedPrimary, findItem()?.tracks || album.tracks)
        ) {
          indicator.innerHTML =
            '<span class="text-2xs font-semibold font-[Georgia,serif] text-green-400">I</span>';
          opt.classList.add('bg-gray-700/30', 'text-white');
        } else if (
          name ===
          resolveTrackTitle(
            selectedSecondary,
            findItem()?.tracks || album.tracks
          )
        ) {
          indicator.innerHTML =
            '<span class="text-2xs font-semibold font-[Georgia,serif] text-green-400">II</span>';
          opt.classList.add('bg-gray-700/30', 'text-white');
        } else {
          indicator.innerHTML = '';
          opt.classList.add('text-gray-300');
        }
      });
    }

    updateMenuUI();

    // Position the menu
    document.body.appendChild(menu);

    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = x;
    let top = y;

    if (left + menuRect.width > viewportWidth) {
      left = viewportWidth - menuRect.width - 10;
    }
    if (top + menuRect.height > viewportHeight) {
      top = y - menuRect.height;
      if (top < 0) top = 10;
    }

    menu.style.left = `${Math.max(0, left)}px`;
    menu.style.top = `${Math.max(0, top)}px`;

    // Close on outside click
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        disposeMenu();
      }
    };

    const unsubscribe = stateEvents.subscribe(
      [`item:${album._id}`, `list:${ownerListId}`, 'view'],
      () => {
        const current = findItem();
        if (!current || getCurrentListId() !== ownerListId)
          return disposeMenu();
        selectedPrimary = resolveTrackTitle(
          current.primary_track,
          current.tracks
        );
        selectedSecondary = resolveTrackTitle(
          current.secondary_track,
          current.tracks
        );
        updateMenuUI();
      }
    );
    const timer = setTimeout(
      () => document.addEventListener('click', closeMenu),
      0
    );
    disposeMenu = () => {
      clearTimeout(timer);
      unsubscribe();
      menu.remove();
      document.removeEventListener('click', closeMenu);
    };
  }

  // ============ PUBLIC API ============

  return {
    getTrackName,
    getTrackLength,
    fetchTracksForAlbum,
    showTrackSelectionMenu,
    updateTrackCellDisplayDual,
  };
}
