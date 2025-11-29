import './musicbrainz.js';
import './app.js';
import {
  initMiniplayer,
  initPlaybackTracking,
} from './modules/spotify-player.js';

// Initialize Spotify player features when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
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
