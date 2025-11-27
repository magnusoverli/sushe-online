/**
 * Spotify Web Playback SDK Integration
 * Provides an embedded miniplayer in the desktop sidebar
 */

import { showToast } from './utils.js';

// Module state
let player = null;
let deviceId = null;
let currentState = null;
let progressInterval = null;
let isReady = false;

// DOM Elements (cached on init)
let elements = {};

/**
 * Format milliseconds to MM:SS
 */
function formatTime(ms) {
  if (!ms || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Cache DOM elements for the miniplayer
 */
function cacheElements() {
  elements = {
    container: document.getElementById('spotifyMiniplayer'),
    notConnected: document.getElementById('miniplayerNotConnected'),
    premiumRequired: document.getElementById('miniplayerPremiumRequired'),
    inactive: document.getElementById('miniplayerInactive'),
    active: document.getElementById('miniplayerActive'),
    activateBtn: document.getElementById('miniplayerActivate'),
    art: document.getElementById('miniplayerArt'),
    artImg: document.querySelector('#miniplayerArt img'),
    track: document.getElementById('miniplayerTrack'),
    artist: document.getElementById('miniplayerArtist'),
    progress: document.getElementById('miniplayerProgress'),
    progressFill: document.getElementById('miniplayerProgressFill'),
    progressHandle: document.getElementById('miniplayerProgressHandle'),
    timeElapsed: document.getElementById('miniplayerTimeElapsed'),
    timeTotal: document.getElementById('miniplayerTimeTotal'),
    prevBtn: document.getElementById('miniplayerPrev'),
    playPauseBtn: document.getElementById('miniplayerPlayPause'),
    nextBtn: document.getElementById('miniplayerNext'),
    muteBtn: document.getElementById('miniplayerMute'),
    volumeSlider: document.getElementById('miniplayerVolume'),
  };
}

/**
 * Show a specific state view in the miniplayer
 */
function showState(state) {
  if (!elements.container) return;

  // Hide all states
  elements.notConnected?.classList.add('hidden');
  elements.premiumRequired?.classList.add('hidden');
  elements.inactive?.classList.add('hidden');
  elements.active?.classList.add('hidden');

  // Show requested state
  switch (state) {
    case 'not-connected':
      elements.notConnected?.classList.remove('hidden');
      break;
    case 'premium-required':
      elements.premiumRequired?.classList.remove('hidden');
      break;
    case 'inactive':
      elements.inactive?.classList.remove('hidden');
      break;
    case 'active':
      elements.active?.classList.remove('hidden');
      break;
  }
}

/**
 * Update the progress bar UI
 */
function updateProgress(position, duration) {
  if (!elements.progressFill || !duration) return;

  const percent = Math.min((position / duration) * 100, 100);
  elements.progressFill.style.width = `${percent}%`;
  elements.progressHandle.style.left = `${percent}%`;
  elements.timeElapsed.textContent = formatTime(position);
  elements.timeTotal.textContent = formatTime(duration);
}

/**
 * Update the play/pause button icon
 */
function updatePlayPauseIcon(isPaused) {
  if (!elements.playPauseBtn) return;
  const icon = elements.playPauseBtn.querySelector('i');
  if (icon) {
    icon.className = isPaused ? 'fas fa-play text-sm' : 'fas fa-pause text-sm';
  }
}

/**
 * Update the volume icon based on level
 */
function updateVolumeIcon(volume) {
  if (!elements.muteBtn) return;
  const icon = elements.muteBtn.querySelector('i');
  if (icon) {
    if (volume === 0) {
      icon.className = 'fas fa-volume-mute text-sm';
    } else if (volume < 0.5) {
      icon.className = 'fas fa-volume-down text-sm';
    } else {
      icon.className = 'fas fa-volume-up text-sm';
    }
  }
}

/**
 * Update the UI with current track info
 */
function updateTrackInfo(state) {
  if (!state?.track_window?.current_track) {
    elements.track.textContent = 'No track';
    elements.artist.textContent = '—';
    if (elements.artImg) {
      elements.artImg.classList.add('hidden');
      elements.artImg.src = '';
    }
    return;
  }

  const track = state.track_window.current_track;
  elements.track.textContent = track.name || 'Unknown';
  elements.artist.textContent =
    track.artists?.map((a) => a.name).join(', ') || 'Unknown Artist';

  // Update album art
  const albumImage = track.album?.images?.[0]?.url;
  if (albumImage && elements.artImg) {
    elements.artImg.src = albumImage;
    elements.artImg.classList.remove('hidden');
  } else if (elements.artImg) {
    elements.artImg.classList.add('hidden');
  }
}

/**
 * Start progress interpolation (runs while playing)
 */
function startProgressInterpolation() {
  stopProgressInterpolation();

  let lastUpdate = Date.now();
  let position = currentState?.position || 0;

  progressInterval = setInterval(() => {
    if (!currentState || currentState.paused) return;

    const now = Date.now();
    const delta = now - lastUpdate;
    lastUpdate = now;
    position += delta;

    updateProgress(position, currentState.duration);
  }, 100);
}

/**
 * Stop progress interpolation
 */
function stopProgressInterpolation() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
}

/**
 * Handle player state changes from SDK
 */
function handleStateChange(state) {
  currentState = state;

  if (!state) {
    // Playback transferred away from this device
    showState('inactive');
    stopProgressInterpolation();
    return;
  }

  showState('active');
  updateTrackInfo(state);
  updateProgress(state.position, state.duration);
  updatePlayPauseIcon(state.paused);

  if (state.paused) {
    stopProgressInterpolation();
  } else {
    startProgressInterpolation();
  }
}

/**
 * Set up event listeners for miniplayer controls
 */
function setupControls() {
  // Activate button (transfer playback to this device)
  elements.activateBtn?.addEventListener('click', async () => {
    if (!deviceId) return;

    try {
      const token = window.currentUser?.spotifyAuth?.access_token;
      if (!token) return;

      const response = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: false,
        }),
      });

      if (response.ok || response.status === 204) {
        showToast('Playback transferred to SuShe', 'success');
      }
    } catch (err) {
      console.error('Failed to transfer playback:', err);
      showToast('Failed to transfer playback', 'error');
    }
  });

  // Play/Pause
  elements.playPauseBtn?.addEventListener('click', () => {
    player?.togglePlay();
  });

  // Previous track
  elements.prevBtn?.addEventListener('click', () => {
    player?.previousTrack();
  });

  // Next track
  elements.nextBtn?.addEventListener('click', () => {
    player?.nextTrack();
  });

  // Progress bar seeking
  let isSeeking = false;

  elements.progress?.addEventListener('mousedown', (e) => {
    isSeeking = true;
    handleSeek(e);
  });

  document.addEventListener('mousemove', (e) => {
    if (isSeeking) handleSeek(e);
  });

  document.addEventListener('mouseup', () => {
    isSeeking = false;
  });

  function handleSeek(e) {
    if (!elements.progress || !currentState?.duration) return;

    const rect = elements.progress.getBoundingClientRect();
    const percent = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width)
    );
    const position = Math.floor(percent * currentState.duration);

    updateProgress(position, currentState.duration);

    if (!isSeeking || e.type === 'mouseup') {
      player?.seek(position);
    }
  }

  // Volume control
  let lastVolume = 0.5;

  elements.volumeSlider?.addEventListener('input', (e) => {
    const volume = parseInt(e.target.value, 10) / 100;
    player?.setVolume(volume);
    updateVolumeIcon(volume);
    if (volume > 0) lastVolume = volume;
  });

  // Mute toggle
  elements.muteBtn?.addEventListener('click', async () => {
    if (!player) return;

    const currentVolume = await player.getVolume();
    if (currentVolume > 0) {
      lastVolume = currentVolume;
      player.setVolume(0);
      elements.volumeSlider.value = 0;
      updateVolumeIcon(0);
    } else {
      player.setVolume(lastVolume);
      elements.volumeSlider.value = lastVolume * 100;
      updateVolumeIcon(lastVolume);
    }
  });
}

/**
 * Initialize the Spotify Web Playback SDK
 */
function initializePlayer() {
  const token = window.currentUser?.spotifyAuth?.access_token;
  if (!token) {
    console.log('Spotify miniplayer: No access token available');
    showState('not-connected');
    return;
  }

  // Create the player instance
  player = new window.Spotify.Player({
    name: 'SuShe Online',
    getOAuthToken: (cb) => {
      // Always get the latest token
      const currentToken = window.currentUser?.spotifyAuth?.access_token;
      cb(currentToken);
    },
    volume: 0.5,
  });

  // Error handling
  player.addListener('initialization_error', ({ message }) => {
    console.error('Spotify init error:', message);
    showState('not-connected');
  });

  player.addListener('authentication_error', ({ message }) => {
    console.error('Spotify auth error:', message);
    showState('not-connected');
  });

  player.addListener('account_error', ({ message }) => {
    console.error('Spotify account error:', message);
    showState('premium-required');
  });

  player.addListener('playback_error', ({ message }) => {
    console.error('Spotify playback error:', message);
  });

  // Ready
  player.addListener('ready', ({ device_id }) => {
    console.log('Spotify player ready, device ID:', device_id);
    deviceId = device_id;
    isReady = true;
    showState('inactive');
  });

  // Not ready
  player.addListener('not_ready', ({ device_id }) => {
    console.log('Spotify player not ready:', device_id);
    isReady = false;
    showState('inactive');
  });

  // State changes
  player.addListener('player_state_changed', handleStateChange);

  // Connect
  player.connect().then((success) => {
    if (success) {
      console.log('Spotify player connected successfully');
    } else {
      console.error('Spotify player failed to connect');
      showState('not-connected');
    }
  });
}

/**
 * Initialize the miniplayer module
 */
export function initMiniplayer() {
  // Only initialize on desktop
  if (window.innerWidth < 1024) {
    return;
  }

  cacheElements();

  if (!elements.container) {
    console.log('Spotify miniplayer: Container not found');
    return;
  }

  // Show the miniplayer container
  elements.container.classList.remove('hidden');

  // Check if user has Spotify connected
  if (!window.currentUser?.spotifyAuth) {
    showState('not-connected');
    return;
  }

  // Set up control event listeners
  setupControls();

  // Wait for SDK to load, then initialize
  if (window.Spotify) {
    initializePlayer();
  } else {
    window.onSpotifyWebPlaybackSDKReady = () => {
      initializePlayer();
    };
  }
}

/**
 * Clean up the player when navigating away
 */
export function destroyMiniplayer() {
  stopProgressInterpolation();
  if (player) {
    player.disconnect();
    player = null;
  }
  deviceId = null;
  currentState = null;
  isReady = false;
}

// Export player instance for external access
export function getPlayer() {
  return player;
}

export function getDeviceId() {
  return deviceId;
}

export function isPlayerReady() {
  return isReady;
}
