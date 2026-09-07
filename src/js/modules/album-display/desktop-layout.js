import { escapeHtmlAttr as escapeHtml } from '../html-utils.js';
import { computeGridTemplate } from '../column-config.js';
import { renderDesktopCoverCell } from './cover-parts.js';
import {
  renderDesktopAlbumCell,
  renderDesktopArtistCell,
  renderDesktopGenreCell,
} from './render-parts.js';
import { escapePlaycountData } from './layout-data.js';

function renderTrack(data, secondary, editable) {
  const prefix = secondary ? 'secondary' : 'primary';
  const display = data[`${prefix}TrackDisplay`];
  const duration = data[`${prefix}TrackDuration`];
  return `<div class="flex items-center min-w-0${secondary ? ' mt-1' : ''} overflow-hidden w-full">
    <span class="inline-block w-5 text-center mr-1 shrink-0 text-2xs font-semibold font-[Georgia,serif] text-green-400" title="${secondary ? 'Secondary' : 'Primary'} track">${secondary ? 'II' : 'I'}:</span>
    <span data-field="${prefix}-track-text" class="album-cell-text ${escapeHtml(data[`${prefix}TrackClass`] || 'text-gray-300')} truncate${editable ? ' hover:text-gray-100' : ''}${secondary ? ' text-sm' : ''} flex-1 min-w-0" title="${escapeHtml(data[`${prefix}Track`] || '')}">${escapeHtml(display || '')}</span>
    ${duration ? `<span data-field="${prefix}-track-duration" class="text-xs text-gray-500 shrink-0 ml-2 tabular-nums">(${escapeHtml(duration)})</span>` : ''}
  </div>`;
}

function renderComment(value, secondary, editable) {
  const cellClass = secondary ? 'comment-2' : 'comment';
  const textClass = value
    ? `text-gray-300${editable ? ' hover:text-gray-100' : ''}`
    : `text-transparent${editable ? ' hover:text-gray-600' : ''} italic`;
  return `<div class="flex items-center ${cellClass}-cell relative${secondary ? '' : ' border-l border-gray-700'} pl-2 self-stretch">
    <span class="album-cell-text ${textClass} line-clamp-2${editable ? ' cursor-pointer' : ''} ${cellClass}-text">${escapeHtml(value || (editable ? (secondary ? 'Comment 2' : 'Comment') : ''))}</span>
  </div>`;
}

/**
 * Pure composition using column-config definitions supplied by the caller.
 * html is cell content; outerHTML includes the row. HTML slots and coverOptions
 * are trusted internal presentation, while album fields are unescaped text.
 */
export function renderDesktopAlbumRow(
  data,
  index,
  {
    columns,
    visibleColumns = columns,
    editable = false,
    badgeHTML = '',
    badgeState = '',
    includePlaycount = false,
    includeAvailability = true,
    includeAvailabilityLinks = false,
    includeTaxonomy = false,
    coverOptions = {},
  }
) {
  const interactiveClass = editable
    ? ' cursor-pointer hover:text-gray-100'
    : '';
  const genreOptions = {
    interactive: editable,
    includeTitle: !editable,
    ...(editable ? {} : { emptyText: '' }),
  };
  const cellMap = {
    position:
      data.position != null
        ? `<div class="position-cell flex items-center justify-center text-gray-400 font-medium text-sm position-display" data-position-element="true">${escapeHtml(data.position)}</div>`
        : '<div class="position-cell"></div>',
    cover: renderDesktopCoverCell(data, index, coverOptions),
    album: renderDesktopAlbumCell(
      includePlaycount ? escapePlaycountData(data) : data,
      {
        alwaysShowReleaseDate: true,
        badgesHtml: badgeHTML,
        badgeState,
        includePlaycount,
        includeAvailability,
        includeAvailabilityLinks,
        includeTaxonomy,
        includeTitle: !editable,
      }
    ),
    artist: renderDesktopArtistCell(data, {
      interactive: editable,
      includeTitle: !editable,
    }),
    country: `<div class="flex items-center country-cell">
      <span class="album-cell-text ${escapeHtml(data.countryClass || 'text-gray-300')} truncate${interactiveClass}"${editable ? '' : ` title="${escapeHtml(data.country || '')}"`}>${escapeHtml(editable ? data.countryDisplay : data.country || '')}</span>
    </div>`,
    genre_1: renderDesktopGenreCell(data, 1, genreOptions),
    genre_2: renderDesktopGenreCell(data, 2, genreOptions),
    track: `<div class="flex flex-col justify-start track-cell min-w-0${editable ? ' cursor-pointer' : ''} overflow-hidden">
      ${
        data.primaryTrackDisplay
          ? renderTrack(data, false, editable)
          : editable
            ? '<div class="flex items-center min-w-0"><span class="album-cell-text text-gray-800 italic hover:text-gray-100">Select Track</span></div>'
            : ''
      }
      ${data.hasSecondaryTrack ? renderTrack(data, true, editable) : ''}
    </div>`,
    comment: renderComment(data.comment, false, editable),
    comment_2: renderComment(data.comment2, true, editable),
  };
  const visibleIds = new Set(visibleColumns.map((column) => column.id));
  const html = columns
    .map((column) => {
      const cell = cellMap[column.id];
      if (typeof cell !== 'string') {
        throw new Error(`Unsupported album column: ${column.id}`);
      }
      return visibleIds.has(column.id)
        ? cell
        : cell.replace(/^(<div\s+class=")/, '$1column-hidden ');
    })
    .join('\n');
  const className = 'album-row album-grid gap-4 py-2';
  const gridTemplate = computeGridTemplate(visibleColumns);
  return {
    className,
    gridTemplate,
    html,
    outerHTML: `<div class="${className}" data-index="${escapeHtml(String(index))}" style="grid-template-columns: ${escapeHtml(gridTemplate)}">${html}</div>`,
  };
}

export function renderDesktopAlbumHeader({
  columns,
  visibleColumns = columns,
}) {
  const headerExtras = {
    position: ' text-center',
    album: ' pl-2',
    comment: ' pl-2',
    comment_2: ' pl-2',
  };
  const visibleIds = new Set(visibleColumns.map((column) => column.id));
  const html = columns
    .map((column) => {
      const hidden = visibleIds.has(column.id) ? '' : ' column-hidden';
      return `<div class="${escapeHtml(column.cellClass)}${headerExtras[column.id] || ''}${hidden}">${escapeHtml(column.label)}</div>`;
    })
    .join('\n        ');
  const className =
    'album-header album-grid gap-4 py-2 text-[0.8125rem] font-medium text-gray-200 border-b border-gray-800 sticky top-0 z-10 shrink-0';
  const gridTemplate = computeGridTemplate(visibleColumns);
  return {
    className,
    gridTemplate,
    html,
    outerHTML: `<div class="${className}" style="align-items: center; grid-template-columns: ${escapeHtml(gridTemplate)}">${html}</div>`,
  };
}
