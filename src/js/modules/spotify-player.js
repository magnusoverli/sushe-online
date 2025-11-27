/**
 * Spotify Hybrid Miniplayer
 * Supports both Web Playback SDK (when browser is active device)
 * and Web API polling (when other devices are active)
 */

import { showToast } from './utils.js';

// ============ MODULE STATE ============
let player = null;
let sdkDeviceId = null;
let mode = 'inactive'; // 'inactive' | 'sdk' | 'api'
let _activeDevice = null; // Currently unused but tracked for future enhancements
let currentPlayback = null;
let pollInterval = null;
let progressInterval = null;
let isReady = false;
let lastVolume = 0.5;
let isSeeking = false;
let lastPollTime = 0;
let lastPosition = 0;

// Polling configuration
const POLL_INTERVAL_PLAYING = 1500; // 1.5s when playing
const POLL_INTERVAL_PAUSED = 5000; // 5s when paused
const PROGRESS_UPDATE_INTERVAL = 100; // 100ms for smooth progress bar

// DOM Elements (cached on init)
let elements = {};

// ============ UTILITY FUNCTIONS ============

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
 * Get device icon based on type
 */
function getDeviceIcon(type) {
  const icons = {
    Computer: 'fa-desktop',
    Smartphone: 'fa-mobile-alt',
    Speaker: 'fa-volume-up',
    TV: 'fa-tv',
    CastVideo: 'fa-chromecast',
    CastAudio: 'fa-podcast',
    Automobile: 'fa-car',
    Unknown: 'fa-question-circle',
  };
  return icons[type] || icons.Unknown;
}

// ============ API FUNCTIONS ============

/**
 * Fetch Spotify access token from our API
 */
async function fetchSpotifyToken() {
  try {
    const response = await fetch('/api/spotify/token', {
      credentials: 'same-origin',
    });
    if (!response.ok) {
      console.error('Failed to fetch Spotify token:', response.status);
      const errorText = await response.text();
      console.error('Token error response:', errorText);
      return null;
    }
    const data = await response.json();
    // Debug: log token info (first/last 4 chars only for security)
    if (data.access_token) {
      const token = data.access_token;
      console.log(
        'Spotify token fetched:',
        token.substring(0, 4) + '...' + token.substring(token.length - 4),
        'length:',
        token.length
      );
    }
    return data.access_token;
  } catch (err) {
    console.error('Error fetching Spotify token:', err);
    return null;
  }
}

/**
 * Get current playback state from Spotify API
 */
async function apiGetPlaybackState() {
  try {
    const response = await fetch('/api/spotify/playback', {
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw new Error(`API error ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    console.error('Failed to get playback state:', err);
    return null;
  }
}

/**
 * Get available devices from Spotify API
 */
async function apiGetDevices() {
  try {
    const response = await fetch('/api/spotify/devices', {
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw new Error(`API error ${response.status}`);
    }
    const data = await response.json();
    return data.devices || [];
  } catch (err) {
    console.error('Failed to get devices:', err);
    return [];
  }
}

/**
 * Pause playback via API
 */
async function apiPause() {
  try {
    const response = await fetch('/api/spotify/pause', {
      method: 'PUT',
      credentials: 'same-origin',
    });
    return response.ok;
  } catch (err) {
    console.error('Failed to pause:', err);
    return false;
  }
}

/**
 * Resume playback via API
 */
async function apiResume() {
  try {
    const response = await fetch('/api/spotify/resume', {
      method: 'PUT',
      credentials: 'same-origin',
    });
    return response.ok;
  } catch (err) {
    console.error('Failed to resume:', err);
    return false;
  }
}

/**
 * Skip to next track via API
 */
async function apiNext() {
  try {
    const response = await fetch('/api/spotify/next', {
      method: 'POST',
      credentials: 'same-origin',
    });
    return response.ok;
  } catch (err) {
    console.error('Failed to skip next:', err);
    return false;
  }
}

/**
 * Skip to previous track via API
 */
async function apiPrevious() {
  try {
    const response = await fetch('/api/spotify/previous', {
      method: 'POST',
      credentials: 'same-origin',
    });
    return response.ok;
  } catch (err) {
    console.error('Failed to skip previous:', err);
    return false;
  }
}

/**
 * Seek to position via API
 */
async function apiSeek(positionMs) {
  try {
    const response = await fetch('/api/spotify/seek', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position_ms: positionMs }),
    });
    return response.ok;
  } catch (err) {
    console.error('Failed to seek:', err);
    return false;
  }
}

/**
 * Set volume via API
 */
async function apiSetVolume(percent) {
  try {
    const response = await fetch('/api/spotify/volume', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume_percent: percent }),
    });
    return response.ok;
  } catch (err) {
    console.error('Failed to set volume:', err);
    return false;
  }
}

/**
 * Transfer playback to a device via API
 */
async function apiTransferPlayback(deviceId, play = false) {
  try {
    const response = await fetch('/api/spotify/transfer', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, play }),
    });
    return response.ok;
  } catch (err) {
    console.error('Failed to transfer playback:', err);
    return false;
  }
}

// ============ DOM CACHING ============

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
    loading: document.getElementById('miniplayerLoading'),
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
    deviceBtn: document.getElementById('miniplayerDeviceBtn'),
    deviceDropdown: document.getElementById('miniplayerDeviceDropdown'),
    deviceList: document.getElementById('miniplayerDeviceList'),
    currentDevice: document.getElementById('miniplayerCurrentDevice'),
    deviceName: document.getElementById('miniplayerDeviceName'),
  };
}

// ============ UI STATE MANAGEMENT ============

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
  elements.loading?.classList.add('hidden');

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
    case 'loading':
      elements.loading?.classList.remove('hidden');
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
  if (elements.progressHandle) {
    elements.progressHandle.style.left = `${percent}%`;
  }
  if (elements.timeElapsed) {
    elements.timeElapsed.textContent = formatTime(position);
  }
  if (elements.timeTotal) {
    elements.timeTotal.textContent = formatTime(duration);
  }
}

/**
 * Update the play/pause button icon
 */
function updatePlayPauseIcon(isPlaying) {
  if (!elements.playPauseBtn) return;
  const icon = elements.playPauseBtn.querySelector('i');
  if (icon) {
    icon.className = isPlaying ? 'fas fa-pause text-sm' : 'fas fa-play text-sm';
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
      icon.className = 'fas fa-volume-mute text-xs';
    } else if (volume < 50) {
      icon.className = 'fas fa-volume-down text-xs';
    } else {
      icon.className = 'fas fa-volume-up text-xs';
    }
  }
}

/**
 * Update track info display
 */
function updateTrackInfo(track) {
  if (!track) {
    if (elements.track) elements.track.textContent = 'No track';
    if (elements.artist) elements.artist.textContent = '—';
    if (elements.artImg) {
      elements.artImg.classList.add('hidden');
      elements.artImg.src = '';
    }
    return;
  }

  if (elements.track) {
    elements.track.textContent = track.name || 'Unknown';
  }

  if (elements.artist) {
    const artists =
      track.artists?.map((a) => a.name).join(', ') || 'Unknown Artist';
    elements.artist.textContent = artists;
  }

  // Update album art
  const albumImage =
    track.album?.images?.[0]?.url || track.album?.images?.[1]?.url;
  if (albumImage && elements.artImg) {
    elements.artImg.src = albumImage;
    elements.artImg.classList.remove('hidden');
  } else if (elements.artImg) {
    elements.artImg.classList.add('hidden');
  }
}

/**
 * Update device name display
 */
function updateDeviceName(device) {
  if (!elements.deviceName) return;
  if (device) {
    elements.deviceName.textContent = device.name || 'Unknown Device';
    _activeDevice = device;
  } else {
    elements.deviceName.textContent = 'No device';
    _activeDevice = null;
  }
}

// ============ DEVICE PICKER ============

/**
 * Render the device list dropdown
 */
function renderDeviceList(devices) {
  if (!elements.deviceList) return;

  if (!devices || devices.length === 0) {
    elements.deviceList.innerHTML = `
      <div class="text-center py-4 text-gray-500 text-xs">
        No devices found
      </div>
    `;
    return;
  }

  elements.deviceList.innerHTML = devices
    .map(
      (device) => `
      <button 
        class="device-item w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-700 transition-colors ${device.is_active ? 'bg-gray-700' : ''}"
        data-device-id="${device.id}"
        data-device-name="${device.name}"
      >
        <i class="fas ${getDeviceIcon(device.type)} text-sm ${device.is_active ? 'text-green-500' : 'text-gray-400'}"></i>
        <div class="flex-1 text-left">
          <p class="text-sm text-white truncate">${device.name}</p>
          <p class="text-[10px] text-gray-500">${device.type}${device.volume_percent !== undefined ? ` • ${device.volume_percent}%` : ''}</p>
        </div>
        ${device.is_active ? '<i class="fas fa-broadcast-tower text-green-500 text-xs"></i>' : ''}
      </button>
    `
    )
    .join('');

  // Add click handlers
  elements.deviceList.querySelectorAll('.device-item').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const deviceId = btn.dataset.deviceId;
      const deviceName = btn.dataset.deviceName;

      showState('loading');
      hideDeviceDropdown();

      const success = await apiTransferPlayback(
        deviceId,
        currentPlayback?.is_playing
      );

      if (success) {
        showToast(`Playing on ${deviceName}`, 'success');
        // Refresh playback state after a short delay
        setTimeout(pollPlaybackState, 500);
      } else {
        showToast('Failed to transfer playback', 'error');
        showState(
          mode === 'sdk' ? 'active' : currentPlayback ? 'active' : 'inactive'
        );
      }
    });
  });
}

/**
 * Load and show devices
 */
async function loadDevices() {
  if (!elements.deviceList) return;

  elements.deviceList.innerHTML = `
    <div class="text-center py-4 text-gray-500 text-xs">
      <i class="fas fa-spinner fa-spin mr-1"></i> Loading devices...
    </div>
  `;

  const devices = await apiGetDevices();
  renderDeviceList(devices);
}

/**
 * Toggle device dropdown visibility
 */
function toggleDeviceDropdown() {
  if (!elements.deviceDropdown) return;

  const isHidden = elements.deviceDropdown.classList.contains('hidden');
  if (isHidden) {
    elements.deviceDropdown.classList.remove('hidden');
    loadDevices();
  } else {
    elements.deviceDropdown.classList.add('hidden');
  }
}

/**
 * Hide device dropdown
 */
function hideDeviceDropdown() {
  elements.deviceDropdown?.classList.add('hidden');
}

// ============ PROGRESS INTERPOLATION ============

/**
 * Get interpolated position between polls
 */
function getInterpolatedPosition() {
  if (!currentPlayback?.is_playing) return lastPosition;
  const elapsed = Date.now() - lastPollTime;
  return Math.min(
    lastPosition + elapsed,
    currentPlayback.item?.duration_ms || 0
  );
}

/**
 * Start progress interpolation (runs while playing)
 */
function startProgressInterpolation() {
  stopProgressInterpolation();

  progressInterval = setInterval(() => {
    if (isSeeking) return;

    const position =
      mode === 'sdk' && currentPlayback
        ? currentPlayback.position
        : getInterpolatedPosition();

    const duration =
      currentPlayback?.item?.duration_ms || currentPlayback?.duration || 0;
    updateProgress(position, duration);
  }, PROGRESS_UPDATE_INTERVAL);
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

// ============ API POLLING ============

/**
 * Poll Spotify API for playback state
 */
async function pollPlaybackState() {
  const state = await apiGetPlaybackState();

  if (!state || (!state.device && !state.is_playing)) {
    // No active playback
    currentPlayback = null;
    _activeDevice = null;
    showState('inactive');
    stopProgressInterpolation();
    stopPolling();
    return;
  }

  // Update state
  currentPlayback = state;
  lastPollTime = Date.now();
  lastPosition = state.progress_ms || 0;

  // Check if this browser's SDK is the active device
  if (sdkDeviceId && state.device?.id === sdkDeviceId) {
    // SDK is active, let SDK events handle updates
    if (mode !== 'sdk') {
      mode = 'sdk';
      stopPolling();
    }
    return;
  }

  // API mode - another device is active
  mode = 'api';
  showState('active');

  // Update UI
  updateTrackInfo(state.item);
  updateProgress(state.progress_ms, state.item?.duration_ms);
  updatePlayPauseIcon(state.is_playing);
  updateDeviceName(state.device);

  // Update volume if available
  if (state.device?.volume_percent !== undefined) {
    if (elements.volumeSlider) {
      elements.volumeSlider.value = state.device.volume_percent;
    }
    updateVolumeIcon(state.device.volume_percent);
  }

  // Manage progress interpolation
  if (state.is_playing) {
    startProgressInterpolation();
  } else {
    stopProgressInterpolation();
  }
}

/**
 * Start polling for playback state
 */
function startPolling() {
  stopPolling();

  // Immediate poll
  pollPlaybackState();

  // Set up interval based on playback state
  const interval = currentPlayback?.is_playing
    ? POLL_INTERVAL_PLAYING
    : POLL_INTERVAL_PAUSED;

  pollInterval = setInterval(pollPlaybackState, interval);
}

/**
 * Stop polling
 */
function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ============ HYBRID CONTROL HANDLERS ============

/**
 * Handle play/pause action
 */
async function handlePlayPause() {
  if (mode === 'sdk' && player) {
    player.togglePlay();
  } else {
    const isPlaying = currentPlayback?.is_playing;

    // Optimistic UI update
    updatePlayPauseIcon(!isPlaying);

    const success = isPlaying ? await apiPause() : await apiResume();
    if (!success) {
      // Revert on failure
      updatePlayPauseIcon(isPlaying);
      showToast('Playback control failed', 'error');
    } else {
      // Update local state
      if (currentPlayback) {
        currentPlayback.is_playing = !isPlaying;
      }
    }
  }
}

/**
 * Handle next track action
 */
async function handleNext() {
  if (mode === 'sdk' && player) {
    player.nextTrack();
  } else {
    const success = await apiNext();
    if (success) {
      // Poll for updated state after a short delay
      setTimeout(pollPlaybackState, 300);
    } else {
      showToast('Failed to skip track', 'error');
    }
  }
}

/**
 * Handle previous track action
 */
async function handlePrevious() {
  if (mode === 'sdk' && player) {
    player.previousTrack();
  } else {
    const success = await apiPrevious();
    if (success) {
      setTimeout(pollPlaybackState, 300);
    } else {
      showToast('Failed to skip track', 'error');
    }
  }
}

/**
 * Handle seek action (debounced)
 */
let seekTimeout = null;
async function handleSeek(positionMs) {
  // Optimistic UI update
  lastPosition = positionMs;
  lastPollTime = Date.now();
  updateProgress(
    positionMs,
    currentPlayback?.item?.duration_ms || currentPlayback?.duration || 0
  );

  // Debounce the actual seek
  if (seekTimeout) {
    clearTimeout(seekTimeout);
  }

  seekTimeout = setTimeout(async () => {
    if (mode === 'sdk' && player) {
      player.seek(positionMs);
    } else {
      await apiSeek(positionMs);
    }
    seekTimeout = null;
  }, 150);
}

/**
 * Handle volume change (debounced)
 */
let volumeTimeout = null;
async function handleVolumeChange(percent) {
  // Optimistic UI update
  updateVolumeIcon(percent);
  if (percent > 0) lastVolume = percent / 100;

  // Debounce the actual volume change
  if (volumeTimeout) {
    clearTimeout(volumeTimeout);
  }

  volumeTimeout = setTimeout(async () => {
    if (mode === 'sdk' && player) {
      player.setVolume(percent / 100);
    } else {
      await apiSetVolume(percent);
    }
    volumeTimeout = null;
  }, 100);
}

/**
 * Handle mute toggle
 */
async function handleMuteToggle() {
  const currentVolume = parseInt(elements.volumeSlider?.value || 50);

  if (currentVolume > 0) {
    lastVolume = currentVolume / 100;
    if (elements.volumeSlider) elements.volumeSlider.value = 0;
    handleVolumeChange(0);
  } else {
    const newVolume = Math.round(lastVolume * 100);
    if (elements.volumeSlider) elements.volumeSlider.value = newVolume;
    handleVolumeChange(newVolume);
  }
}

// ============ EVENT HANDLERS ============

/**
 * Set up event listeners for miniplayer controls
 */
function setupControls() {
  // Play/Pause
  elements.playPauseBtn?.addEventListener('click', handlePlayPause);

  // Previous track
  elements.prevBtn?.addEventListener('click', handlePrevious);

  // Next track
  elements.nextBtn?.addEventListener('click', handleNext);

  // Progress bar seeking
  elements.progress?.addEventListener('mousedown', (e) => {
    isSeeking = true;
    updateSeekPosition(e);
  });

  document.addEventListener('mousemove', (e) => {
    if (isSeeking) updateSeekPosition(e);
  });

  document.addEventListener('mouseup', (e) => {
    if (isSeeking) {
      updateSeekPosition(e, true);
      isSeeking = false;
    }
  });

  function updateSeekPosition(e, commit = false) {
    if (!elements.progress) return;

    const rect = elements.progress.getBoundingClientRect();
    const percent = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width)
    );
    const duration =
      currentPlayback?.item?.duration_ms || currentPlayback?.duration || 0;
    const position = Math.floor(percent * duration);

    updateProgress(position, duration);

    if (commit) {
      handleSeek(position);
    }
  }

  // Volume control
  elements.volumeSlider?.addEventListener('input', (e) => {
    handleVolumeChange(parseInt(e.target.value));
  });

  // Mute toggle
  elements.muteBtn?.addEventListener('click', handleMuteToggle);

  // Device picker
  elements.deviceBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDeviceDropdown();
  });

  // Close device dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (
      !elements.deviceDropdown?.contains(e.target) &&
      e.target !== elements.deviceBtn
    ) {
      hideDeviceDropdown();
    }
  });

  // Volume slider show/hide on hover
  const volumeGroup = document.querySelector('.miniplayer-volume-group');
  const volumeSliderContainer = document.querySelector(
    '.miniplayer-volume-slider'
  );

  if (volumeGroup && volumeSliderContainer) {
    volumeGroup.addEventListener('mouseenter', () => {
      volumeSliderContainer.style.width = '64px';
    });
    volumeGroup.addEventListener('mouseleave', () => {
      volumeSliderContainer.style.width = '0';
    });
  }
}

// ============ SDK EVENT HANDLERS ============

/**
 * Handle player state changes from SDK
 */
function handleSDKStateChange(state) {
  if (!state) {
    // Playback transferred away from this device
    if (mode === 'sdk') {
      mode = 'api';
      startPolling();
    }
    return;
  }

  // SDK is now the active device
  mode = 'sdk';
  stopPolling();
  showState('active');

  // Convert SDK state to our format
  currentPlayback = {
    is_playing: !state.paused,
    progress_ms: state.position,
    item: {
      name: state.track_window?.current_track?.name,
      duration_ms: state.duration,
      artists: state.track_window?.current_track?.artists,
      album: state.track_window?.current_track?.album,
    },
    device: {
      id: sdkDeviceId,
      name: 'SuShe Online',
      type: 'Computer',
    },
  };

  lastPollTime = Date.now();
  lastPosition = state.position;

  // Update UI
  updateTrackInfo(currentPlayback.item);
  updateProgress(state.position, state.duration);
  updatePlayPauseIcon(!state.paused);
  updateDeviceName(currentPlayback.device);

  // Manage progress interpolation
  if (!state.paused) {
    startProgressInterpolation();
  } else {
    stopProgressInterpolation();
  }
}

// ============ SDK INITIALIZATION ============

/**
 * Initialize the Spotify Web Playback SDK
 */
async function initializePlayer() {
  const token = await fetchSpotifyToken();
  if (!token) {
    console.log('Spotify miniplayer: No access token available');
    showState('not-connected');
    return;
  }

  // Create the player instance
  player = new window.Spotify.Player({
    name: 'SuShe Online',
    getOAuthToken: async (cb) => {
      const freshToken = await fetchSpotifyToken();
      cb(freshToken);
    },
    volume: 0.5,
  });

  // Error handling
  player.addListener('initialization_error', ({ message }) => {
    console.error('Spotify init error:', message);
    // Fall back to API mode
    showState('inactive');
    startPolling();
  });

  player.addListener('authentication_error', ({ message }) => {
    console.error('Spotify auth error:', message);
    if (!message.includes('Invalid token scopes')) {
      showState('not-connected');
    }
  });

  player.addListener('account_error', ({ message }) => {
    console.error('Spotify account error:', message);
    showState('premium-required');
  });

  player.addListener('playback_error', ({ message }) => {
    if (message !== 'Playback error') {
      console.error('Spotify playback error:', message);
    }
  });

  // Ready
  player.addListener('ready', ({ device_id }) => {
    console.log('Spotify player ready, device ID:', device_id);
    console.log(
      'SDK ready - you can now transfer playback to this device or start playing'
    );
    sdkDeviceId = device_id;
    isReady = true;

    // Start polling to check for active playback on other devices
    startPolling();
  });

  // Autoplay was blocked (browser policy)
  player.addListener('autoplay_failed', () => {
    console.warn(
      'Spotify autoplay failed - user interaction required to start playback'
    );
  });

  // Not ready
  player.addListener('not_ready', ({ device_id }) => {
    console.log('Spotify player not ready:', device_id);
    isReady = false;
  });

  // State changes
  player.addListener('player_state_changed', handleSDKStateChange);

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

// ============ VISIBILITY HANDLING ============

/**
 * Handle visibility changes
 */
function handleVisibilityChange() {
  if (document.hidden) {
    // Tab hidden - stop polling to save resources
    stopPolling();
    stopProgressInterpolation();
  } else if (mode === 'api') {
    // Tab visible and in API mode - resume polling
    startPolling();
  } else if (mode === 'sdk' && currentPlayback?.is_playing) {
    // Tab visible and SDK mode - resume progress interpolation
    startProgressInterpolation();
  }
}

// ============ PUBLIC API ============

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

  // Set up visibility change handler
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Wait for SDK to load, then initialize
  if (window.Spotify && window.spotifySDKReady) {
    initializePlayer();
  } else {
    window.onSpotifyPlayerReady = () => {
      initializePlayer();
    };
  }
}

/**
 * Clean up the player when navigating away
 */
export function destroyMiniplayer() {
  stopPolling();
  stopProgressInterpolation();
  document.removeEventListener('visibilitychange', handleVisibilityChange);

  if (player) {
    player.disconnect();
    player = null;
  }

  sdkDeviceId = null;
  currentPlayback = null;
  mode = 'inactive';
  isReady = false;
}

/**
 * Get the player instance
 */
export function getPlayer() {
  return player;
}

/**
 * Get the SDK device ID
 */
export function getDeviceId() {
  return sdkDeviceId;
}

/**
 * Check if player is ready
 */
export function isPlayerReady() {
  return isReady;
}

/**
 * Get current playback mode
 */
export function getPlaybackMode() {
  return mode;
}
