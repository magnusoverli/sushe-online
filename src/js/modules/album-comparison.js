/**
 * Shared two-up album comparison card, used by the similar-album and
 * manual-album-audit modals (MODAL-5). Each modal renders two of these side by
 * side (grid-cols-2) with its own label, accent border and optional extra row.
 */
import { escapeHtml } from './html-utils.js';

/**
 * @param {object} opts
 * @param {string} opts.album - album title
 * @param {string} opts.artist - artist name
 * @param {string} [opts.coverUrl] - cover image URL (falls back to placeholder)
 * @param {string} opts.placeholderSvg - placeholder data URI
 * @param {string} opts.label - label inner HTML (text, or icon + text)
 * @param {string} [opts.labelClass] - classes for the label line
 * @param {string} [opts.borderClass] - accent border classes (e.g. the "exists" card)
 * @param {string} [opts.extraHtml] - optional extra row below the artist
 * @returns {string} card HTML
 */
export function renderComparisonCard({
  album,
  artist,
  coverUrl,
  placeholderSvg,
  label,
  labelClass = 'text-gray-500',
  borderClass = '',
  extraHtml = '',
}) {
  const safeAlbum = escapeHtml(album);
  const safeArtist = escapeHtml(artist);
  return `
    <div class="bg-gray-800 rounded-lg p-4${borderClass ? ' ' + borderClass : ''}">
      <div class="text-xs ${labelClass} uppercase tracking-wide mb-2">${label}</div>
      <div class="aspect-square mb-3 bg-gray-900 rounded overflow-hidden">
        <img
          src="${coverUrl || placeholderSvg}"
          alt="${safeAlbum}"
          class="w-full h-full object-cover"
          onerror="this.src='${placeholderSvg}'"
        />
      </div>
      <div class="text-white font-semibold truncate" title="${safeAlbum}">
        ${safeAlbum}
      </div>
      <div class="text-gray-400 text-sm truncate" title="${safeArtist}">
        ${safeArtist}
      </div>
      ${extraHtml}
    </div>`;
}
