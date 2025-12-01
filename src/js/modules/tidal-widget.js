/**
 * Tidal Widget - Sidebar widget for Tidal users
 * Shows connection status and provides quick access info
 * Unlike Spotify miniplayer, this is informational only (no playback control)
 */

// DOM Elements (cached on init)
let elements = {};

/**
 * Cache DOM elements for the Tidal widget
 */
function cacheElements() {
  elements = {
    container: document.getElementById('tidalWidget'),
    notConnected: document.getElementById('tidalWidgetNotConnected'),
    connected: document.getElementById('tidalWidgetConnected'),
  };
}

/**
 * Show the appropriate widget state
 */
function showState(state) {
  if (!elements.container) return;

  // Hide all states
  if (elements.notConnected) elements.notConnected.classList.add('hidden');
  if (elements.connected) elements.connected.classList.add('hidden');

  // Show the requested state
  switch (state) {
    case 'not-connected':
      if (elements.notConnected)
        elements.notConnected.classList.remove('hidden');
      break;
    case 'connected':
      if (elements.connected) elements.connected.classList.remove('hidden');
      break;
  }
}

/**
 * Initialize the Tidal widget module
 */
export function initTidalWidget() {
  // Only initialize on desktop
  if (window.innerWidth < 1024) {
    return;
  }

  cacheElements();

  if (!elements.container) {
    console.log('Tidal widget: Container not found');
    return;
  }

  // Show the widget container
  elements.container.classList.remove('hidden');

  // Check if user has Tidal connected
  if (!window.currentUser?.tidalAuth) {
    showState('not-connected');
    return;
  }

  // User has Tidal connected - show connected state
  showState('connected');
  console.log('Tidal widget: Initialized in connected state');
}

/**
 * Clean up the widget when navigating away
 */
export function destroyTidalWidget() {
  elements = {};
}

/**
 * Hide the Tidal widget (used when switching to Spotify)
 */
export function hideTidalWidget() {
  if (elements.container) {
    elements.container.classList.add('hidden');
  }
}
