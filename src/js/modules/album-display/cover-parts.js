import { escapeHtmlAttr as escapeHtml } from '../html-utils.js';
import { PLACEHOLDER_GIF } from '../album-display-shared.js';
import { renderAvailabilityBadges } from './availability-badges.js';

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

function compactErrorHtml(html) {
  return html.replace(/\n\s*/g, '');
}

function renderErrorAttr(errorHtml) {
  if (!errorHtml) return '';

  const handler = `this.onerror=null; this.parentElement.innerHTML=${JSON.stringify(compactErrorHtml(errorHtml))}`;
  return ` onerror="${escapeHtml(handler)}"`;
}

export function renderCoverImage({
  src,
  fullSrc,
  alt,
  className,
  loadMode,
  errorHtml = '',
}) {
  const escapedSrc = escapeHtml(src);
  const escapedFullSrc = escapeHtml(fullSrc || src);
  const escapedAlt = escapeHtml(alt || '');
  const errorAttr = renderErrorAttr(errorHtml);

  if (loadMode === 'lazy') {
    return `<img src="${escapedSrc}"
      data-full-src="${escapedFullSrc}"
      alt="${escapedAlt}"
      class="${className}"
      loading="lazy"
      decoding="async"${errorAttr}
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
      fetchpriority="high"${errorAttr}
    >`;
  }

  return `<img src="${PLACEHOLDER_GIF}"
    data-lazy-src="${escapedSrc}"
    data-full-src="${escapedFullSrc}"
    alt="${escapedAlt}"
    class="${className}"
    loading="eager"
    decoding="async"
    fetchpriority="low"${errorAttr}
  >`;
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
              errorHtml: placeholderHtml,
            })
          : placeholderHtml
      }
      ${badgesHtml}
    </div>
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
              errorHtml: placeholderHtml,
            })
          : placeholderHtml
      }
    </div>
    ${wrappedDateHtml}
    ${availabilityHtml}
  </div>`;
}
