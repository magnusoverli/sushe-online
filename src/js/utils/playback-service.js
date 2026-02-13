/**
 * Music playback service utilities.
 * Handles opening albums/tracks in music apps, fetching Spotify Connect
 * devices, and playing on a specific device.
 */

/**
 * Open an album or track in the user's music app (Spotify or Tidal).
 *
 * @param {string} service - 'spotify' or 'tidal'
 * @param {'album'|'track'} type - Whether to open an album or track
 * @param {Object} params - Search parameters
 * @param {string} params.artist - Artist name
 * @param {string} params.album - Album name
 * @param {string} [params.track] - Track name (required when type is 'track')
 * @param {Function} showToast - Function to show toast notifications
 * @returns {Promise<void>}
 */
export async function openInMusicApp(service, type, params, showToast) {
  const queryParts = [
    `artist=${encodeURIComponent(params.artist)}`,
    `album=${encodeURIComponent(params.album)}`,
  ];
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
        window.location.href = `spotify:${type}:${data.id}`;
      } else {
        window.location.href = `tidal://${type}/${data.id}`;
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
    const searchQuery = `artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`;
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
