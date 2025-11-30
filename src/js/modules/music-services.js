import { showToast, apiCall } from './utils.js';
import { showConfirmation } from './ui-utils.js';

export async function updatePlaylist(listName, listData = []) {
  try {
    // Validate track selection before proceeding
    const totalAlbums = listData.length;
    const albumsWithTracks = listData.filter(
      (album) => album.track_pick && album.track_pick.trim() !== ''
    ).length;

    // If list has albums but not all have tracks selected, warn the user
    if (totalAlbums > 0 && albumsWithTracks < totalAlbums) {
      const confirmed = await showConfirmation(
        'Incomplete Track Selection',
        `Only ${albumsWithTracks} of ${totalAlbums} albums in your list have tracks selected.`,
        'Only selected tracks will be added to your playlist. Do you want to continue?',
        'Continue Anyway'
      );

      if (!confirmed) {
        return;
      }
    }

    showToast('Checking for existing playlist...', 'info');

    const checkResult = await apiCall(
      `/api/playlists/${encodeURIComponent(listName)}`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'check' }),
      }
    );

    if (checkResult.exists) {
      const confirmed = await showConfirmation(
        'Playlist Exists',
        `A playlist named "${listName}" already exists in your music service. Do you want to replace it with the current list?`,
        'This will replace all tracks in the existing playlist.',
        'Replace Playlist'
      );

      if (!confirmed) {
        return;
      }
    }

    showToast('Updating playlist...', 'info');

    const result = await apiCall(
      `/api/playlists/${encodeURIComponent(listName)}`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'update' }),
      }
    );

    if (result.playlistUrl) {
      showToast(
        `Playlist updated! ${result.successful} tracks added.`,
        'success'
      );
    } else {
      showToast('Playlist updated!', 'success');
    }
  } catch (error) {
    console.error('Error updating playlist:', error);

    // Handle OAuth token expiration - automatically reconnect
    if (
      error.data &&
      (error.data.code === 'TOKEN_EXPIRED' ||
        error.data.code === 'TOKEN_REFRESH_FAILED') &&
      error.data.service
    ) {
      const serviceName =
        error.data.service === 'spotify' ? 'Spotify' : 'Tidal';

      // Show a brief toast before redirecting
      showToast(`Reconnecting to ${serviceName}...`, 'info', 2000);

      // Automatically redirect to reconnect (OAuth flow)
      // Pass the current path so we can return here after reconnecting
      setTimeout(() => {
        const returnTo = encodeURIComponent(window.location.pathname);
        window.location.href = `/auth/${error.data.service}?returnTo=${returnTo}`;
      }, 500);

      return;
    }

    // Handle missing authentication
    if (
      error.data &&
      error.data.code === 'NOT_AUTHENTICATED' &&
      error.data.service
    ) {
      const serviceName =
        error.data.service === 'spotify' ? 'Spotify' : 'Tidal';
      const shouldRedirect = await showConfirmation(
        `${serviceName} Not Connected`,
        `You need to connect your ${serviceName} account to create playlists.`,
        'Would you like to go to Settings now?',
        'Go to Settings'
      );

      if (shouldRedirect) {
        window.location.href = '/settings';
      }
      return;
    }

    // Handle missing service selection
    if (
      error.message &&
      (error.message.includes('NOT_AUTHENTICATED') ||
        error.message.includes('NO_SERVICE'))
    ) {
      const shouldRedirect = await showConfirmation(
        'Music Service Required',
        'No music service selected! Please choose Spotify or Tidal as your preferred service in Settings.',
        'Would you like to go to Settings now?',
        'Go to Settings'
      );

      if (shouldRedirect) {
        window.location.href = '/settings';
      }
      return;
    }

    showToast(
      'Error updating playlist. Please check your music service connection.',
      'error'
    );
  }
}

export function showServicePicker(hasSpotify, hasTidal) {
  const modal = document.getElementById('serviceSelectModal');
  const spotifyBtn = document.getElementById('serviceSpotifyBtn');
  const tidalBtn = document.getElementById('serviceTidalBtn');
  const cancelBtn = document.getElementById('serviceCancelBtn');

  if (!modal || !spotifyBtn || !tidalBtn || !cancelBtn) {
    return Promise.resolve(null);
  }

  spotifyBtn.classList.toggle('hidden', !hasSpotify);
  tidalBtn.classList.toggle('hidden', !hasTidal);

  modal.classList.remove('hidden');

  return new Promise((resolve) => {
    const cleanup = () => {
      modal.classList.add('hidden');
      spotifyBtn.onclick = null;
      tidalBtn.onclick = null;
      cancelBtn.onclick = null;
      modal.onclick = null;
      document.removeEventListener('keydown', escHandler);
    };

    const escHandler = (e) => {
      if (e.key === 'Escape') {
        cleanup();
        resolve(null);
      }
    };

    spotifyBtn.onclick = () => {
      cleanup();
      resolve('spotify');
    };
    tidalBtn.onclick = () => {
      cleanup();
      resolve('tidal');
    };
    cancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };
    modal.onclick = (e) => {
      if (e.target === modal) {
        cleanup();
        resolve(null);
      }
    };

    document.addEventListener('keydown', escHandler);
  });
}
