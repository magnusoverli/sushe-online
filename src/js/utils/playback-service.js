/**
 * Music playback service utilities.
 * Handles opening albums/tracks in music apps, fetching Spotify Connect
 * devices, and playing on a specific device.
 */

const APP_FALLBACK_DELAY_MS = 1200;
const SPOTIFY_APP_FALLBACK_DELAY_MS = 2500;

function openNativeAppWithFallback(
  appUrl,
  webUrl,
  fallbackDelayMs = APP_FALLBACK_DELAY_MS
) {
  const hasDocument = typeof document !== 'undefined';
  const hasWindowEvents = typeof window?.addEventListener === 'function';
  const hasFocusApi = hasDocument && typeof document.hasFocus === 'function';

  if (!hasDocument || !hasWindowEvents) {
    window.location.href = appUrl;
    return;
  }

  let appLikelyOpened = false;

  const markOpened = () => {
    appLikelyOpened = true;
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      markOpened();
    }
  };

  const cleanup = () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('blur', markOpened);
    window.removeEventListener('pagehide', markOpened);
    if (focusProbe !== null) {
      clearInterval(focusProbe);
    }
  };

  const shouldFallbackToWeb = () => {
    if (appLikelyOpened) {
      return false;
    }

    if (document.visibilityState === 'hidden') {
      return false;
    }

    if (hasFocusApi && !document.hasFocus()) {
      return false;
    }

    return true;
  };

  const focusProbe = hasFocusApi
    ? setInterval(() => {
        if (!document.hasFocus()) {
          markOpened();
        }
      }, 100)
    : null;

  const fallbackTimer = setTimeout(() => {
    if (shouldFallbackToWeb()) {
      window.location.href = webUrl;
    }
    cleanup();
  }, fallbackDelayMs);

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('blur', markOpened);
  window.addEventListener('pagehide', markOpened);

  try {
    window.location.href = appUrl;
  } catch (_err) {
    clearTimeout(fallbackTimer);
    cleanup();
    window.location.href = webUrl;
  }
}

function openSpotifyAppWithFallback(type, id) {
  openNativeAppWithFallback(
    `spotify:${type}:${id}`,
    `https://open.spotify.com/${type}/${encodeURIComponent(id)}`,
    SPOTIFY_APP_FALLBACK_DELAY_MS
  );
}

function openTidalAppWithFallback(type, id) {
  openNativeAppWithFallback(
    `tidal://${type}/${encodeURIComponent(id)}`,
    `https://listen.tidal.com/${type}/${encodeURIComponent(id)}`
  );
}

/**
 * Open an album or track in the user's connected music service.
 *
 * @param {string} service - 'spotify' or 'tidal'
 * @param {'album'|'track'} type - Whether to open an album or track
 * @param {Object} params - Search parameters
 * @param {string} params.artist - Artist name
 * @param {string} params.album - Album name
 * @param {string} [params.albumId] - Canonical SuShe album ID
 * @param {string} [params.releaseDate] - Album release date
 * @param {string} [params.track] - Track name (required when type is 'track')
 * @param {Function} showToast - Function to show toast notifications
 * @returns {Promise<void>}
 */
export async function openInMusicApp(service, type, params, showToast) {
  const queryParts = [
    `artist=${encodeURIComponent(params.artist)}`,
    `album=${encodeURIComponent(params.album)}`,
  ];
  if (params.albumId) {
    queryParts.push(`albumId=${encodeURIComponent(params.albumId)}`);
  }
  if (params.releaseDate) {
    queryParts.push(`releaseDate=${encodeURIComponent(params.releaseDate)}`);
  }
  if (type === 'track' && params.track) {
    queryParts.push(`track=${encodeURIComponent(params.track)}`);
  }
  const query = queryParts.join('&');

  const endpoint =
    service === 'spotify' ? `/api/spotify/${type}` : `/api/tidal/${type}`;

  try {
    const r = await fetch(`${endpoint}?${query}`, { credentials: 'include' });
    let data;
    try {
      data = await r.json();
    } catch (_e) {
      throw new Error('Invalid response', { cause: _e });
    }

    if (!r.ok) {
      throw new Error(data.error || 'Request failed');
    }

    if (data.id) {
      if (service === 'spotify') {
        openSpotifyAppWithFallback(type, data.id);
      } else {
        openTidalAppWithFallback(type, data.id);
      }
    } else if (data.error) {
      showToast(data.error, 'error');
    } else {
      const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
      showToast(`${typeLabel} not found on ${service}`, 'error');
    }
  } catch (err) {
    console.error(`Play ${type} error:`, err);
    showToast(err.message || `Failed to open ${type}`, 'error');
  }
}

/**
 * Fetch the list of available Spotify Connect devices.
 *
 * @returns {Promise<Array>} Array of device objects, or empty array on error.
 */
export async function fetchSpotifyDevices() {
  try {
    const response = await fetch('/api/spotify/devices', {
      credentials: 'include',
    });
    const data = await response.json();
    if (response.ok && data.devices && data.devices.length > 0) {
      return data.devices;
    }
    return [];
  } catch (err) {
    console.error('Failed to fetch Spotify devices:', err);
    return [];
  }
}

/**
 * Play an album on a specific Spotify Connect device.
 *
 * @param {Object} album - Album object with artist and album fields
 * @param {string} deviceId - Spotify Connect device ID
 * @param {Function} showToast - Function to show toast notifications
 * @returns {Promise<void>}
 */
export async function playOnSpotifyDevice(album, deviceId, showToast) {
  showToast('Starting playback...', 'info');

  try {
    // First, search for the album on Spotify to get the ID
    const searchParams = new URLSearchParams({
      artist: album.artist,
      album: album.album,
    });
    if (album.album_id) {
      searchParams.set('albumId', album.album_id);
    }
    if (album.release_date) {
      searchParams.set('releaseDate', album.release_date);
    }

    const searchQuery = searchParams.toString();
    const searchResp = await fetch(`/api/spotify/album?${searchQuery}`, {
      credentials: 'include',
    });
    const searchData = await searchResp.json();

    if (!searchResp.ok || !searchData.id) {
      showToast(searchData.error || 'Album not found on Spotify', 'error');
      return;
    }

    // Now play the album on the device
    const playResp = await fetch('/api/spotify/play', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        albumId: searchData.id,
        deviceId: deviceId,
      }),
    });

    const playData = await playResp.json();

    if (playResp.ok && playData.success) {
      showToast(`Now playing "${album.album}"`, 'success');
    } else {
      showToast(playData.error || 'Failed to start playback', 'error');
    }
  } catch (err) {
    console.error('Spotify Connect playback error:', err);
    showToast('Failed to start playback', 'error');
  }
}
