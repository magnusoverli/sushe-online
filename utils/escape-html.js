/**
 * Canonical HTML escaper — single source of truth.
 *
 * Requireable by the CommonJS server (utils/template-helpers.js, node tests)
 * and importable by the Vite browser bundle (src/js/modules/html-utils.js
 * re-exports it), mirroring how utils/normalization.js is shared across both.
 *
 * Escapes the five HTML-significant characters, including both quote styles,
 * so the same function is safe for element text AND attribute values.
 *
 * @param {string} str - value to escape
 * @returns {string} escaped string, or '' for nullish input
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { escapeHtml };
