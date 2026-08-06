import { escapeHtmlAttr as escapeHtml } from '../html-utils.js';
import { renderAvailabilityBadges } from './availability-badges.js';
import { getPositionBadgeColor } from './position-badge.js';
import { desktopPlaycountSpan, mobilePlaycountSpan } from './playcount-view.js';
export {
  getCoverLoadMode,
  renderCoverImage,
  renderDesktopCoverCell,
  renderMobileCoverSection,
} from './cover-parts.js';

export function renderSummaryBadge(data, { mobile = false } = {}) {
  if (!data.summary) return '';

  const mobileClass = mobile ? ' summary-badge-mobile' : '';
  return `<div class="summary-badge${mobileClass} claude-badge"
    data-summary="${escapeHtml(data.summary)}"
    data-source-url="${escapeHtml('')}"
    data-source="${escapeHtml(data.summarySource || '')}"
    data-album-name="${escapeHtml(data.albumName)}"
    data-artist="${escapeHtml(data.artist)}">
    <i class="fas fa-robot"></i>
  </div>`;
}

export function renderRecommendationBadge(data, { mobile = false } = {}) {
  if (!data.recommendedBy) return '';

  const mobileClass = mobile ? ' recommendation-badge-mobile' : '';
  return `<div class="recommendation-badge${mobileClass}"
    data-recommended-by="${escapeHtml(data.recommendedBy)}"
    data-recommended-at="${escapeHtml(data.recommendedAt || '')}"
    data-album-name="${escapeHtml(data.albumName)}"
    data-artist="${escapeHtml(data.artist)}">
    <i class="fas fa-thumbs-up"></i>
  </div>`;
}

export function renderDesktopAlbumCell(data, options = {}) {
  const playcountHtml =
    options.includePlaycount === false
      ? ''
      : desktopPlaycountSpan(
          data.itemId,
          data.playcountDisplay,
          data.playcount
        );
  const availabilityHtml =
    options.includeAvailability === false
      ? ''
      : renderAvailabilityBadges(data.availability);
  const titleAttr = options.includeTitle
    ? ` title="${escapeHtml(data.albumName)}"`
    : '';
  const releaseDateHtml =
    data.releaseDate || options.alwaysShowReleaseDate
      ? `<div class="text-xs mt-0.5 release-date-display ${data.yearMismatch ? 'text-red-500 cursor-help' : 'text-gray-400'}" ${data.yearMismatch ? `title="${escapeHtml(data.yearMismatchTooltip || '')}"` : ''}>${escapeHtml(data.releaseDate || '')}</div>`
      : '';

  return `<div class="${options.cellClass || 'album-cell flex flex-col justify-start'}">
    <div class="flex items-center gap-2">
      <span class="album-name font-semibold text-gray-200 truncate"${titleAttr}>${escapeHtml(data.albumName)}</span>
      ${playcountHtml}
    </div>
    ${releaseDateHtml}
    ${availabilityHtml}
  </div>`;
}

export function renderDesktopArtistCell(data, options = {}) {
  const hasArtist = Boolean(data.artist);
  const textClass = hasArtist
    ? options.textClass || 'text-gray-200'
    : options.emptyTextClass || 'text-gray-800 italic';
  const interactiveClass =
    options.interactive === false ? '' : ' cursor-pointer hover:text-gray-100';
  const titleAttr = options.includeTitle
    ? ` title="${escapeHtml(data.artist)}"`
    : '';

  return `<div class="${options.cellClass || 'artist-cell flex items-center'}">
    <span class="album-cell-text ${textClass} truncate${interactiveClass}"${titleAttr}>${escapeHtml(data.artist)}</span>
  </div>`;
}

export function renderDesktopGenreCell(data, slot, options = {}) {
  const value = slot === 2 ? data.genre2 : data.genre1;
  const display = slot === 2 ? data.genre2Display : data.genre1Display;
  const defaultClass = slot === 2 ? data.genre2Class : data.genre1Class;
  const emptyText = options.emptyText || (slot === 2 ? 'Genre 2' : 'Genre 1');
  const text = value ? display : emptyText;
  const textClass = value
    ? options.textClass || defaultClass || 'text-gray-300'
    : options.emptyTextClass || defaultClass || 'text-gray-800 italic';
  const interactiveClass =
    options.interactive === false ? '' : ' cursor-pointer hover:text-gray-100';
  const titleAttr = options.includeTitle
    ? ` title="${escapeHtml(value || emptyText)}"`
    : '';

  return `<div class="${options.cellClass || `flex items-center genre-${slot}-cell`}">
    <span class="album-cell-text ${textClass} truncate${interactiveClass}"${titleAttr}>${escapeHtml(text)}</span>
  </div>`;
}

export function renderMobilePositionBadge(position) {
  if (position === null) return '';

  const color = getPositionBadgeColor(position);
  return `<div class="mobile-position-badge"
    style="position: absolute; top: 5.5px; right: 5.5px; z-index: 10;
      width: 19px; height: 19px;
      display: flex; align-items: center; justify-content: center;
      border: 1px solid ${color.border}; border-radius: 50%;
      background: rgba(17, 24, 39, 0.7);
      box-shadow: 0 0 ${color.size} ${color.shadow};
      color: white; font-size: 10px; font-weight: 500; line-height: 1;
      font-variant-numeric: tabular-nums; pointer-events: none;"
    data-position-element="true">
    <span style="display: block; line-height: 1">${position}</span>
  </div>`;
}

export function renderMobileTitleRow(data, options = {}) {
  const badgesHtml = options.badgesHtml || '';
  const paddingStyle = options.paddingRight
    ? ` style="padding-right: ${options.paddingRight}"`
    : '';
  const titleClass =
    options.titleClass || 'text-gray-100 leading-tight truncate min-w-0';
  const titleStyle = options.titleStyle ?? 'font-size: 13px; font-weight: 700';
  const iconClass =
    options.iconClass ||
    'fas fa-compact-disc fa-xs inline-block w-4 text-center align-middle mr-1';
  const titleStyleAttr = titleStyle ? ` style="${titleStyle}"` : '';
  const titleSpanClass = options.titleSpanClass
    ? ` class="${options.titleSpanClass}"`
    : '';

  return `<div class="${options.wrapperClass || 'flex items-center relative'}"${paddingStyle}>
    <h3 class="${titleClass}"${titleStyleAttr}>
      <i class="${iconClass}"></i><span data-field="album-mobile-title"${titleSpanClass} title="${escapeHtml(data.albumName)}">${escapeHtml(data.albumName)}</span>
    </h3>
    <div data-mobile-album-badges class="absolute flex items-center" style="top: 50%; right: 4px; transform: translateY(-50%); gap: 4px">${badgesHtml}</div>
  </div>`;
}

export function renderMobileArtistRow(data, options = {}) {
  const spanClass = options.spanClass ? ` class="${options.spanClass}"` : '';

  return `<div class="${options.wrapperClass || 'flex items-center'}"${options.paddingRight ? ` style="padding-right: ${options.paddingRight}"` : ''}>
    <p class="${options.textClass || 'text-[12px] text-gray-400 truncate min-w-0'}">
      <i class="${options.iconClass || 'fas fa-user fa-xs inline-block w-4 text-center mr-1'}"></i><span data-field="artist-mobile-text"${spanClass} title="${escapeHtml(data.artist)}">${escapeHtml(data.artist)}</span>
    </p>
  </div>`;
}

export function renderMobileGenreRow(data, options = {}) {
  const value =
    data.genre1 && data.genre2
      ? `${data.genre1}${options.separator || ' / '}${data.genre2}`
      : data.genre1 || data.genre2 || '';
  const emptyText = options.emptyText || '';
  const valueSpanClass = options.valueSpanClass
    ? ` class="${options.valueSpanClass}"`
    : '';

  return `<div class="${options.wrapperClass || 'flex items-center'}">
    <span class="${options.textClass || 'text-[12px] text-gray-400 truncate'}" title="${escapeHtml(value || emptyText)}">
      <i class="${options.iconClass || 'fas fa-music fa-xs inline-block w-4 text-center mr-1'}"></i><span data-field="genre-mobile-text"${valueSpanClass}>${value ? escapeHtml(value) : options.emptyHtml || escapeHtml(emptyText)}</span>
    </span>
  </div>`;
}

export function renderMobilePlaycountRow(data) {
  return `<div class="flex items-center">
    ${mobilePlaycountSpan(data.itemId, data.playcountDisplay)}
  </div>`;
}
