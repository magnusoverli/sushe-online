import { escapeHtml } from './html-utils.js';
import {
  renderDesktopCoverCell,
  renderMobileCoverSection,
} from './album-display/cover-parts.js';
import {
  attachMobileCoverPlayback,
  createAlbumDisplayShared,
} from './album-display-shared.js';
import {
  renderDesktopAlbumCell,
  renderDesktopArtistCell,
  renderDesktopGenreCell,
  renderMobileArtistRow,
  renderMobileDisqualificationSlot,
  renderMobileGenreRow,
  renderMobilePositionBadge,
  renderMobileTitleRow,
} from './album-display/render-parts.js';

const { loadCoverImages: initializeCommunityCovers } = createAlbumDisplayShared(
  {
    computeGridTemplate: () => '',
    getVisibleColumns: () => [],
    getToggleableColumns: () => [],
    isColumnVisible: () => true,
  }
);

function normalizeItem(item = {}) {
  return {
    position: item.position,
    albumId: item.albumId || '',
    albumName: item.album || 'Unknown Album',
    artist: item.artist || 'Unknown Artist',
    releaseDate: item.releaseDate || '',
    country: item.country || '',
    genre1: item.genre1 || '',
    genre2: item.genre2 || '',
    genre1Display: item.genre1 || '',
    genre2Display: item.genre2 || '',
    isDisqualified: item.isDisqualified === true,
    disqualificationReason: item.disqualificationReason || '',
    coverImageUrl: item.coverImageUrl || '',
    coverThumbUrl: item.coverThumbnailUrl || item.coverImageUrl || '',
    availability: [],
  };
}

function renderDesktopItem(item, index) {
  const position = item.position ?? index + 1;
  return `<div class="community-album-row grid grid-cols-[3rem_4rem_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,.6fr)_minmax(0,.7fr)_minmax(0,.7fr)] gap-3 items-center px-4 py-3 border-b border-gray-800">
    <div class="position-cell text-center text-sm font-semibold text-gray-300">${escapeHtml(position)}</div>
    ${renderDesktopCoverCell(item, index, {
      cellClass: 'cover-cell flex items-center justify-center',
      loadMode: 'lazy',
    })}
    ${renderDesktopAlbumCell(item, {
      alwaysShowReleaseDate: true,
      cellClass: 'album-cell flex flex-col justify-center min-w-0',
      includeAvailability: false,
      includePlaycount: false,
      includeTitle: true,
    })}
    ${renderDesktopArtistCell(item, {
      cellClass: 'artist-cell flex items-center min-w-0',
      includeTitle: true,
      interactive: false,
      textClass: 'text-gray-300',
    })}
    <div class="country-cell flex items-center min-w-0">
      <span class="album-cell-text text-gray-400 truncate" title="${escapeHtml(item.country)}">${escapeHtml(item.country)}</span>
    </div>
    ${renderDesktopGenreCell(item, 1, {
      cellClass: 'genre-1-cell flex items-center min-w-0',
      emptyText: '',
      includeTitle: true,
      interactive: false,
      textClass: 'text-gray-400',
    })}
    ${renderDesktopGenreCell(item, 2, {
      cellClass: 'genre-2-cell flex items-center min-w-0',
      emptyText: '',
      includeTitle: true,
      interactive: false,
      textClass: 'text-gray-400',
    })}
  </div>`;
}

function renderMobileItem(item, index) {
  const position = item.position ?? index + 1;
  return `<article class="community-album-card album-card album-row relative h-[130px] bg-gray-900" data-community-item-index="${index}">
    ${renderMobilePositionBadge(position)}
    <div class="flex items-stretch h-full">
      ${renderMobileCoverSection(item, index, {
        coverExtraHtml: renderMobileDisqualificationSlot(item),
        includeAvailability: false,
        loadMode: 'lazy',
        wrapperClass:
          'h-full shrink-0 w-[88px] flex flex-col items-center justify-evenly pl-0.5',
      })}
      <div class="flex-1 min-w-0 pl-0.5 pr-3 flex flex-col justify-evenly h-[130px] leading-[18px]">
        ${renderMobileTitleRow(item)}
        ${renderMobileArtistRow(item)}
        <div class="flex items-center min-w-0">
          <span class="text-[12px] text-gray-400 truncate min-w-0" title="${escapeHtml(item.country)}">
            <i class="fas fa-globe fa-xs inline-block w-4 text-center mr-1"></i>${escapeHtml(item.country)}
          </span>
        </div>
        ${renderMobileGenreRow(item)}
      </div>
    </div>
  </article>`;
}

export function renderCommunityList(detail = {}) {
  const items = Array.isArray(detail.items)
    ? detail.items.map(normalizeItem)
    : [];

  if (items.length === 0) {
    return `<div class="community-list-view text-center text-gray-500 mt-20 px-4">
      <p class="text-lg">This user list is empty.</p>
    </div>`;
  }

  return `<div class="community-list-view w-full">
    <div class="hidden md:block">
      <div class="grid grid-cols-[3rem_4rem_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,.6fr)_minmax(0,.7fr)_minmax(0,.7fr)] gap-3 px-4 py-2 text-xs font-semibold text-gray-500 border-b border-gray-700 sticky top-0 bg-gray-950 z-10">
        <span class="text-center">#</span><span>Cover</span><span>Album</span><span>Artist</span><span>Country</span><span>Genre 1</span><span>Genre 2</span>
      </div>
      ${items.map(renderDesktopItem).join('')}
    </div>
    <div class="md:hidden">
      ${items.map(renderMobileItem).join('')}
    </div>
  </div>`;
}

export function playCommunityAlbum(item, playAlbumByMetadata, showToast) {
  if (!item?.artist || !item?.album) {
    showToast?.('Could not find album data', 'error');
    return false;
  }
  if (typeof playAlbumByMetadata !== 'function') {
    showToast?.('Play album is unavailable', 'error');
    return false;
  }

  playAlbumByMetadata(item.artist, item.album, {
    albumId: item.albumId,
    releaseDate: item.releaseDate,
  });
  return true;
}

export function createCommunityViewer(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const {
    apiCall,
    setCurrentListId,
    getCurrentListId,
    setCurrentRecommendationsYear,
    getRealtimeSyncModuleInstance,
    updateListNavActiveState,
    updateHeaderTitle,
    showLoadingSpinner,
    showToast,
    playAlbumByMetadata,
  } = deps;

  let activeCommunityListId = null;
  let requestController = null;

  function getActiveCommunityListId() {
    return activeCommunityListId;
  }

  function clearSelection() {
    requestController?.abort();
    requestController = null;
    activeCommunityListId = null;
  }

  function updateCommunityHeader(title) {
    updateHeaderTitle(title);
    doc?.getElementById('headerAddAlbumBtn')?.classList.add('hidden');
  }

  function attachPlaybackHandlers(container, items) {
    container
      ?.querySelectorAll('[data-community-item-index]')
      .forEach((card) => {
        const item = items[Number(card.dataset.communityItemIndex)];
        attachMobileCoverPlayback(card, () =>
          playCommunityAlbum(item, playAlbumByMetadata, showToast)
        );
      });
  }

  async function selectCommunityList(listId, summary = {}) {
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;

    const previousListId = getCurrentListId();
    const rtSync = getRealtimeSyncModuleInstance();
    if (rtSync && previousListId) {
      rtSync.unsubscribeFromList(previousListId);
    }

    setCurrentListId('');
    setCurrentRecommendationsYear(null);
    activeCommunityListId = listId;
    updateListNavActiveState('', null, listId);

    const owner = summary.owner?.username || '';
    updateCommunityHeader(
      `${owner} · ${summary.year || ''} · ${summary.name || ''}`
    );

    const fab = doc?.getElementById('addAlbumFAB');
    if (fab) fab.style.display = 'none';

    const container = doc?.getElementById('albumContainer');
    if (container) showLoadingSpinner(container);

    try {
      const detail = await apiCall(
        `/api/community/main-lists/${encodeURIComponent(listId)}`,
        { signal: controller.signal }
      );
      if (
        controller.signal.aborted ||
        requestController !== controller ||
        activeCommunityListId !== listId
      ) {
        return;
      }

      const username = detail.owner?.username || owner;
      updateCommunityHeader(
        `${username} · ${detail.year || summary.year || ''} · ${detail.name || summary.name || ''}`
      );
      if (container) {
        container.innerHTML = renderCommunityList(detail);
        initializeCommunityCovers(container);
        attachPlaybackHandlers(
          container,
          Array.isArray(detail.items) ? detail.items : []
        );
      }
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) return;
      if (container && activeCommunityListId === listId) {
        container.innerHTML = `<div class="community-list-view text-center text-red-300 mt-20 px-4">
          <p>Could not load this user list.</p>
        </div>`;
      }
      showToast?.('Error loading user list', 'error');
    }
  }

  return {
    clearSelection,
    getActiveCommunityListId,
    selectCommunityList,
  };
}
