import './musicbrainz.js';
import './app.js';
import { initMiniplayer } from './modules/spotify-player.js';

// Initialize Spotify miniplayer when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Small delay to ensure the main app has initialized
  setTimeout(() => {
    initMiniplayer();
  }, 100);
});
