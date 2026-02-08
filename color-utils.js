// color-utils.js
// Utility functions for color manipulation

// Adjust color brightness
function adjustColor(color, amount) {
  const num = parseInt(color.replace('#', ''), 16);
  const amt = Math.round(2.55 * amount);
  const R = (num >> 16) + amt;
  const G = ((num >> 8) & 0x00ff) + amt;
  const B = (num & 0x0000ff) + amt;
  return (
    '#' +
    (
      0x1000000 +
      (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
      (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
      (B < 255 ? (B < 1 ? 0 : B) : 255)
    )
      .toString(16)
      .slice(1)
  );
}

// Convert hex to RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

// Get color with opacity
function colorWithOpacity(color, opacity) {
  const rgb = hexToRgb(color);
  return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})` : color;
}

// Default accent color used across all templates
const DEFAULT_ACCENT = '#dc2626';

/**
 * Generate CSS custom property declarations for accent theming.
 * Returns a string of CSS variable declarations (without :root wrapper).
 *
 * @param {object} [user] - User object with optional accentColor
 * @param {object} [options]
 * @param {boolean} [options.includeSubtle=true] - Include --accent-subtle vars
 * @returns {string} CSS variable declarations
 */
function generateAccentCssVars(user, options = {}) {
  const { includeSubtle = true } = options;
  const color = user?.accentColor || DEFAULT_ACCENT;
  let vars = `--accent-color: ${color};
      --accent-hover: ${adjustColor(color, -30)};
      --accent-light: ${adjustColor(color, 40)};
      --accent-dark: ${adjustColor(color, -50)};
      --accent-shadow: ${colorWithOpacity(color, 0.4)};
      --accent-glow: ${colorWithOpacity(color, 0.5)};`;
  if (includeSubtle) {
    vars += `
      --accent-subtle: ${colorWithOpacity(color, 0.2)};
      --accent-subtle-strong: ${colorWithOpacity(color, 0.3)};`;
  }
  return vars;
}

/**
 * Generate CSS override rules that remap Tailwind red-* classes to accent color.
 * Returns a string of CSS rules.
 *
 * @param {object} [options]
 * @param {boolean} [options.includeBackground=false] - Include bg-red-* overrides
 * @param {boolean} [options.includeDark=false] - Include bg-red-800/900 overrides
 * @returns {string} CSS rules
 */
function generateAccentOverrides(options = {}) {
  const { includeBackground = false, includeDark = false } = options;
  let css = `.text-red-600, .text-red-500, .text-red-400 { color: var(--accent-color) !important; }
    .hover\\:text-red-500:hover, .hover\\:text-red-400:hover { color: var(--accent-color) !important; }
    .border-red-600, .border-red-500 { border-color: var(--accent-color) !important; }`;
  if (includeBackground) {
    css += `
    .bg-red-600 { background-color: var(--accent-color) !important; }
    .hover\\:bg-red-700:hover { background-color: var(--accent-hover) !important; }`;
  }
  if (includeDark) {
    css += `
    .ring-red-600 { --tw-ring-color: var(--accent-color) !important; }
    .focus\\:border-red-600:focus:not(.spotify-input) { border-color: var(--accent-color) !important; }
    .bg-red-900 { background-color: var(--accent-dark) !important; }
    .bg-red-800 { background-color: var(--accent-dark) !important; }`;
  }
  return css;
}

module.exports = {
  adjustColor,
  colorWithOpacity,
  DEFAULT_ACCENT,
  generateAccentCssVars,
  generateAccentOverrides,
};
