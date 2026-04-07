/**
 * Music service chooser utility.
 * Resolves which music service (Spotify/Tidal/Qobuz) to use based on
 * user preferences and connected services.
 */

/**
 * Choose which music service to use for playback.
 * Resolves user preference, connected services, and shows a picker if both are available.
 *
 * @param {Function} showServicePicker - Function to show service picker UI
 * @param {Function} showToast - Function to show toast notifications
 * @returns {Promise<'spotify'|'tidal'|'qobuz'|null>} The chosen service, or null if none available
 */
export function chooseService(showServicePicker, showToast) {
  const user = window.currentUser;
  if (!user) {
    return Promise.resolve(null);
  }

  const hasSpotify = user.spotifyAuth;
  const hasTidal = user.tidalAuth;
  const preferred = user.musicService;
  const hasQobuz = true;

  const pickerServices = {
    spotify: !!hasSpotify,
    tidal: !!hasTidal,
    qobuz: hasQobuz,
  };

  if (preferred === 'spotify' && hasSpotify) {
    return Promise.resolve('spotify');
  }
  if (preferred === 'tidal' && hasTidal) {
    return Promise.resolve('tidal');
  }
  if (preferred === 'qobuz' && hasQobuz) {
    return Promise.resolve('qobuz');
  }
  if (hasSpotify && hasTidal) {
    return showServicePicker(pickerServices);
  } else if (hasSpotify) {
    return Promise.resolve('spotify');
  } else if (hasTidal) {
    return Promise.resolve('tidal');
  } else if (hasQobuz) {
    return showServicePicker(pickerServices);
  } else {
    showToast('No music service connected', 'error');
    return Promise.resolve(null);
  }
}
