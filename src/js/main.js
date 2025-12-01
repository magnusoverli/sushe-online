import './musicbrainz.js';
import './app.js';
import {
  initMiniplayer,
  initPlaybackTracking,
} from './modules/spotify-player.js';
import { initTidalWidget } from './modules/tidal-widget.js';
import { initDiscovery } from './modules/discovery.js';

/**
 * Detect if app is running in standalone/PWA mode
 * (opened from home screen shortcut, not browser)
 */
function detectStandaloneMode() {
  // iOS Safari standalone mode
  if (window.navigator.standalone === true) {
    return true;
  }

  // Standard PWA standalone mode (Chrome, Edge, etc.)
  if (
    window.matchMedia &&
    window.matchMedia('(display-mode: standalone)').matches
  ) {
    return true;
  }

  // Fallback: check if running in fullscreen mode
  if (
    window.matchMedia &&
    window.matchMedia('(display-mode: fullscreen)').matches
  ) {
    return true;
  }

  return false;
}

/**
 * Determine which sidebar widget to show based on user's music service preference
 * and which services they have connected.
 *
 * Logic:
 * - If user has set a default music service preference, show that service's widget
 * - If no preference ("ask each time"), show widget for whichever service is connected
 * - If both connected and no preference, prefer Spotify (has richer functionality)
 * - If neither connected, show Spotify widget (with "Connect" prompt)
 */
function getSidebarWidgetType() {
  const user = window.currentUser;
  if (!user) return 'spotify'; // Fallback

  const hasSpotify = !!user.spotifyAuth;
  const hasTidal = !!user.tidalAuth;
  const preference = user.musicService; // 'spotify', 'tidal', or null/"" for "ask each time"

  // If user has explicitly set a preference, honor it
  if (preference === 'tidal' && hasTidal) {
    return 'tidal';
  }
  if (preference === 'spotify' && hasSpotify) {
    return 'spotify';
  }

  // No preference set - show widget for connected service
  // Prefer Spotify if both connected (richer functionality)
  if (hasSpotify) {
    return 'spotify';
  }
  if (hasTidal) {
    return 'tidal';
  }

  // Neither connected - default to Spotify widget (will show connect prompt)
  return 'spotify';
}

/**
 * Initialize the appropriate sidebar widget based on user preference
 */
function initSidebarWidget(isMobile) {
  const widgetType = getSidebarWidgetType();

  if (widgetType === 'tidal') {
    // Hide Spotify miniplayer, show Tidal widget
    const spotifyMiniplayer = document.getElementById('spotifyMiniplayer');
    if (spotifyMiniplayer) {
      spotifyMiniplayer.classList.add('hidden');
    }
    initTidalWidget();
    console.log('Sidebar widget: Tidal (user preference)');
  } else {
    // Hide Tidal widget, show Spotify miniplayer
    const tidalWidget = document.getElementById('tidalWidget');
    if (tidalWidget) {
      tidalWidget.classList.add('hidden');
    }
    if (isMobile) {
      // Mobile: headless playback tracking only (for now-playing feature)
      initPlaybackTracking();
    } else {
      // Desktop: full miniplayer UI + polling
      initMiniplayer();
    }
    console.log('Sidebar widget: Spotify');
  }
}

// Initialize music service widgets when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Detect standalone mode and add class to body for CSS targeting
  const isStandalone = detectStandaloneMode();
  if (isStandalone) {
    document.body.classList.add('standalone-mode');
    document.documentElement.classList.add('standalone-mode');
    console.log('Detected standalone/PWA mode - adjusting safe area handling');
  }

  // Small delay to ensure the main app has initialized
  setTimeout(() => {
    const isMobile = window.innerWidth < 1024;

    // Initialize the appropriate sidebar widget based on user preference
    initSidebarWidget(isMobile);

    // Initialize discovery module (Last.fm recommendations)
    // Only if user has Last.fm connected
    if (window.currentUser?.lastfmUsername) {
      initDiscovery();
    }
  }, 100);
});
