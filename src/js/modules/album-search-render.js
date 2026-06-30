/**
 * Shared album-search result markup, used by BOTH the desktop dropdown
 * (album-search-results.js) and the mobile overlay (mobile-album-search.js) so
 * a result row looks identical on every surface. The row styling lives in
 * public/styles/app.css under `.album-search-result*`.
 */

import { escapeHtml } from './html-utils.js';

/** One result row. `index` is used as the data hook + (desktop) ARIA option id. */
export function resultRowHtml(result, index) {
  const cover = `/api/albums/${encodeURIComponent(
    result.albumId
  )}/cover?size=thumb`;
  const sub = [result.artist, result.year]
    .filter(Boolean)
    .map((part) => escapeHtml(part))
    .join(' · ');
  return `
    <div class="album-search-result" role="option" id="albumSearchResult-${index}" data-result-index="${index}">
      <img class="album-search-result-cover" src="${escapeHtml(
        cover
      )}" alt="" loading="lazy" onerror="this.classList.add('is-broken')" />
      <span class="album-search-result-meta">
        <span class="album-search-result-title">${escapeHtml(
          result.album || 'Untitled'
        )}</span>
        <span class="album-search-result-sub">${sub}</span>
      </span>
      <span class="album-search-result-list" title="${escapeHtml(
        result.listName || ''
      )}"><i class="fas fa-list-ul"></i>${escapeHtml(
        result.listName || ''
      )}</span>
    </div>`;
}

/** "No albums match …" placeholder. */
export function emptyMessageHtml(query) {
  return `<div class="album-search-empty">No albums match “${escapeHtml(
    query
  )}”.</div>`;
}

/** Generic centered notice (e.g. an error), in the same empty-state slot. */
export function messageHtml(message) {
  return `<div class="album-search-empty">${escapeHtml(message)}</div>`;
}

/** Footer shown when the result set was capped server-side. */
export function truncatedHintHtml(visibleCount) {
  return `<div class="album-search-hint">Showing the first ${visibleCount} — keep typing to narrow down.</div>`;
}
