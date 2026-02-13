/**
 * Device type to Font Awesome icon mapping.
 * Shared by spotify-player.js and context-menus.js.
 *
 * Kept in a standalone file (no imports) so it can be loaded in
 * the Node.js test-runner without needing the @utils Vite alias.
 *
 * @module device-icons
 */

/**
 * @type {Object<string, string>}
 */
const DEVICE_ICONS = {
  computer: 'fas fa-laptop',
  smartphone: 'fas fa-mobile-alt',
  speaker: 'fas fa-volume-up',
  tv: 'fas fa-tv',
  avr: 'fas fa-broadcast-tower',
  stb: 'fas fa-satellite-dish',
  audiodongle: 'fas fa-headphones',
  gameconsole: 'fas fa-gamepad',
  castvideo: 'fas fa-chromecast',
  castaudio: 'fas fa-podcast',
  automobile: 'fas fa-car',
  tablet: 'fas fa-tablet-alt',
};

const DEFAULT_DEVICE_ICON = 'fas fa-music';

/**
 * Get Font Awesome icon class for a Spotify device type.
 * Case-insensitive, returns full class string including "fas" prefix.
 * @param {string} type - Spotify device type (e.g., "Computer", "smartphone")
 * @returns {string} Font Awesome icon class (e.g., "fas fa-laptop")
 */
export function getDeviceIcon(type) {
  return DEVICE_ICONS[type?.toLowerCase()] || DEFAULT_DEVICE_ICON;
}
