/**
 * Track Selection Module
 *
 * Handles the quick track selection menu, track cell display updates,
 * and track utility functions (getTrackName, getTrackLength, fetchTracksForAlbum).
 *
 * @param {Object} deps - External dependencies
 * @returns {Object} Public API
 */
export function createTrackSelection(deps = {}) {
  const {
    apiCall,
    showToast,
    getListData,
    getCurrentListId,
    formatTrackTime,
    saveList: _saveList,
  } = deps;

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

  /**
   * Fetch track listing from MusicBrainz API.
   * Mutates album.tracks with the result.
   * @param {Object} album - Album object
   * @param {AbortSignal|null} signal - Optional abort signal
   * @returns {Promise<Array>} Tracks array
   */
  async function fetchTracksForAlbum(album, signal = null) {
    const params = new URLSearchParams({
      id: album.album_id || '',
      artist: album.artist,
      album: album.album,
    });

    const fetchOptions = {
      credentials: 'include',
    };

    if (signal) {
      fetchOptions.signal = signal;
    }

    const resp = await fetch(
      `/api/musicbrainz/tracks?${params.toString()}`,
      fetchOptions
    );
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Failed');
    album.tracks = data.tracks;
    return data.tracks;
  }

  // ============ TRACK CELL DISPLAY ============

  /**
   * Update track cell display for dual track picks (primary + secondary).
   * Handles both mobile cards and desktop table rows.
   */
  function updateTrackCellDisplayDual(albumIndex, trackPicks, tracks) {
    const isMobile = window.innerWidth < 1024;

    function processTrack(trackIdentifier) {
      if (!trackIdentifier) return null;
      const name = getTrackName(trackIdentifier);
      if (!name) return null;

      const matchingTrack = tracks
        ? tracks.find((t) => {
            const tName = typeof t === 'string' ? t : t.name || String(t);
            return tName === name;
          })
        : null;

      const duration = matchingTrack ? getTrackLength(matchingTrack) : null;
      const formatted = duration ? formatTrackTime(duration) : '';

      const numMatch = name.match(/^(\d+)\.\s*(.*)$/);
      const displayName = numMatch
        ? `<span class="text-gray-500 font-mono text-xs">${numMatch[1]}.</span> ${numMatch[2]}`
        : name;

      return { name, displayName, formatted, trackClass: 'text-gray-300' };
    }

    const primary = processTrack(trackPicks?.primary);
    const secondary = processTrack(trackPicks?.secondary);

    let cellHtml;
    if (isMobile) {
      // Mobile: compact format for card layout
      if (primary && secondary) {
        cellHtml = `
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-1 ${primary.trackClass}">
              <span class="text-yellow-400 text-[10px]" title="Primary pick">\u2605</span>
              <span class="truncate">${primary.displayName}</span>
              ${primary.formatted ? `<span class="text-gray-500 text-xs ml-auto shrink-0">${primary.formatted}</span>` : ''}
            </div>
            <div class="flex items-center gap-1 text-gray-500 text-xs">
              <span class="text-gray-600 text-[10px]" title="Secondary pick">\u2606</span>
              <span class="truncate">${secondary.displayName}</span>
              ${secondary.formatted ? `<span class="text-gray-600 text-xs ml-auto shrink-0">${secondary.formatted}</span>` : ''}
            </div>
          </div>`;
      } else if (primary) {
        cellHtml = `
          <div class="flex items-center gap-1 ${primary.trackClass}">
            <span class="text-yellow-400 text-[10px]" title="Primary pick">\u2605</span>
            <span class="truncate">${primary.displayName}</span>
            ${primary.formatted ? `<span class="text-gray-500 text-xs ml-auto shrink-0">${primary.formatted}</span>` : ''}
          </div>`;
      } else if (secondary) {
        cellHtml = `
          <div class="flex items-center gap-1 text-gray-500 text-xs">
            <span class="text-gray-600 text-[10px]" title="Secondary pick">\u2606</span>
            <span class="truncate">${secondary.displayName}</span>
            ${secondary.formatted ? `<span class="text-gray-600 text-xs ml-auto shrink-0">${secondary.formatted}</span>` : ''}
          </div>`;
      } else {
        cellHtml = '<span class="text-gray-600 italic text-xs">No track</span>';
      }
    } else {
      // Desktop: match createDesktopAlbumRow() HTML structure exactly
      const primaryHtml = primary
        ? `<div class="flex items-center min-w-0 overflow-hidden w-full">
            <span class="text-yellow-400 mr-1.5 text-base shrink-0" title="Primary track">\u2605</span>
            <span class="album-cell-text ${primary.trackClass} truncate hover:text-gray-100 flex-1 min-w-0" title="${primary.name}">${primary.displayName}</span>
            ${primary.formatted ? `<span class="text-xs text-gray-500 shrink-0 ml-2 tabular-nums">${primary.formatted}</span>` : ''}
          </div>`
        : `<div class="flex items-center min-w-0">
            <span class="album-cell-text text-gray-800 italic hover:text-gray-100">Select Track</span>
          </div>`;

      const secondaryHtml = secondary
        ? `<div class="flex items-center min-w-0 mt-1 overflow-hidden w-full">
            <span class="text-yellow-400 mr-1.5 text-base shrink-0" title="Secondary track">\u2606</span>
            <span class="album-cell-text ${secondary.trackClass} truncate hover:text-gray-100 text-sm flex-1 min-w-0" title="${secondary.name}">${secondary.displayName}</span>
            ${secondary.formatted ? `<span class="text-xs text-gray-500 shrink-0 ml-2 tabular-nums">${secondary.formatted}</span>` : ''}
          </div>`
        : '';

      cellHtml = primaryHtml + secondaryHtml;
    }

    if (isMobile) {
      const cards = document.querySelectorAll('.album-card');
      const card = cards[albumIndex];
      if (!card) return;

      const trackCell = card.querySelector('[data-field="track_pick"]');
      if (trackCell) {
        trackCell.innerHTML = cellHtml;
        trackCell.onclick = async (e) => {
          e.stopPropagation();
          const listData = getListData(getCurrentListId());
          if (!listData) return;
          const album = listData[albumIndex];
          if (!album) return;
          if (!album.tracks) {
            try {
              await fetchTracksForAlbum(album);
            } catch (_err) {
              showToast('Could not load tracks', 'error');
              return;
            }
          }
          const rect = trackCell.getBoundingClientRect();
          showTrackSelectionMenu(album, albumIndex, rect.left, rect.bottom);
        };
      }
    } else {
      const rows = document.querySelectorAll('.album-row');
      const row = rows[albumIndex];
      if (!row) return;

      const trackCell = row.querySelector('.track-cell');
      if (trackCell) {
        trackCell.innerHTML = cellHtml;
        trackCell.style.cursor = 'pointer';
        trackCell.onclick = async (e) => {
          e.stopPropagation();
          const listData = getListData(getCurrentListId());
          if (!listData) return;
          const album = listData[albumIndex];
          if (!album) return;
          if (!album.tracks) {
            try {
              await fetchTracksForAlbum(album);
            } catch (_err) {
              showToast('Could not load tracks', 'error');
              return;
            }
          }
          const rect = trackCell.getBoundingClientRect();
          showTrackSelectionMenu(album, albumIndex, rect.left, rect.bottom);
        };
      }
    }
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
    // Remove existing menu
    const existingMenu = document.getElementById('quickTrackMenu');
    if (existingMenu) existingMenu.remove();

    if (!album.tracks || album.tracks.length === 0) {
      showToast('No tracks available', 'info');
      return;
    }

    // Sort tracks by track number
    const sortedTracks = [...album.tracks].sort((a, b) => {
      const numA = typeof a === 'object' ? a.position || 0 : 0;
      const numB = typeof b === 'object' ? b.position || 0 : 0;
      return numA - numB;
    });

    // Get current picks
    const currentPrimary = album.track_picks?.primary || album.track_pick;
    const currentSecondary = album.track_picks?.secondary || null;
    const currentPrimaryName = getTrackName(currentPrimary);
    const currentSecondaryName = getTrackName(currentSecondary);

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
      'Click: select \u2606 &nbsp;|&nbsp; Click again: promote to \u2605 &nbsp;|&nbsp; Click \u2605: deselect';
    menu.appendChild(header);

    // Clear button
    const clearBtn = document.createElement('button');
    clearBtn.className =
      'w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800 border-b border-gray-700';
    clearBtn.textContent = 'Clear all picks';
    clearBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const listData = getListData(getCurrentListId());
        if (!listData) return;
        const currentAlbum = listData[albumIndex];
        if (!currentAlbum?._id) return;

        await apiCall(`/api/track-picks/${currentAlbum._id}`, {
          method: 'DELETE',
        });

        currentAlbum.track_pick = null;
        currentAlbum.primary_track = null;
        currentAlbum.secondary_track = null;
        currentAlbum.track_picks = { primary: null, secondary: null };
        selectedPrimary = null;
        selectedSecondary = null;
        updateMenuUI();
        updateTrackCellDisplayDual(
          albumIndex,
          currentAlbum.track_picks,
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
        ? `<span class="text-gray-500 font-mono text-xs mr-1">${numMatch[1]}.</span>${numMatch[2]}`
        : trackName;

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

        const listData = getListData(getCurrentListId());
        if (!listData) return;
        const currentAlbum = listData[albumIndex];
        if (!currentAlbum?._id) return;

        // Determine the API action BEFORE updating local state
        // The backend handles swap logic internally, so send one call per click
        let apiAction;
        if (trackName === selectedPrimary) {
          // Clicking primary = deselect it
          apiAction = {
            method: 'DELETE',
            body: JSON.stringify({ trackIdentifier: trackName }),
          };
        } else if (trackName === selectedSecondary) {
          // Clicking secondary = promote to primary
          apiAction = {
            method: 'POST',
            body: JSON.stringify({ trackIdentifier: trackName, priority: 1 }),
          };
        } else {
          // New track = add as secondary (backend handles demotion)
          apiAction = {
            method: 'POST',
            body: JSON.stringify({ trackIdentifier: trackName, priority: 2 }),
          };
        }

        // Update local state for immediate UI feedback
        if (trackName === selectedPrimary) {
          selectedPrimary = selectedSecondary;
          selectedSecondary = null;
        } else if (trackName === selectedSecondary) {
          selectedSecondary = selectedPrimary;
          selectedPrimary = trackName;
        } else {
          selectedSecondary = selectedPrimary ? trackName : null;
          if (!selectedPrimary) {
            selectedPrimary = trackName;
            selectedSecondary = null;
          }
        }

        const newPicks = {
          primary: selectedPrimary
            ? sortedTracks.find((t) => getTrackName(t) === selectedPrimary) ||
              selectedPrimary
            : null,
          secondary: selectedSecondary
            ? sortedTracks.find((t) => getTrackName(t) === selectedSecondary) ||
              selectedSecondary
            : null,
        };

        // Update local data
        currentAlbum.track_pick = newPicks.primary;
        currentAlbum.track_picks = newPicks;

        updateMenuUI();
        updateTrackCellDisplayDual(albumIndex, newPicks, album.tracks);

        // Persist - single API call, backend handles swap logic internally
        try {
          const result = await apiCall(
            `/api/track-picks/${currentAlbum._id}`,
            apiAction
          );

          // Sync local state with backend response (authoritative)
          if (result) {
            selectedPrimary = result.primary_track || null;
            selectedSecondary = result.secondary_track || null;
            currentAlbum.primary_track = selectedPrimary;
            currentAlbum.secondary_track = selectedSecondary;
            currentAlbum.track_pick = selectedPrimary;
            updateMenuUI();
          }
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

        opt.classList.remove(
          'bg-yellow-900/30',
          'bg-gray-800/50',
          'text-white',
          'text-gray-300'
        );

        if (name === selectedPrimary) {
          indicator.innerHTML = '<span class="text-yellow-400">\u2605</span>';
          opt.classList.add('bg-yellow-900/30', 'text-white');
        } else if (name === selectedSecondary) {
          indicator.innerHTML = '<span class="text-gray-400">\u2606</span>';
          opt.classList.add('bg-gray-800/50', 'text-gray-300');
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
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };

    setTimeout(() => {
      document.addEventListener('click', closeMenu);
    }, 0);
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
