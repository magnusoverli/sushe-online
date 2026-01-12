/**
 * HTML utility functions for safe string handling
 * Consolidated from multiple modal and display modules
 */

/**
 * Escape HTML special characters to prevent XSS
 * Uses DOM-based approach for reliable escaping
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for HTML insertion
 */
export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Escape HTML using string replacement (faster for known safe contexts)
 * Use this when you need attribute-safe escaping
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeHtmlAttr(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Album placeholder SVG for missing cover images
 * @param {number} size - Size in pixels (default 120)
 * @returns {string} Data URI for placeholder SVG
 */
export function getPlaceholderSvg(size = 120) {
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='1'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Ccircle cx='12' cy='12' r='4'/%3E%3Ccircle cx='12' cy='12' r='1'/%3E%3C/svg%3E`;
}
