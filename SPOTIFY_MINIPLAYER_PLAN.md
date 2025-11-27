# Spotify Hybrid Miniplayer Implementation Plan

## Overview

Implement an enhanced miniplayer in the desktop sidebar that can control Spotify playback across all Spotify Connect devices, using a hybrid approach of Web Playback SDK (real-time when browser is active) and Web API (polling when other devices are active).

## Target UI

```
┌─────────────────────────────────────────────────────────────┐
│ ┌──────┐                                                    │
│ │ ART  │  Track Name                                        │
│ │      │  Artist Name                                       │
│ └──────┘                                                    │
│                                                             │
│  0:42 ━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 3:21   │
│                                                             │
│         ⏮    ▶    ⏭           🔊━━━━●━━━    📱 iPhone ▼   │
└─────────────────────────────────────────────────────────────┘
```

## Features

### Included

- Album art display
- Track name and artist name
- Progress bar with drag-to-seek
- Time elapsed / total duration
- Play/Pause button
- Previous/Next track buttons
- Volume slider with mute toggle
- Device picker dropdown with device icons
- Device transfer (one-click switch)
- Smooth CSS animations
- Real-time updates (SDK when browser active)
- Smart polling with interpolation (API when other device active)

### Excluded (by design)

- Shuffle toggle
- Repeat toggle
- Like/Save track button
- Keyboard shortcuts
- Lyrics display
- Queue view

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      MINIPLAYER UI                          │
└─────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
     ┌─────────────┐                 ┌─────────────┐
     │  SDK Events │                 │   Web API   │
     │ (real-time) │                 │  (polling)  │
     └─────────────┘                 └─────────────┘
            │                               │
            ▼                               ▼
     Browser is the                  Other device is
     active device                   active (phone, etc)
```

### Hybrid Logic

1. SDK's `player_state_changed` with state → Browser is active, use SDK events
2. SDK's `player_state_changed` with null → Transferred away, start API polling
3. Device selector → Always uses API
4. Controls → Route to SDK methods if browser active, API otherwise

---

## Phase 1: Backend API Endpoints

Add proxy endpoints to `routes/api.js` for Spotify Web API calls.

| Endpoint                | Method | Spotify API                                 | Description                 |
| ----------------------- | ------ | ------------------------------------------- | --------------------------- |
| `/api/spotify/playback` | GET    | `GET /v1/me/player`                         | Get current playback state  |
| `/api/spotify/pause`    | PUT    | `PUT /v1/me/player/pause`                   | Pause playback              |
| `/api/spotify/previous` | POST   | `POST /v1/me/player/previous`               | Skip to previous            |
| `/api/spotify/next`     | POST   | `POST /v1/me/player/next`                   | Skip to next                |
| `/api/spotify/seek`     | PUT    | `PUT /v1/me/player/seek?position_ms=X`      | Seek to position            |
| `/api/spotify/volume`   | PUT    | `PUT /v1/me/player/volume?volume_percent=X` | Set volume                  |
| `/api/spotify/transfer` | PUT    | `PUT /v1/me/player`                         | Transfer playback to device |

**Already implemented:**

- `GET /api/spotify/devices` - List available devices
- `GET /api/spotify/token` - Get access token for SDK
- `PUT /api/spotify/play` - Start playback

**Estimated time:** 30 minutes

---

## Phase 2: Enhanced Miniplayer UI

### 2.1 Update HTML Template (`templates.js`)

Replace current miniplayer HTML with new layout:

- Larger album art (48x48 or 56x56)
- Two-line track info (track name + artist)
- Full-width progress bar with time labels
- Control row: prev/play-pause/next + volume + device picker
- Device dropdown with icons

### 2.2 Update Styles (`src/styles/input.css`)

- Device dropdown styling
- Device type icons (📱 🖥️ 🔊 📺 🌐)
- Progress bar hover states
- Volume slider styling
- Smooth transitions
- Active device highlight

**Estimated time:** 30 minutes

---

## Phase 3: Hybrid Player Logic

### 3.1 State Management

```javascript
// Module state
let mode = 'inactive'; // 'inactive' | 'sdk' | 'api'
let activeDevice = null;
let currentPlayback = null;
let pollInterval = null;
```

### 3.2 API Control Functions

```javascript
async function apiPause()
async function apiResume()
async function apiNext()
async function apiPrevious()
async function apiSeek(positionMs)
async function apiSetVolume(percent)
async function apiTransferPlayback(deviceId, play = false)
async function apiGetPlaybackState()
async function apiGetDevices()
```

### 3.3 Smart Polling

```javascript
function startPolling() {
  // Poll every 1-2 seconds
  // Update UI with playback state
  // Use interpolation for smooth progress bar
}

function stopPolling() {
  // Clear interval
}

// Start/stop based on:
// - Tab visibility (document.hidden)
// - Active device (SDK vs other)
// - Playback state (playing vs paused)
```

### 3.4 Hybrid Routing

```javascript
function handlePlayPause() {
  if (mode === 'sdk' && player) {
    player.togglePlay();
  } else {
    currentPlayback?.is_playing ? apiPause() : apiResume();
  }
}

function handleNext() {
  if (mode === 'sdk' && player) {
    player.nextTrack();
  } else {
    apiNext();
  }
}
// ... similar for prev, seek, volume
```

### 3.5 Progress Interpolation

```javascript
// When polling, interpolate between updates
let lastPollTime = Date.now();
let lastPosition = 0;

function getInterpolatedPosition() {
  if (!currentPlayback?.is_playing) return lastPosition;
  const elapsed = Date.now() - lastPollTime;
  return Math.min(lastPosition + elapsed, currentPlayback.duration_ms);
}
```

### 3.6 Device Picker

```javascript
async function loadDevices() {
  const devices = await apiGetDevices();
  renderDeviceDropdown(devices);
}

function handleDeviceSelect(deviceId) {
  apiTransferPlayback(deviceId, currentPlayback?.is_playing);
}
```

### 3.7 Mode Switching

```javascript
// SDK event handler
player.addListener('player_state_changed', (state) => {
  if (state) {
    // Browser is active device
    mode = 'sdk';
    stopPolling();
    updateUIFromSDK(state);
  } else {
    // Playback transferred away
    mode = 'api';
    startPolling();
  }
});
```

**Estimated time:** 60 minutes

---

## Phase 4: Polish

### 4.1 Animations

- Smooth progress bar transitions
- Fade in/out for state changes
- Device dropdown animation

### 4.2 Debounced Seek

- Don't call API while dragging
- Call once on mouse up
- Update UI optimistically

### 4.3 Visibility-Based Polling

```javascript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPolling();
  } else if (mode === 'api') {
    startPolling();
  }
});
```

### 4.4 Loading & Error States

- Loading spinner during device transfer
- Error toast on API failures
- Retry logic for transient errors

### 4.5 Optimistic UI

- Update button states immediately on click
- Sync with actual state after API response

**Estimated time:** 20 minutes

---

## Files Modified

| File                               | Changes                       |
| ---------------------------------- | ----------------------------- |
| `routes/api.js`                    | Add 7 new API endpoints       |
| `templates.js`                     | Replace miniplayer HTML       |
| `src/styles/input.css`             | Add miniplayer styles         |
| `src/js/modules/spotify-player.js` | Complete rewrite (~400 lines) |

---

## Testing Checklist

- [ ] Browser as active device → real-time updates
- [ ] Phone as active device → polling updates
- [ ] Transfer from browser to phone
- [ ] Transfer from phone to browser
- [ ] Play/pause on browser device
- [ ] Play/pause on remote device
- [ ] Next/previous on both
- [ ] Seek by dragging progress bar
- [ ] Volume control
- [ ] Mute/unmute
- [ ] Device dropdown shows all devices
- [ ] Device icons display correctly
- [ ] Smooth progress bar animation
- [ ] Tab hidden → polling stops
- [ ] Tab visible → polling resumes
- [ ] No Spotify Premium → graceful error

---

## Estimated Total Time

| Phase            | Time           |
| ---------------- | -------------- |
| Phase 1: Backend | 30 min         |
| Phase 2: UI      | 30 min         |
| Phase 3: Logic   | 60 min         |
| Phase 4: Polish  | 20 min         |
| **Total**        | **~2.5 hours** |

---

## Dependencies

- Spotify Premium account (required for playback control)
- Existing OAuth with `streaming` scope (already implemented)
- Web Playback SDK (already loaded)

## Notes

- The `streaming` scope is already added to OAuth
- The `/api/spotify/token` endpoint already exists
- Device listing already works via existing play album feature
- Premium check already handled by SDK's `account_error` event
