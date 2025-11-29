import './musicbrainz.js';
import './app.js';
import {
  initMiniplayer,
  initPlaybackTracking,
} from './modules/spotify-player.js';

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

// Initialize Spotify player features when DOM is ready
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

    if (isMobile) {
      // Mobile: headless playback tracking only (for now-playing feature)
      initPlaybackTracking();
    } else {
      // Desktop: full miniplayer UI + polling
      initMiniplayer();
    }
  }, 100);
});
