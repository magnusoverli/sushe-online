import { escapeHtmlAttr as escapeHtml } from '../html-utils.js';
import { PLACEHOLDER_GIF } from '../album-display-shared.js';
import { renderAvailabilityBadges } from './availability-badges.js';
import { getPositionBadgeColor } from './position-badge.js';
import { desktopPlaycountSpan, mobilePlaycountSpan } from './playcount-view.js';

const INITIAL_DESKTOP_COVER_COUNT = 16;
const INITIAL_MOBILE_COVER_COUNT = 8;

const COVER_PLACEHOLDER_SVG = `<div class="album-cover-placeholder rounded-sm bg-gray-800 shadow-lg">
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-600">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    <circle cx="8.5" cy="8.5" r="1.5"></circle>
    <polyline points="21 15 16 10 5 21"></polyline>
  </svg>
</div>`;

export function getCoverLoadMode(index, isMobile) {
  const initialCount = isMobile
    ? INITIAL_MOBILE_COVER_COUNT
    : INITIAL_DESKTOP_COVER_COUNT;
  return index < initialCount ? 'initial' : 'eager';
}

function getCoverSrc(data) {
  if (data.coverImage) {
    return `data:image/${data.imageFormat};base64,${data.coverImage}`;
  }

  return data.coverThumbUrl || null;
}

function compactFallbackHtml(html) {
  return html.replace(/\n\s*/g, '');
}

function renderFallbackAttr(fallbackHtml) {
  if (!fallbackHtml) return '';

  const handler = `this.onerror=null; this.parentElement.innerHTML=${JSON.stringify(compactFallbackHtml(fallbackHtml))}`;
  return ` onerror="${escapeHtml(handler)}"`;
}

export function renderCoverImage({
  src,
  fullSrc,
  alt,
  className,
  loadMode,
  fallbackHtml = '',
}) {
  const escapedSrc = escapeHtml(src);
  const escapedFullSrc = escapeHtml(fullSrc || src);
  const escapedAlt = escapeHtml(alt || '');
  const fallbackAttr = renderFallbackAttr(fallbackHtml);

  if (loadMode === 'lazy') {
    return `<img src="${escapedSrc}"
      data-full-src="${escapedFullSrc}"
      alt="${escapedAlt}"
      class="${className}"
      loading="lazy"
      decoding="async"${fallbackAttr}
    >`;
  }

  if (loadMode === 'initial') {
    return `<img src="${escapedSrc}"
      data-full-src="${escapedFullSrc}"
      data-cover-reveal-group="initial"
      alt="${escapedAlt}"
      class="${className} cover-reveal-pending"
      loading="eager"
      decoding="async"
      fetchpriority="high"${fallbackAttr}
    >`;
  }

  return `<img src="${PLACEHOLDER_GIF}"
    data-lazy-src="${escapedSrc}"
    data-full-src="${escapedFullSrc}"
    alt="${escapedAlt}"
    class="${className}"
    loading="eager"
    decoding="async"
    fetchpriority="low"${fallbackAttr}
  >`;
}

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

export function renderDesktopCoverCell(data, index, options = {}) {
  const coverImageSrc = getCoverSrc(data);
  const loadMode = options.loadMode || getCoverLoadMode(index, false);
  const revealClass =
    coverImageSrc && loadMode === 'initial' ? ' cover-reveal-shell' : '';
  const placeholderHtml = options.placeholderHtml || COVER_PLACEHOLDER_SVG;
  const badgesHtml = options.badgesHtml || '';

  return `<div class="${options.cellClass || 'cover-cell flex items-center'}">
    <div class="album-cover-container${revealClass}">
      ${
        coverImageSrc
          ? renderCoverImage({
              src: coverImageSrc,
              fullSrc: data.coverImageUrl || coverImageSrc,
              alt: data.albumName,
              className:
                options.imageClassName || 'album-cover rounded-sm shadow-lg',
              loadMode,
              fallbackHtml: placeholderHtml,
            })
          : placeholderHtml
      }
      ${badgesHtml}
    </div>
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
  const fallback = options.fallback || (slot === 2 ? 'Genre 2' : 'Genre 1');
  const text = value ? display : fallback;
  const textClass = value
    ? options.textClass || defaultClass || 'text-gray-300'
    : options.emptyTextClass || defaultClass || 'text-gray-800 italic';
  const interactiveClass =
    options.interactive === false ? '' : ' cursor-pointer hover:text-gray-100';
  const titleAttr = options.includeTitle
    ? ` title="${escapeHtml(value || fallback)}"`
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

export function renderMobileCoverSection(data, index, options = {}) {
  const coverSrc = getCoverSrc(data);
  const loadMode = options.loadMode || getCoverLoadMode(index, true);
  const coverExtraHtml = options.coverExtraHtml || '';
  const placeholderHtml =
    options.placeholderHtml ||
    '<i class="fas fa-compact-disc text-xl text-gray-600"></i>';
  const dateText = options.dateText ?? data.releaseDate;
  const availabilityHtml =
    options.includeAvailability === false
      ? ''
      : renderAvailabilityBadges(data.availability, { variant: 'mobile' });
  const dateHtml = `<span class="${options.dateClass || `release-date-display text-xs leading-none whitespace-nowrap ${data.yearMismatch ? 'text-red-500' : 'text-gray-500'}`}"
    ${data.yearMismatch ? `title="${escapeHtml(data.yearMismatchTooltip || '')}"` : ''}>${escapeHtml(dateText || '')}</span>`;
  const wrappedDateHtml = options.dateWrapperClass
    ? `<div class="${options.dateWrapperClass}">${dateHtml}</div>`
    : dateHtml;

  return `<div class="${options.wrapperClass || 'h-full shrink-0 w-[88px] flex flex-col items-center justify-evenly pl-0.5'}">
    <div class="${options.coverClass || `mobile-album-cover relative w-20 h-20 flex items-center justify-center ${!coverSrc ? 'bg-gray-800 rounded-lg' : ''} ${coverSrc && loadMode === 'initial' ? 'cover-reveal-shell' : ''}`}">
      ${coverExtraHtml}
      ${
        coverSrc
          ? renderCoverImage({
              src: coverSrc,
              fullSrc: data.coverImageUrl || coverSrc,
              alt: data.albumName,
              className:
                options.imageClassName ||
                'w-full h-full rounded-lg object-cover',
              loadMode,
              fallbackHtml: placeholderHtml,
            })
          : placeholderHtml
      }
    </div>
    ${wrappedDateHtml}
    ${availabilityHtml}
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
    ${badgesHtml ? `<div class="absolute flex items-center" style="top: 50%; right: 4px; transform: translateY(-50%); gap: 4px">${badgesHtml}</div>` : ''}
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
      : data.genre1 || data.genre2 || options.fallback || '';
  const valueSpanClass = options.valueSpanClass
    ? ` class="${options.valueSpanClass}"`
    : '';

  return `<div class="${options.wrapperClass || 'flex items-center'}">
    <span class="${options.textClass || 'text-[12px] text-gray-400 truncate'}" title="${escapeHtml(value || options.fallback || '')}">
      <i class="${options.iconClass || 'fas fa-music fa-xs inline-block w-4 text-center mr-1'}"></i><span data-field="genre-mobile-text"${valueSpanClass}>${value ? escapeHtml(value) : options.emptyHtml || ''}</span>
    </span>
  </div>`;
}

export function renderMobilePlaycountRow(data) {
  return `<div class="flex items-center">
    ${mobilePlaycountSpan(data.itemId, data.playcountDisplay)}
  </div>`;
}
