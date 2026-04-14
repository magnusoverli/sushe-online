import { buildAlbumActionMenuHtml } from './album-actions-menu-template.js';
import { createMobileListSelectionActions } from './album-actions-list-selection.js';
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
      contentHtml: buildAlbumActionMenuHtml({
        album,
        hasAnyService,
        showSpotifyConnect,
        primaryServiceName,
        showRecommend,
        hasLastfm,
      }),
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

  const { showMobileMoveToListSheet, showMobileCopyToListSheet } =
    createMobileListSelectionActions({
      createActionSheet,
      getCurrentList,
      getListData,
      getLists,
      showMoveConfirmation,
      showCopyConfirmation,
    });

  return {
    showMobileAlbumMenu,
    showMobileMoveToListSheet,
    showMobileCopyToListSheet,
  };
}
