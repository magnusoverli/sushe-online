/**
 * Spotify Miniplayer - API-Only Mode (Enhanced UX)
 * Controls playback on Spotify Connect devices via Web API
 * Features: Smooth animations, adaptive polling, optimistic UI
 */

import { showToast } from './utils.js';

// ============ MODULE STATE ============
let currentPlayback = null;
let previousTrackId = null;
let pollInterval = null;
let animationFrameId = null;
let lastVolume = 50;
let isSeeking = false;
let lastPollTime = 0;
let lastPosition = 0;
let consecutiveErrors = 0;
let isPollingPaused = false;
const pendingActions = new Set();

// Polling configuration
const POLL_INTERVAL_PLAYING = 2000; // 2s when playing (slightly longer, we interpolate)
const POLL_INTERVAL_PAUSED = 5000; // 5s when paused
const POLL_INTERVAL_IDLE = 4000; // 4s when no playback
const POLL_INTERVAL_NEAR_END = 500; // 500ms when track is about to end
const NEAR_END_THRESHOLD = 5000; // 5 seconds from end
const MAX_CONSECUTIVE_ERRORS = 5;
const BASE_BACKOFF_MS = 1000;

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

/**
 * Calculate backoff time based on consecutive errors
 */
function getBackoffTime() {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, consecutiveErrors), 30000);
}

// ============ API FUNCTIONS ============

/**
 * Wrapper for API calls with loading state and error handling
 */
async function apiCall(url, options = {}, actionName = null) {
  if (actionName) {
    pendingActions.add(actionName);
    updateButtonLoadingState(actionName, true);
  }

  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API error ${response.status}`);
    }

    // Reset error count on success
    consecutiveErrors = 0;

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }
    return { success: true };
  } catch (err) {
    consecutiveErrors++;
    console.error(`API call failed (${url}):`, err);
    return null;
  } finally {
    if (actionName) {
      pendingActions.delete(actionName);
      updateButtonLoadingState(actionName, false);
    }
  }
}

/**
 * Update button loading state
 */
function updateButtonLoadingState(actionName, isLoading) {
  const buttonMap = {
    play: elements.playPauseBtn,
    pause: elements.playPauseBtn,
    next: elements.nextBtn,
    previous: elements.prevBtn,
  };

  const btn = buttonMap[actionName];
  if (!btn) return;

  if (isLoading) {
    btn.classList.add('opacity-50', 'pointer-events-none');
  } else {
    btn.classList.remove('opacity-50', 'pointer-events-none');
  }
}

/**
 * Get current playback state from Spotify API
 */
async function apiGetPlaybackState() {
  return apiCall('/api/spotify/playback');
}

/**
 * Get available devices from Spotify API
 */
async function apiGetDevices() {
  const data = await apiCall('/api/spotify/devices');
  return data?.devices || [];
}

/**
 * Pause playback via API
 */
async function apiPause() {
  const result = await apiCall(
    '/api/spotify/pause',
    { method: 'PUT' },
    'pause'
  );
  return result !== null;
}

/**
 * Resume playback via API
 */
async function apiResume() {
  const result = await apiCall(
    '/api/spotify/resume',
    { method: 'PUT' },
    'play'
  );
  return result !== null;
}

/**
 * Skip to next track via API
 */
async function apiNext() {
  const result = await apiCall('/api/spotify/next', { method: 'POST' }, 'next');
  return result !== null;
}

/**
 * Skip to previous track via API
 */
async function apiPrevious() {
  const result = await apiCall(
    '/api/spotify/previous',
    { method: 'POST' },
    'previous'
  );
  return result !== null;
}

/**
 * Seek to position via API
 */
async function apiSeek(positionMs) {
  const result = await apiCall('/api/spotify/seek', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position_ms: positionMs }),
  });
  return result !== null;
}

/**
 * Set volume via API
 */
async function apiSetVolume(percent) {
  const result = await apiCall('/api/spotify/volume', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume_percent: percent }),
  });
  return result !== null;
}

/**
 * Transfer playback to a device via API
 */
async function apiTransferPlayback(deviceId, play = false) {
  const result = await apiCall('/api/spotify/transfer', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, play }),
  });
  return result !== null;
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
 * Update the progress bar UI (called from animation frame)
 */
function updateProgress(position, duration) {
  if (!elements.progressFill || !duration) return;

  const percent = Math.min((position / duration) * 100, 100);

  // Use transform for GPU-accelerated animation
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
 * Update track info display with optional animation
 */
function updateTrackInfo(track, animate = false) {
  if (!track) {
    if (elements.track) elements.track.textContent = 'No track';
    if (elements.artist) elements.artist.textContent = '—';
    if (elements.artImg) {
      elements.artImg.classList.add('hidden');
      elements.artImg.src = '';
    }
    previousTrackId = null;
    return;
  }

  const trackId = track.id || `${track.name}-${track.artists?.[0]?.name}`;
  const isNewTrack = previousTrackId && previousTrackId !== trackId;
  previousTrackId = trackId;

  // Apply animation class if this is a track change
  if (animate && isNewTrack) {
    animateTrackChange();
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
    // Preload new image before showing
    if (elements.artImg.src !== albumImage) {
      const img = new Image();
      img.onload = () => {
        if (elements.artImg) {
          elements.artImg.src = albumImage;
          elements.artImg.classList.remove('hidden');
        }
      };
      img.src = albumImage;
    } else {
      elements.artImg.classList.remove('hidden');
    }
  } else if (elements.artImg) {
    elements.artImg.classList.add('hidden');
  }
}

/**
 * Animate track change with fade effect
 */
function animateTrackChange() {
  const trackInfo = elements.track?.parentElement;
  const artContainer = elements.art;

  if (trackInfo) {
    trackInfo.classList.add('track-change-animation');
    setTimeout(() => {
      trackInfo.classList.remove('track-change-animation');
    }, 300);
  }

  if (artContainer) {
    artContainer.classList.add('art-change-animation');
    setTimeout(() => {
      artContainer.classList.remove('art-change-animation');
    }, 300);
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
        // Immediate poll to update state
        scheduleImmediatePoll();
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

// ============ PROGRESS ANIMATION (requestAnimationFrame) ============

/**
 * Get interpolated position between polls
 */
function getInterpolatedPosition() {
  if (!currentPlayback?.is_playing) return lastPosition;

  const elapsed = Date.now() - lastPollTime;
  const interpolated = lastPosition + elapsed;
  const duration = currentPlayback.item?.duration_ms || 0;

  // Clamp to duration
  return Math.min(interpolated, duration);
}

/**
 * Check if we're near the end of the track
 */
function isNearTrackEnd() {
  if (!currentPlayback?.is_playing) return false;

  const duration = currentPlayback.item?.duration_ms || 0;
  const position = getInterpolatedPosition();

  return duration > 0 && duration - position < NEAR_END_THRESHOLD;
}

/**
 * Animation frame loop for smooth progress updates
 */
function animationLoop() {
  if (!currentPlayback?.is_playing || isSeeking) {
    animationFrameId = null;
    return;
  }

  const position = getInterpolatedPosition();
  const duration = currentPlayback.item?.duration_ms || 0;

  updateProgress(position, duration);

  // Check for track end (auto-advance detection)
  if (position >= duration && duration > 0) {
    // Track has ended, poll immediately for next track
    scheduleImmediatePoll();
    animationFrameId = null;
    return;
  }

  // Continue animation
  animationFrameId = requestAnimationFrame(animationLoop);
}

/**
 * Start the animation loop
 */
function startProgressAnimation() {
  if (animationFrameId) return; // Already running
  animationFrameId = requestAnimationFrame(animationLoop);
}

/**
 * Stop the animation loop
 */
function stopProgressAnimation() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

// ============ ADAPTIVE POLLING ============

/**
 * Get appropriate polling interval based on current state
 */
function getPollingInterval() {
  // If we have errors, apply backoff
  if (consecutiveErrors > 0) {
    return getBackoffTime();
  }

  if (!currentPlayback) {
    return POLL_INTERVAL_IDLE;
  }

  if (!currentPlayback.is_playing) {
    return POLL_INTERVAL_PAUSED;
  }

  // Poll faster when near track end to catch auto-advance
  if (isNearTrackEnd()) {
    return POLL_INTERVAL_NEAR_END;
  }

  return POLL_INTERVAL_PLAYING;
}

/**
 * Schedule an immediate poll (cancels pending poll)
 */
function scheduleImmediatePoll() {
  stopPolling();
  pollPlaybackState().then(() => {
    // Resume normal polling after immediate poll
    if (!isPollingPaused) {
      startPolling();
    }
  });
}

/**
 * Poll Spotify API for playback state
 */
async function pollPlaybackState() {
  const state = await apiGetPlaybackState();

  // Handle too many errors
  if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    console.warn(
      `Spotify polling: ${consecutiveErrors} consecutive errors, backing off`
    );
  }

  if (!state || (!state.device && !state.is_playing)) {
    // No active playback
    const hadPlayback = !!currentPlayback;
    currentPlayback = null;
    previousTrackId = null;
    showState('inactive');
    stopProgressAnimation();

    if (hadPlayback) {
      restartPollingWithNewInterval();
    }
    return;
  }

  // Detect state changes
  const hadPlayback = !!currentPlayback;
  const wasPlaying = currentPlayback?.is_playing;
  const oldTrackId = currentPlayback?.item?.id;
  const newTrackId = state.item?.id;
  const isTrackChange = oldTrackId && newTrackId && oldTrackId !== newTrackId;

  // Update state
  currentPlayback = state;
  lastPollTime = Date.now();
  lastPosition = state.progress_ms || 0;

  // Log significant events
  if (!hadPlayback && state) {
    console.log(
      'Playback detected on:',
      state.device?.name,
      '- Track:',
      state.item?.name
    );
  } else if (isTrackChange) {
    console.log('Track changed to:', state.item?.name);
  }

  // Show active state
  showState('active');

  // Update UI (animate if track changed)
  updateTrackInfo(state.item, isTrackChange);
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

  // Manage progress animation
  if (state.is_playing) {
    startProgressAnimation();
  } else {
    stopProgressAnimation();
  }

  // Adjust polling interval if state changed
  if (wasPlaying !== state.is_playing || !hadPlayback) {
    restartPollingWithNewInterval();
  }
}

/**
 * Start polling for playback state
 */
function startPolling() {
  if (isPollingPaused) return;
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
  if (isPollingPaused || !pollInterval) return;
  stopPolling();
  pollInterval = setInterval(pollPlaybackState, getPollingInterval());
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
  if (pendingActions.has('play') || pendingActions.has('pause')) return;

  const isPlaying = currentPlayback?.is_playing;

  // Optimistic UI update
  updatePlayPauseIcon(!isPlaying);
  if (currentPlayback) {
    currentPlayback.is_playing = !isPlaying;
  }

  // Start/stop animation based on new state
  if (!isPlaying) {
    lastPollTime = Date.now();
    startProgressAnimation();
  } else {
    stopProgressAnimation();
  }

  const success = isPlaying ? await apiPause() : await apiResume();

  if (!success) {
    // Revert on failure
    updatePlayPauseIcon(isPlaying);
    if (currentPlayback) {
      currentPlayback.is_playing = isPlaying;
    }
    if (isPlaying) {
      startProgressAnimation();
    } else {
      stopProgressAnimation();
    }
    showToast('Playback control failed', 'error');
  } else {
    // Poll immediately to sync state
    scheduleImmediatePoll();
  }
}

/**
 * Handle next track action
 */
async function handleNext() {
  if (pendingActions.has('next')) return;

  const success = await apiNext();
  if (success) {
    // Reset progress immediately for responsive feel
    lastPosition = 0;
    lastPollTime = Date.now();
    updateProgress(0, currentPlayback?.item?.duration_ms || 0);

    // Poll immediately for new track info
    scheduleImmediatePoll();
  } else {
    showToast('Failed to skip track', 'error');
  }
}

/**
 * Handle previous track action
 */
async function handlePrevious() {
  if (pendingActions.has('previous')) return;

  const success = await apiPrevious();
  if (success) {
    // Reset progress immediately for responsive feel
    lastPosition = 0;
    lastPollTime = Date.now();
    updateProgress(0, currentPlayback?.item?.duration_ms || 0);

    // Poll immediately for track info
    scheduleImmediatePoll();
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
  updateProgress(positionMs, currentPlayback?.item?.duration_ms || 0);

  // Debounce the actual seek
  if (seekTimeout) {
    clearTimeout(seekTimeout);
  }

  seekTimeout = setTimeout(async () => {
    const success = await apiSeek(positionMs);
    seekTimeout = null;

    if (success) {
      // Brief poll to confirm position
      setTimeout(() => scheduleImmediatePoll(), 200);
    }
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

  // Progress bar seeking (mouse)
  setupProgressBarEvents();

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

  // Keyboard shortcuts
  setupKeyboardShortcuts();
}

/**
 * Set up progress bar mouse/touch events
 */
function setupProgressBarEvents() {
  if (!elements.progress) return;

  function updateSeekPosition(e, commit = false) {
    const rect = elements.progress.getBoundingClientRect();
    let clientX;

    // Handle both mouse and touch events
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX;
    } else {
      clientX = e.clientX;
    }

    const percent = Math.max(
      0,
      Math.min(1, (clientX - rect.left) / rect.width)
    );
    const duration = currentPlayback?.item?.duration_ms || 0;
    const position = Math.floor(percent * duration);

    updateProgress(position, duration);

    if (commit) {
      handleSeek(position);
    }
  }

  // Mouse events
  elements.progress.addEventListener('mousedown', (e) => {
    isSeeking = true;
    stopProgressAnimation();
    updateSeekPosition(e);
  });

  document.addEventListener('mousemove', (e) => {
    if (isSeeking) updateSeekPosition(e);
  });

  document.addEventListener('mouseup', (e) => {
    if (isSeeking) {
      updateSeekPosition(e, true);
      isSeeking = false;
      if (currentPlayback?.is_playing) {
        startProgressAnimation();
      }
    }
  });

  // Touch events for laptop touchscreens
  elements.progress.addEventListener(
    'touchstart',
    (e) => {
      isSeeking = true;
      stopProgressAnimation();
      updateSeekPosition(e);
    },
    { passive: true }
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      if (isSeeking) updateSeekPosition(e);
    },
    { passive: true }
  );

  document.addEventListener('touchend', (e) => {
    if (isSeeking) {
      updateSeekPosition(e, true);
      isSeeking = false;
      if (currentPlayback?.is_playing) {
        startProgressAnimation();
      }
    }
  });
}

/**
 * Set up keyboard shortcuts for media control
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Only handle if miniplayer is active and no input is focused
    if (!currentPlayback) return;
    if (
      document.activeElement?.tagName === 'INPUT' ||
      document.activeElement?.tagName === 'TEXTAREA' ||
      document.activeElement?.isContentEditable
    ) {
      return;
    }

    switch (e.code) {
      case 'Space':
        // Only if not in a form context
        if (e.target === document.body) {
          e.preventDefault();
          handlePlayPause();
        }
        break;
      case 'ArrowLeft':
        if (e.shiftKey) {
          e.preventDefault();
          handlePrevious();
        }
        break;
      case 'ArrowRight':
        if (e.shiftKey) {
          e.preventDefault();
          handleNext();
        }
        break;
    }
  });
}

// ============ VISIBILITY HANDLING ============

/**
 * Handle visibility changes
 */
function handleVisibilityChange() {
  if (document.hidden) {
    // Tab hidden - pause polling to save resources
    isPollingPaused = true;
    stopPolling();
    stopProgressAnimation();
  } else {
    // Tab visible - resume polling
    isPollingPaused = false;
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
  console.log('Spotify miniplayer: Starting enhanced API polling mode');
  startPolling();
}

/**
 * Clean up the player when navigating away
 */
export function destroyMiniplayer() {
  stopPolling();
  stopProgressAnimation();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  currentPlayback = null;
  previousTrackId = null;
  consecutiveErrors = 0;
  isPollingPaused = false;
}
