/**
 * Spotify Miniplayer - API-Only Mode
 * Controls playback on Spotify Connect devices via Web API
 * (No local browser playback - requires Extended Quota Mode)
 */

import { showToast } from './utils.js';

// ============ MODULE STATE ============
let currentPlayback = null;
let pollInterval = null;
let progressInterval = null;
let lastVolume = 50;
let isSeeking = false;
let lastPollTime = 0;
let lastPosition = 0;

// Polling configuration
const POLL_INTERVAL_PLAYING = 1500; // 1.5s when playing
const POLL_INTERVAL_PAUSED = 5000; // 5s when paused
const POLL_INTERVAL_IDLE = 3000; // 3s when no playback
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
  elements.inactive?.classList.add('hidden');
  elements.active?.classList.add('hidden');
  elements.loading?.classList.add('hidden');

  // Show requested state
  switch (state) {
    case 'not-connected':
      elements.notConnected?.classList.remove('hidden');
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
  } else {
    elements.deviceName.textContent = 'No device';
  }
}

// ============ DEVICE PICKER ============

/**
 * Render the device list dropdown
 */
function renderDeviceList(devices) {
  if (!elements.deviceList) return;

  // Filter out any "SuShe Online" devices (legacy SDK devices)
  const filteredDevices = devices.filter(
    (d) => !d.name?.includes('SuShe Online')
  );

  if (!filteredDevices || filteredDevices.length === 0) {
    elements.deviceList.innerHTML = `
      <div class="text-center py-4 text-gray-500 text-xs">
        No devices found.<br>
        <span class="text-gray-600">Open Spotify on a device to see it here.</span>
      </div>
    `;
    return;
  }

  elements.deviceList.innerHTML = filteredDevices
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
        showState(currentPlayback ? 'active' : 'inactive');
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

    const position = getInterpolatedPosition();
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
 * Get appropriate polling interval based on current state
 */
function getPollingInterval() {
  if (!currentPlayback) {
    return POLL_INTERVAL_IDLE;
  }
  return currentPlayback.is_playing
    ? POLL_INTERVAL_PLAYING
    : POLL_INTERVAL_PAUSED;
}

/**
 * Poll Spotify API for playback state
 */
async function pollPlaybackState() {
  const state = await apiGetPlaybackState();

  if (!state || (!state.device && !state.is_playing)) {
    // No active playback
    if (currentPlayback) {
      restartPollingWithNewInterval();
    }
    currentPlayback = null;
    showState('inactive');
    stopProgressInterpolation();
    return;
  }

  // Detect state change
  const hadPlayback = !!currentPlayback;
  const wasPlaying = currentPlayback?.is_playing;

  // Update state
  currentPlayback = state;
  lastPollTime = Date.now();
  lastPosition = state.progress_ms || 0;

  // Log when playback is detected
  if (!hadPlayback && state) {
    console.log(
      'Playback detected on:',
      state.device?.name,
      '- Track:',
      state.item?.name
    );
    restartPollingWithNewInterval();
  } else if (wasPlaying !== state.is_playing) {
    restartPollingWithNewInterval();
  }

  // Show active state
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
    lastVolume = state.device.volume_percent;
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

  // Set up interval
  pollInterval = setInterval(pollPlaybackState, getPollingInterval());
}

/**
 * Restart polling with updated interval
 */
function restartPollingWithNewInterval() {
  if (pollInterval) {
    stopPolling();
    pollInterval = setInterval(pollPlaybackState, getPollingInterval());
  }
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

// ============ CONTROL HANDLERS ============

/**
 * Handle play/pause action
 */
async function handlePlayPause() {
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

/**
 * Handle next track action
 */
async function handleNext() {
  const success = await apiNext();
  if (success) {
    setTimeout(pollPlaybackState, 300);
  } else {
    showToast('Failed to skip track', 'error');
  }
}

/**
 * Handle previous track action
 */
async function handlePrevious() {
  const success = await apiPrevious();
  if (success) {
    setTimeout(pollPlaybackState, 300);
  } else {
    showToast('Failed to skip track', 'error');
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
    await apiSeek(positionMs);
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
  if (percent > 0) lastVolume = percent;

  // Debounce the actual volume change
  if (volumeTimeout) {
    clearTimeout(volumeTimeout);
  }

  volumeTimeout = setTimeout(async () => {
    await apiSetVolume(percent);
    volumeTimeout = null;
  }, 100);
}

/**
 * Handle mute toggle
 */
async function handleMuteToggle() {
  const currentVolume = parseInt(elements.volumeSlider?.value || 50);

  if (currentVolume > 0) {
    lastVolume = currentVolume;
    if (elements.volumeSlider) elements.volumeSlider.value = 0;
    handleVolumeChange(0);
  } else {
    const newVolume = lastVolume || 50;
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

// ============ VISIBILITY HANDLING ============

/**
 * Handle visibility changes
 */
function handleVisibilityChange() {
  if (document.hidden) {
    // Tab hidden - stop polling to save resources
    stopPolling();
    stopProgressInterpolation();
  } else {
    // Tab visible - resume polling
    startPolling();
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

  // Start polling for playback state immediately
  console.log('Spotify miniplayer: Starting API polling mode');
  startPolling();
}

/**
 * Clean up the player when navigating away
 */
export function destroyMiniplayer() {
  stopPolling();
  stopProgressInterpolation();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  currentPlayback = null;
}
