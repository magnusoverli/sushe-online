/**
 * Music service chooser utility.
 * Resolves which music service (Spotify/Tidal) to use based on
 * user preferences and connected services.
 */

/**
 * Choose which music service to use for playback.
 * Resolves user preference, connected services, and shows a picker if both are available.
 *
 * @param {Function} showServicePicker - Function to show service picker UI (returns Promise<'spotify'|'tidal'>)
 * @param {Function} showToast - Function to show toast notifications
 * @returns {Promise<'spotify'|'tidal'|null>} The chosen service, or null if none available
 */
export function chooseService(showServicePicker, showToast) {
  const hasSpotify = window.currentUser?.spotifyAuth;
  const hasTidal = window.currentUser?.tidalAuth;
  const preferred = window.currentUser?.musicService;

  if (preferred === 'spotify' && hasSpotify) {
    return Promise.resolve('spotify');
  }
  if (preferred === 'tidal' && hasTidal) {
    return Promise.resolve('tidal');
  }
  if (hasSpotify && hasTidal) {
    return showServicePicker(true, true);
  } else if (hasSpotify) {
    return Promise.resolve('spotify');
  } else if (hasTidal) {
    return Promise.resolve('tidal');
  } else {
    showToast('No music service connected', 'error');
    return Promise.resolve(null);
  }
}
