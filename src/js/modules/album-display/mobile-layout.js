import { escapeHtmlAttr as escapeHtml } from '../html-utils.js';
import { renderMobileCoverSection } from './cover-parts.js';
import {
  renderMobileArtistRow,
  renderMobileDisqualificationSlot,
  renderMobileGenreRow,
  renderMobilePlaycountRow,
  renderMobilePositionBadge,
  renderMobileTitleRow,
} from './render-parts.js';
import { escapePlaycountData } from './layout-data.js';

const OWNER_MENU_HTML = `<button data-album-menu-btn class="no-drag text-gray-400 active:text-gray-200" style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
  <i class="fas fa-ellipsis-v fa-fw"></i>
</button>`;

function renderTrack(data, secondary, editable) {
  const prefix = secondary ? 'secondary' : 'primary';
  const display = data[`${prefix}TrackDisplay`];
  const duration = data[`${prefix}TrackDuration`];
  const playable = editable && Boolean(display);
  const playbackAttrs = editable
    ? ` data-track-play-btn="${playable ? 'true' : ''}" data-track-identifier="${escapeHtml(data[`${prefix}Track`] || '')}"`
    : '';
  return `<div class="flex items-center ${playable ? 'cursor-pointer active:opacity-70' : ''}"${playbackAttrs}>
    <span class="text-[12px] text-green-400 flex min-w-0 w-full">
      <span class="inline-block w-5 text-center mr-1 shrink-0 text-2xs font-semibold font-[Georgia,serif]">${secondary ? 'II' : 'I'}:</span><span data-field="${secondary ? 'secondary-' : ''}track-mobile-text" class="truncate flex-1 min-w-0">${escapeHtml(display || '')}</span>${duration ? `<span data-field="${prefix}-track-mobile-duration" class="shrink-0 ml-1 tabular-nums">(${escapeHtml(duration)})</span>` : ''}
    </span>
  </div>`;
}

/**
 * Pure 145px card composition. html is card content; outerHTML includes both
 * card and sortable wrapper. badgeHTML/menuHTML/coverOptions are trusted
 * internal slots, never unescaped server content. No handlers are attached.
 */
export function renderMobileAlbumCard(
  data,
  index,
  {
    editable = false,
    includePlaycount = false,
    includeTracks = false,
    badgeHTML = '',
    badgeState = '',
    badgePaddingRight = !editable && data.position != null ? '25px' : '0px',
    includeAvailability = true,
    includeAvailabilityLinks = false,
    coverOptions = {},
    menuHTML = editable ? OWNER_MENU_HTML : '',
  } = {}
) {
  const paddingRight = escapeHtml(badgePaddingRight);
  // Keep the cover part's h-full: .album-row > div overrides flex stretching.
  // The 130px info stack sits inside the shared 145px card and wrapper.
  const html = `
    ${renderMobilePositionBadge(data.position == null ? null : escapeHtml(data.position))}
    <div class="flex items-stretch h-full">
      ${renderMobileCoverSection(data, index, {
        includeAvailability,
        includeAvailabilityLinks,
        coverExtraHtml: renderMobileDisqualificationSlot(data),
        ...coverOptions,
      })}
      <div class="flex-1 min-w-0 pl-0.5 pr-1 flex flex-col justify-evenly h-[130px] leading-[18px]">
        ${renderMobileTitleRow(data, { paddingRight, badgesHtml: badgeHTML, badgeState, stackBadges: true })}
        ${renderMobileArtistRow(data, { paddingRight })}
        ${includePlaycount ? renderMobilePlaycountRow(escapePlaycountData(data), { paddingRight }) : ''}
        <div data-mobile-badge-padding class="flex items-center" style="padding-right: ${paddingRight}">
          <span class="text-[12px] text-gray-400">
            <i class="fas fa-globe fa-xs inline-block w-4 text-center mr-1"></i><span data-field="country-mobile-text">${escapeHtml(data.country || '')}</span>
          </span>
        </div>
        ${renderMobileGenreRow(data, { paddingRight })}
        ${includeTracks ? `${renderTrack(data, false, editable)}${renderTrack(data, true, editable)}` : ''}
      </div>
      ${
        menuHTML
          ? `<div class="shrink-0 w-[30px] border-l border-gray-700/80" style="display: flex; align-items: center; justify-content: center;">${menuHTML}</div>`
          : ''
      }
    </div>
  `;
  const wrapperClassName = 'album-card-wrapper h-[145px]';
  const className = 'album-card album-row relative h-[145px] bg-gray-900';
  return {
    wrapperClassName,
    className,
    html,
    outerHTML: `<div class="${wrapperClassName}"><div class="${className}" data-index="${escapeHtml(String(index))}">${html}</div></div>`,
  };
}
