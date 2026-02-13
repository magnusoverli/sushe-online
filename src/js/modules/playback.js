/**
 * Playback Module
 *
 * Handles album/track playback: play submenu, device selection,
 * Spotify Connect, and play/open actions.
 * Extracted from app.js Phase 7 of separation-of-concerns refactoring.
 *
 * Factory pattern: createPlayback(deps) returns public API.
 */

import { verifyAlbumAtIndex } from '../utils/album-identity.js';
import { chooseService } from '../utils/music-service-chooser.js';
import {
  openInMusicApp,
  playOnSpotifyDevice,
  fetchSpotifyDevices,
} from '../utils/playback-service.js';
import { showToast } from './toast.js';
import { hideConfirmation } from './modals.js';

/**
 * Create the playback module
 * @param {Object} deps - Injected dependencies
 * @returns {Object} Public API
 */
export function createPlayback(deps = {}) {
  const {
    getListData,
    getCurrentListId,
    getContextAlbum,
    getContextAlbumId,
    findAlbumByIdentity,
    playAlbumSafe,
    showServicePicker,
    getDeviceIcon,
  } = deps;

  // ========================================================
  // Play Album Submenu (Spotify Connect devices)
  // ========================================================

  /**
   * Show the play album submenu with device options
   */
  async function showPlayAlbumSubmenu() {
    const submenu = document.getElementById('playAlbumSubmenu');
    const playOption = document.getElementById('playAlbumOption');
    const moveSubmenu = document.getElementById('albumMoveSubmenu');
    const moveOption = document.getElementById('moveAlbumOption');

    if (!submenu || !playOption) return;

    // Hide the other submenu first
    if (moveSubmenu) {
      moveSubmenu.classList.add('hidden');
      moveOption?.classList.remove('bg-gray-700', 'text-white');
    }

    // Highlight the parent menu item
    playOption.classList.add('bg-gray-700', 'text-white');

    const hasSpotify = window.currentUser?.spotifyAuth;
    const hasTidal = window.currentUser?.tidalAuth;
    const musicService = window.currentUser?.musicService;

    // Determine which service to show for "Open in..." based on preference
    // Priority: user preference > only connected service > Spotify (if both)
    let primaryService = null;
    if (musicService === 'tidal' && hasTidal) {
      primaryService = 'tidal';
    } else if (musicService === 'spotify' && hasSpotify) {
      primaryService = 'spotify';
    } else if (hasTidal && !hasSpotify) {
      primaryService = 'tidal';
    } else if (hasSpotify) {
      primaryService = 'spotify';
    }

    // Build menu items
    let menuItems = [];

    // Add "Open in [Service]" option based on user's preference/connected service
    if (primaryService === 'tidal') {
      menuItems.push(`
      <button class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap" data-play-action="open-app">
        <svg class="inline-block w-4 h-4 mr-2 align-text-bottom" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12.012 3.992L8.008 7.996 4.004 3.992 0 7.996 4.004 12l-4.004 4.004L4.004 20.008 8.008 16.004 12.012 20.008 16.016 16.004 12.012 12l4.004-4.004L12.012 3.992zM16.042 7.996l3.979-3.979L24 7.996l-3.979 4.004 3.979 4.004-3.979 3.979-3.979-3.979L12.038 16.008 16.042 12l-4.004-4.004L16.042 7.996z"/>
        </svg>Open in Tidal
      </button>
    `);
    } else if (primaryService === 'spotify') {
      menuItems.push(`
      <button class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap" data-play-action="open-app">
        <svg class="inline-block w-4 h-4 mr-2 text-[#1DB954] align-text-bottom" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
        </svg>Open in Spotify
      </button>
    `);
    }

    // Only show Spotify Connect devices if user's primary service is Spotify
    // (not if they explicitly chose Tidal as their preference)
    if (primaryService === 'spotify' && hasSpotify) {
      menuItems.push(`
      <div class="border-t border-gray-700 my-1"></div>
      <div class="px-4 py-1 text-xs text-gray-500 uppercase tracking-wide">Spotify Connect</div>
    `);

      // Show loading state
      submenu.innerHTML =
        menuItems.join('') +
        '<div class="px-4 py-2 text-sm text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>Loading devices...</div>';
      positionPlaySubmenu();
      submenu.classList.remove('hidden');

      const devices = await fetchSpotifyDevices();

      if (devices.length > 0) {
        const deviceItems = devices.map((device) => {
          const icon = getDeviceIcon(device.type);
          const activeClass = device.is_active ? 'text-green-500' : '';
          const activeBadge = device.is_active
            ? '<span class="ml-2 text-xs text-green-500">(active)</span>'
            : '';
          return `
            <button class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap" data-play-action="spotify-device" data-device-id="${device.id}">
              <i class="${icon} mr-2 w-4 text-center ${activeClass}"></i>${device.name}${activeBadge}
            </button>
          `;
        });
        menuItems = menuItems.concat(deviceItems);
      } else {
        menuItems.push(`
          <div class="px-4 py-2 text-sm text-gray-500">No devices available</div>
          <div class="px-4 py-1 text-xs text-gray-600">Open Spotify on a device</div>
        `);
      }
    }

    // If no services connected
    if (!hasSpotify && !hasTidal) {
      menuItems.push(`
      <div class="px-4 py-2 text-sm text-gray-500">No music service connected</div>
    `);
    }

    submenu.innerHTML = menuItems.join('');

    // Add click handlers
    submenu.querySelectorAll('[data-play-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const action = btn.dataset.playAction;
        const deviceId = btn.dataset.deviceId;

        // Hide menus and remove highlight
        document.getElementById('albumContextMenu')?.classList.add('hidden');
        submenu.classList.add('hidden');
        playOption?.classList.remove('bg-gray-700', 'text-white');

        if (action === 'open-app') {
          // Use existing playAlbum function (opens in app)
          triggerPlayAlbum();
        } else if (action === 'spotify-device') {
          // Play on specific Spotify Connect device
          playAlbumOnSpotifyDevice(deviceId);
        }
      });
    });

    positionPlaySubmenu();
    submenu.classList.remove('hidden');
  }

  /**
   * Position the play submenu next to the play option
   */
  function positionPlaySubmenu() {
    const submenu = document.getElementById('playAlbumSubmenu');
    const playOption = document.getElementById('playAlbumOption');
    const contextMenu = document.getElementById('albumContextMenu');

    if (!submenu || !playOption || !contextMenu) return;

    const playRect = playOption.getBoundingClientRect();
    const menuRect = contextMenu.getBoundingClientRect();

    submenu.style.left = `${menuRect.right}px`;
    submenu.style.top = `${playRect.top}px`;
  }

  // ========================================================
  // Play Album / Track
  // ========================================================

  /**
   * Choose a music service and play content on it.
   * Centralises the chooseService -> hideConfirmation -> openInMusicApp pattern.
   * @param {string} type - Content type ('album' or 'track')
   * @param {Object} params - Params for openInMusicApp (artist, album, track?)
   */
  function playOnService(type, params) {
    chooseService(showServicePicker, showToast).then((service) => {
      hideConfirmation();
      if (!service) return;
      openInMusicApp(service, type, params, showToast);
    });
  }

  /**
   * Trigger the existing play album flow (open in app) using context menu state
   */
  function triggerPlayAlbum() {
    if (getContextAlbum() === null) return;

    const albumsForPlay = getListData(getCurrentListId());
    const result = verifyAlbumAtIndex(
      albumsForPlay,
      getContextAlbum(),
      getContextAlbumId(),
      findAlbumByIdentity
    );
    if (result) {
      playAlbum(result.index);
    } else if (getContextAlbumId()) {
      playAlbumSafe(getContextAlbumId());
    } else {
      showToast('Album not found - it may have been moved or removed', 'error');
    }
  }

  /**
   * Play album on a specific Spotify Connect device
   */
  async function playAlbumOnSpotifyDevice(deviceId) {
    if (getContextAlbum() === null && !getContextAlbumId()) {
      showToast('No album selected', 'error');
      return;
    }

    // Get the album data and verify identity
    const albumsForPlay = getListData(getCurrentListId());
    const verified = verifyAlbumAtIndex(
      albumsForPlay,
      getContextAlbum(),
      getContextAlbumId(),
      findAlbumByIdentity
    );

    if (!verified) {
      showToast('Album not found', 'error');
      return;
    }

    await playOnSpotifyDevice(verified.album, deviceId, showToast);
  }

  /**
   * Play album on a specific Spotify Connect device (mobile version using albumId)
   */
  async function playAlbumOnDeviceMobile(albumId, deviceId) {
    const result = findAlbumByIdentity(albumId);
    if (!result) {
      showToast('Album not found', 'error');
      return;
    }

    await playOnSpotifyDevice(result.album, deviceId, showToast);
  }

  /**
   * Play the selected album on the connected music service
   */
  function playAlbum(index) {
    const albums = getListData(getCurrentListId());
    const album = albums && albums[index];
    if (!album) return;

    playOnService('album', { artist: album.artist, album: album.album });
  }

  /**
   * Play the selected track on the connected music service
   */
  function playTrack(index) {
    const albums = getListData(getCurrentListId());
    const album = albums && albums[index];
    if (!album) return;

    const trackPick = album.track_pick;
    if (!trackPick) {
      showToast('No track selected', 'error');
      return;
    }

    playOnService('track', {
      artist: album.artist,
      album: album.album,
      track: trackPick,
    });
  }

  /**
   * Safe wrapper for play track that uses album identity
   */
  function playTrackSafe(albumId) {
    const result = findAlbumByIdentity(albumId);
    if (!result) {
      showToast('Album not found - it may have been moved or removed', 'error');
      return;
    }
    playTrack(result.index);
  }

  /**
   * Play a specific track by name (for use in edit modal track list)
   */
  function playSpecificTrack(index, trackName) {
    const albums = getListData(getCurrentListId());
    const album = albums && albums[index];
    if (!album) return;

    if (!trackName) {
      showToast('No track specified', 'error');
      return;
    }

    playOnService('track', {
      artist: album.artist,
      album: album.album,
      track: trackName,
    });
  }

  // Public API
  return {
    showPlayAlbumSubmenu,
    positionPlaySubmenu,
    triggerPlayAlbum,
    playAlbumOnSpotifyDevice,
    playAlbumOnDeviceMobile,
    playAlbum,
    playTrack,
    playTrackSafe,
    playSpecificTrack,
  };
}
