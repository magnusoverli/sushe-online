/**
 * Mobile album action sheets (menu + move/copy flows).
 * Extracted from mobile-ui to keep orchestration lean.
 */
export function createMobileAlbumActions(deps = {}) {
  const {
    createActionSheet,
    fetchSpotifyDevices,
    getCurrentList,
    getListData,
    getLists,
    getListMetadata,
    showToast,
    getDeviceIcon,
    playAlbumOnDeviceMobile,
    isViewingRecommendations,
    recommendAlbum,
    showDiscoveryModal,
    showMoveConfirmation,
    showCopyConfirmation,
    onEditAlbum,
    onPlayAlbum,
    onRemoveAlbum,
  } = deps;

  /**
   * Show mobile album action menu (bottom sheet)
   * @param {number|HTMLElement} indexOrElement - Album index or element that triggered the menu
   */
  function showMobileAlbumMenu(indexOrElement) {
    const currentList = getCurrentList();
    let index = indexOrElement;

    if (typeof indexOrElement !== 'number') {
      const card = indexOrElement.closest('.album-card');
      if (!card) return;
      index = parseInt(card.dataset.index);
    }

    // Validate index
    const albumsForSheet = getListData(currentList);
    if (
      isNaN(index) ||
      index < 0 ||
      !albumsForSheet ||
      index >= albumsForSheet.length
    ) {
      console.error('Invalid album index:', index);
      return;
    }

    const album = albumsForSheet[index];
    if (!album) {
      console.error('Album not found at index:', index);
      return;
    }

    // Create a unique identifier for this album
    const albumId =
      `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();

    const hasSpotify = window.currentUser?.spotifyAuth;
    const hasTidal = window.currentUser?.tidalAuth;
    const hasLastfm = !!window.currentUser?.lastfmUsername;
    const musicService = window.currentUser?.musicService;
    const hasQobuzPreferred = musicService === 'qobuz';
    const hasAnyService = hasSpotify || hasTidal || hasQobuzPreferred;

    // Determine which service to show for "Open in..." based on preference
    // Priority: user preference > only connected service > Spotify (if both)
    let primaryServiceName = '';
    let showSpotifyConnect = false;
    if (musicService === 'qobuz') {
      primaryServiceName = 'Qobuz';
      showSpotifyConnect = false;
    } else if (musicService === 'tidal' && hasTidal) {
      primaryServiceName = 'Tidal';
      showSpotifyConnect = false; // User explicitly chose Tidal
    } else if (musicService === 'spotify' && hasSpotify) {
      primaryServiceName = 'Spotify';
      showSpotifyConnect = true;
    } else if (hasTidal && !hasSpotify) {
      primaryServiceName = 'Tidal';
      showSpotifyConnect = false;
    } else if (hasSpotify) {
      primaryServiceName = 'Spotify';
      showSpotifyConnect = true;
    }

    // Determine if recommend option should be shown
    const listMeta = getListMetadata(getCurrentList());
    const isYearBased =
      listMeta && listMeta.year !== null && listMeta.year !== undefined;
    const viewingRecs = isViewingRecommendations
      ? isViewingRecommendations()
      : false;
    const showRecommend = isYearBased && !viewingRecs;

    const { sheet: actionSheet, close } = createActionSheet({
      contentHtml: `
          <h3 class="font-semibold text-white mb-1 truncate">${album.album}</h3>
          <p class="text-sm text-gray-400 mb-4 truncate">${album.artist}</p>
          
          <button data-action="edit"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-edit mr-3 text-gray-400"></i>Edit Details
          </button>

          <!-- Expandable Play Section -->
          <div class="play-section">
            <button data-action="play-toggle"
                    class="w-full flex items-center justify-between py-3 px-4 hover:bg-gray-800 rounded-sm ${!hasAnyService ? 'opacity-50' : ''}">
              <span>
                <i class="fas fa-play mr-3 text-gray-400"></i>Play Album
              </span>
              ${showSpotifyConnect ? '<i class="fas fa-chevron-down text-gray-500 text-xs transition-transform duration-200" data-chevron></i>' : ''}
            </button>
            
            <!-- Expandable device list (hidden by default) -->
            <div data-play-options class="hidden overflow-hidden transition-all duration-200 ease-out" style="max-height: 0;">
              <div class="ml-4 border-l-2 border-gray-700 pl-4 py-1">
                <!-- Open in app option -->
                <button data-action="open-app"
                        class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm flex items-center">
                  <i class="fas fa-external-link-alt mr-3 text-green-500 text-sm"></i>
                  <span class="text-sm">Open in ${primaryServiceName}</span>
                </button>
                
                ${
                  showSpotifyConnect
                    ? `
                <!-- Spotify Connect devices section -->
                <div class="mt-1 pt-1 border-t border-gray-800">
                  <div class="px-3 py-1.5 text-xs text-gray-500 uppercase tracking-wide">Spotify Connect</div>
                  <div data-device-list>
                    <div class="px-3 py-2 text-sm text-gray-400">
                      <i class="fas fa-spinner fa-spin mr-2"></i>Loading devices...
                    </div>
                  </div>
                </div>
                `
                    : ''
                }
              </div>
            </div>
          </div>

          <button data-action="move"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-arrow-right mr-3 text-gray-400"></i>Move to List...
          </button>

          <button data-action="copy"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-copy mr-3 text-gray-400"></i>Copy to List...
          </button>

          ${
            showRecommend
              ? `
          <button data-action="recommend"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-thumbs-up mr-3 text-blue-400"></i>Recommend
          </button>
          `
              : ''
          }

          ${
            hasLastfm
              ? `
          <!-- Last.fm Discovery Options -->
          <div class="border-t border-gray-700 my-2"></div>
          <button data-action="similar-artists"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-users mr-3 text-purple-400"></i>Show Similar Artists
          </button>
          <div class="border-t border-gray-700 my-2"></div>
          `
              : ''
          }

          <button data-action="remove"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm text-red-500">
            <i class="fas fa-trash mr-3"></i>Remove from List
          </button>
          
          <button data-action="cancel"
                  class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
            Cancel
          </button>`,
    });

    // Attach event listeners
    const editBtn = actionSheet.querySelector('[data-action="edit"]');
    const playToggleBtn = actionSheet.querySelector(
      '[data-action="play-toggle"]'
    );
    const playOptions = actionSheet.querySelector('[data-play-options]');
    const chevron = actionSheet.querySelector('[data-chevron]');
    const openAppBtn = actionSheet.querySelector('[data-action="open-app"]');
    const deviceList = actionSheet.querySelector('[data-device-list]');
    const moveBtn = actionSheet.querySelector('[data-action="move"]');
    const removeBtn = actionSheet.querySelector('[data-action="remove"]');

    let isPlayExpanded = false;
    let devicesLoaded = false;

    // Toggle play options expansion
    const togglePlayOptions = async () => {
      if (!hasAnyService) {
        showToast('No music service connected', 'error');
        return;
      }

      // If no Spotify (only Tidal), just play directly
      if (!hasSpotify) {
        close();
        onPlayAlbum(albumId);
        return;
      }

      isPlayExpanded = !isPlayExpanded;

      if (isPlayExpanded) {
        playOptions.classList.remove('hidden');
        void playOptions.offsetHeight;
        playOptions.style.maxHeight = playOptions.scrollHeight + 'px';
        if (chevron) chevron.style.transform = 'rotate(180deg)';

        if (!devicesLoaded && hasSpotify) {
          await loadMobileDevices();
        }
      } else {
        playOptions.style.maxHeight = '0';
        if (chevron) chevron.style.transform = 'rotate(0deg)';
        setTimeout(() => {
          if (!isPlayExpanded) playOptions.classList.add('hidden');
        }, 200);
      }
    };

    // Load Spotify devices for mobile
    const loadMobileDevices = async () => {
      const devices = await fetchSpotifyDevices();

      if (devices.length > 0) {
        const deviceItems = devices
          .map((device) => {
            const icon = getDeviceIcon(device.type);
            const activeClass = device.is_active
              ? 'text-green-500'
              : 'text-gray-400';
            const activeBadge = device.is_active
              ? '<span class="ml-auto text-xs text-green-500">(active)</span>'
              : '';
            return `
                <button data-action="play-device" data-device-id="${device.id}"
                        class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm flex items-center">
                  <i class="${icon} mr-3 ${activeClass} text-sm"></i>
                  <span class="text-sm truncate">${device.name}</span>
                  ${activeBadge}
                </button>
              `;
          })
          .join('');
        deviceList.innerHTML = deviceItems;

        // Attach device click handlers
        deviceList
          .querySelectorAll('[data-action="play-device"]')
          .forEach((btn) => {
            btn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              const deviceId = btn.dataset.deviceId;
              close();
              playAlbumOnDeviceMobile(albumId, deviceId);
            });
          });

        playOptions.style.maxHeight = playOptions.scrollHeight + 'px';
      } else {
        deviceList.innerHTML = `
            <div class="px-3 py-2 text-sm text-gray-500">No devices found</div>
            <div class="px-3 py-1 text-xs text-gray-600">Open Spotify on a device</div>
          `;
        playOptions.style.maxHeight = playOptions.scrollHeight + 'px';
      }
      devicesLoaded = true;
    };

    editBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
      onEditAlbum(albumId);
    });

    playToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePlayOptions();
    });

    if (openAppBtn) {
      openAppBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
        onPlayAlbum(albumId);
      });
    }

    moveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
      showMobileMoveToListSheet(index, albumId);
    });

    const copyBtn = actionSheet.querySelector('[data-action="copy"]');
    copyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
      showMobileCopyToListSheet(index, albumId);
    });

    // Recommend option handler
    const recommendBtn = actionSheet.querySelector('[data-action="recommend"]');

    if (recommendBtn) {
      recommendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
        const year = getListMetadata(getCurrentList())?.year;
        if (year && recommendAlbum) {
          recommendAlbum(album, year);
        }
      });
    }

    // Last.fm discovery option handlers
    const similarArtistsBtn = actionSheet.querySelector(
      '[data-action="similar-artists"]'
    );

    if (similarArtistsBtn) {
      similarArtistsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
        if (showDiscoveryModal && album.artist) {
          showDiscoveryModal('similar', {
            artist: album.artist,
            albumId: album.album_id || null,
          });
        } else if (!album.artist) {
          showToast('Could not find album artist', 'error');
        }
      });
    }

    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
      onRemoveAlbum(albumId);
    });
  }

  /**
   * Group lists by year for the move submenu (matches desktop logic)
   * @returns {Object} { listsByYear, sortedYears, listsWithoutYear }
   */
  function groupListsForMove() {
    const currentListId = getCurrentList();
    const lists = getLists();
    const listsByYear = {};
    const listsWithoutYear = [];

    Object.keys(lists).forEach((listId) => {
      // Skip current list
      if (listId === currentListId) return;

      const meta = lists[listId];
      const listName = meta?.name || 'Unknown';
      const year = meta?.year;

      if (year) {
        if (!listsByYear[year]) {
          listsByYear[year] = [];
        }
        listsByYear[year].push({ id: listId, name: listName });
      } else {
        listsWithoutYear.push({ id: listId, name: listName });
      }
    });

    // Sort years descending (newest first)
    const sortedYears = Object.keys(listsByYear).sort(
      (a, b) => parseInt(b) - parseInt(a)
    );

    return { listsByYear, sortedYears, listsWithoutYear };
  }

  /**
   * Show a mobile list selection sheet with year-based accordion grouping.
   * Shared by both move and copy flows.
   * @param {Object} options - Sheet options
   * @param {string} options.title - Sheet title (e.g. "Move to List", "Copy to List")
   * @param {number} options.index - Album index
   * @param {string} options.albumId - Album identity string
   * @param {Function} options.onSelect - Callback when a target list is selected: (albumId, targetListId) => void
   */
  function showMobileListSelectionSheet({ title, index, albumId, onSelect }) {
    const currentList = getCurrentList();

    // Validate index
    const albumsForSheet = getListData(currentList);
    if (
      isNaN(index) ||
      index < 0 ||
      !albumsForSheet ||
      index >= albumsForSheet.length
    ) {
      console.error('Invalid album index:', index);
      return;
    }

    const album = albumsForSheet[index];

    // Group lists by year
    const { listsByYear, sortedYears, listsWithoutYear } = groupListsForMove();
    const hasAnyLists = sortedYears.length > 0 || listsWithoutYear.length > 0;

    let actionSheet, close;

    if (!hasAnyLists) {
      ({ sheet: actionSheet, close } = createActionSheet({
        contentHtml: `
            <h3 class="font-semibold text-white mb-1">${title}</h3>
            <p class="text-sm text-gray-400 mb-4">${album.album} by ${album.artist}</p>
            
            <div class="py-8 text-center text-gray-500">
              No other lists available
            </div>
            
            <button data-action="cancel"
                    class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
              Cancel
            </button>`,
        hideFAB: false,
        restoreFAB: false,
      }));
    } else {
      // Build year accordion sections
      const yearSections = sortedYears
        .map(
          (year, idx) => `
          <div class="year-section" data-year="${year}">
            <button data-action="toggle-year" data-year="${year}"
                    class="w-full flex items-center justify-between py-3 px-4 hover:bg-gray-800 rounded-sm">
              <span class="font-medium text-white">${year}</span>
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-500">${listsByYear[year].length} list${listsByYear[year].length !== 1 ? 's' : ''}</span>
                <i class="fas fa-chevron-down text-gray-500 text-xs transition-transform duration-200" data-year-chevron="${year}"></i>
              </div>
            </button>
            <div data-year-lists="${year}" class="${idx === 0 ? '' : 'hidden'} overflow-hidden transition-all duration-200 ease-out" style="${idx === 0 ? '' : 'max-height: 0;'}">
              <div class="ml-4 border-l-2 border-gray-700 pl-2">
                ${listsByYear[year]
                  .map(
                    (list) => `
                  <button data-target-list="${list.id}"
                          class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm text-gray-300">
                    ${list.name}
                  </button>
                `
                  )
                  .join('')}
              </div>
            </div>
          </div>
        `
        )
        .join('');

      // Build "Other" section for lists without year
      const otherSection =
        listsWithoutYear.length > 0
          ? `
          <div class="year-section" data-year="other">
            <button data-action="toggle-year" data-year="other"
                    class="w-full flex items-center justify-between py-3 px-4 hover:bg-gray-800 rounded-sm">
              <span class="font-medium text-white">Other</span>
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-500">${listsWithoutYear.length} list${listsWithoutYear.length !== 1 ? 's' : ''}</span>
                <i class="fas fa-chevron-down text-gray-500 text-xs transition-transform duration-200" data-year-chevron="other"></i>
              </div>
            </button>
            <div data-year-lists="other" class="hidden overflow-hidden transition-all duration-200 ease-out" style="max-height: 0;">
              <div class="ml-4 border-l-2 border-gray-700 pl-2">
                ${listsWithoutYear
                  .map(
                    (list) => `
                  <button data-target-list="${list.id}"
                          class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm text-gray-300">
                    ${list.name}
                  </button>
                `
                  )
                  .join('')}
              </div>
            </div>
          </div>
        `
          : '';

      ({ sheet: actionSheet, close } = createActionSheet({
        contentHtml: `
            <h3 class="font-semibold text-white mb-1">${title}</h3>
            <p class="text-sm text-gray-400 mb-4 truncate">${album.album} by ${album.artist}</p>
            
            ${yearSections}
            ${otherSection}
            
            <button data-action="cancel"
                    class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
              Cancel
            </button>`,
        panelClasses: 'max-h-[80vh] overflow-y-auto',
        hideFAB: false,
        restoreFAB: false,
      }));
    }

    // Track expanded state for each year
    const expandedYears = new Set();
    // First year is expanded by default (if any years exist)
    if (sortedYears.length > 0) {
      expandedYears.add(sortedYears[0]);
      // Rotate chevron for first year since it's expanded
      const firstChevron = actionSheet.querySelector(
        `[data-year-chevron="${sortedYears[0]}"]`
      );
      if (firstChevron) {
        firstChevron.style.transform = 'rotate(180deg)';
      }
    }

    // Attach toggle handlers to year headers
    actionSheet
      .querySelectorAll('[data-action="toggle-year"]')
      .forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const year = btn.dataset.year;
          const listContainer = actionSheet.querySelector(
            `[data-year-lists="${year}"]`
          );
          const chevron = actionSheet.querySelector(
            `[data-year-chevron="${year}"]`
          );

          if (!listContainer) return;

          const isExpanded = expandedYears.has(year);

          if (isExpanded) {
            // Collapse
            listContainer.style.maxHeight = '0';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
            setTimeout(() => {
              listContainer.classList.add('hidden');
            }, 200);
            expandedYears.delete(year);
          } else {
            // Expand
            listContainer.classList.remove('hidden');
            void listContainer.offsetHeight; // Force reflow
            listContainer.style.maxHeight = listContainer.scrollHeight + 'px';
            if (chevron) chevron.style.transform = 'rotate(180deg)';
            expandedYears.add(year);
          }
        });
      });

    // Attach click handlers to list buttons
    actionSheet.querySelectorAll('[data-target-list]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetList = btn.dataset.targetList;
        close();
        onSelect(albumId, targetList);
      });
    });
  }

  /**
   * Show mobile sheet to select target list for moving album
   * @param {number} index - Album index
   * @param {string} albumId - Album identity string
   */
  function showMobileMoveToListSheet(index, albumId) {
    showMobileListSelectionSheet({
      title: 'Move to List',
      index,
      albumId,
      onSelect: showMoveConfirmation,
    });
  }

  /**
   * Show mobile sheet to select target list for copying album
   * @param {number} index - Album index
   * @param {string} albumId - Album identity string
   */
  function showMobileCopyToListSheet(index, albumId) {
    showMobileListSelectionSheet({
      title: 'Copy to List',
      index,
      albumId,
      onSelect: showCopyConfirmation,
    });
  }

  return {
    showMobileAlbumMenu,
    showMobileMoveToListSheet,
    showMobileCopyToListSheet,
  };
}
