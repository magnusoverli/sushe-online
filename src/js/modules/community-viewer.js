import {
  renderDesktopAlbumHeader,
  renderDesktopAlbumRow,
} from './album-display/desktop-layout.js';
import { renderMobileAlbumCard } from './album-display/mobile-layout.js';
import { getAllColumns, getVisibleColumns } from './column-config.js';
import { formatReleaseDate } from './date-utils.js';
import {
  attachMobileCoverPlayback,
  createAlbumDisplayShared,
} from './album-display-shared.js';

// Preserve the revealed-list projection; presentation reuse does not expand it.
const COMMUNITY_COLUMNS = new Set([
  'position',
  'cover',
  'album',
  'artist',
  'country',
  'genre_1',
  'genre_2',
]);

const { loadCoverImages: initializeCommunityCovers } = createAlbumDisplayShared(
  {
    computeGridTemplate: () => '',
    getVisibleColumns: () => [],
    getToggleableColumns: () => [],
    isColumnVisible: () => true,
  }
);

function normalizeItem(item = {}, index = 0) {
  return {
    position: item.position ?? index + 1,
    albumId: item.albumId || '',
    albumName: item.album || 'Unknown Album',
    artist: item.artist || 'Unknown Artist',
    releaseDate: formatReleaseDate(item.releaseDate || ''),
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

export function renderCommunityList(detail = {}) {
  const items = Array.isArray(detail.items)
    ? detail.items.map(normalizeItem)
    : [];

  if (items.length === 0) {
    return `<div class="community-list-view text-center text-gray-500 mt-20 px-4">
      <p class="text-lg">This user list is empty.</p>
    </div>`;
  }

  const columns = getAllColumns().filter((col) =>
    COMMUNITY_COLUMNS.has(col.id)
  );
  const visibleColumns = getVisibleColumns().filter((col) =>
    COMMUNITY_COLUMNS.has(col.id)
  );
  const options = {
    columns,
    visibleColumns,
    editable: false,
    includeAvailability: false,
    coverOptions: { loadMode: 'lazy' },
  };
  return `<div class="community-list-view w-full" data-read-only="true">
    <div class="hidden md:block">
      ${renderDesktopAlbumHeader(options).outerHTML}
      <div class="album-rows-container relative flex-1">
        ${items.map((item, index) => renderDesktopAlbumRow(item, index, options).outerHTML).join('')}
      </div>
    </div>
    <div class="mobile-album-list md:hidden">
      ${items.map((item, index) => renderMobileAlbumCard(item, index, options).outerHTML).join('')}
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
    deactivateOwnedView,
    attachDesktopCoverPreview,
    closeCoverPreview,
  } = deps;

  let activeCommunityListId = null;
  let requestController = null;
  let currentDetail = null;

  function getActiveCommunityListId() {
    return activeCommunityListId;
  }

  function clearSelection() {
    requestController?.abort();
    requestController = null;
    activeCommunityListId = null;
    currentDetail = null;
    closeCoverPreview?.();
  }

  function updateCommunityHeader(title) {
    updateHeaderTitle(title);
    doc?.getElementById('headerAddAlbumBtn')?.classList.add('hidden');
  }

  function attachPlaybackHandlers(container, items) {
    container
      ?.querySelectorAll('.mobile-album-list .album-card')
      .forEach((card) => {
        const item = items[Number(card.dataset.index)];
        attachMobileCoverPlayback(card, () =>
          playCommunityAlbum(item, playAlbumByMetadata, showToast)
        );
      });
    container
      ?.querySelectorAll('.album-rows-container .album-cover')
      .forEach((image) => attachDesktopCoverPreview?.(image));
  }

  function renderCurrentDetail() {
    const container = doc?.getElementById('albumContainer');
    if (!container || !currentDetail || !activeCommunityListId) return;
    container.innerHTML = renderCommunityList(currentDetail);
    initializeCommunityCovers(container);
    attachPlaybackHandlers(
      container,
      Array.isArray(currentDetail.items) ? currentDetail.items : []
    );
  }

  // Apply viewer column preferences without reading or writing anyone's list.
  const win = deps.win || doc?.defaultView;
  win?.addEventListener('columnvisibilitychange', renderCurrentDetail);

  async function selectCommunityList(listId, summary = {}) {
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    currentDetail = null;

    const previousListId = getCurrentListId();
    deactivateOwnedView?.();
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
        currentDetail = detail;
        renderCurrentDetail();
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
