/**
 * Discovery Module
 *
 * Handles Last.fm-based music discovery features:
 * - Similar artists (based on album's artist)
 *
 * @module discovery
 */

import { escapeHtml } from './html-utils.js';
import { apiCall } from './utils.js';

// Lazy-loaded to avoid pulling in the 508KB musicbrainz chunk at startup.
// searchArtistImageRacing is only needed when viewing similar artists.
let _searchArtistImageRacing = null;

async function getSearchArtistImageRacing() {
  if (!_searchArtistImageRacing) {
    const mod = await import('../musicbrainz.js');
    _searchArtistImageRacing = mod.searchArtistImageRacing;
  }
  return _searchArtistImageRacing;
}

// Module state
let discoveryModal = null;
let similarArtistsAbortController = null;

/**
 * Initialize the discovery module
 */
export function initDiscovery() {
  createModalElement();
}

/**
 * Create the modal element and add it to the DOM
 */
function createModalElement() {
  // Remove existing modal if any
  const existing = document.getElementById('discoveryModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'discoveryModal';
  modal.className =
    'hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 safe-area-modal';
  modal.innerHTML = `
    <div class="discovery-modal-content bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
      <!-- Modal Header -->
      <div class="p-4 sm:p-6 border-b border-gray-800 shrink-0">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <i id="discoveryModalIcon" class="fas fa-music text-xl text-gray-400"></i>
            <div>
              <h3 id="discoveryModalTitle" class="text-lg sm:text-xl font-bold text-white">Discovery</h3>
              <p id="discoveryModalSubtitle" class="text-sm text-gray-500"></p>
            </div>
          </div>
          <button id="discoveryModalClose" class="text-gray-500 hover:text-white transition-colors p-2">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
      </div>
      
      <!-- Modal Content (scrollable) -->
      <div id="discoveryModalContent" class="p-4 sm:p-6 overflow-y-auto grow">
        <!-- Content loaded dynamically -->
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  discoveryModal = modal;

  // Close button handler
  modal
    .querySelector('#discoveryModalClose')
    .addEventListener('click', hideDiscoveryModal);

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      hideDiscoveryModal();
    }
  });

  // Escape key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      hideDiscoveryModal();
    }
  });
}

/**
 * Show the discovery modal for similar artists
 * @param {string} type - 'similar' (only type supported now)
 * @param {Object} data - Additional data (e.g., artist name for similar)
 */
export function showDiscoveryModal(type, data = {}) {
  if (!discoveryModal) {
    createModalElement();
  }

  // Only 'similar' type is supported now
  if (type !== 'similar') {
    console.warn('Only similar artists discovery is currently supported');
    return;
  }

  const content = discoveryModal.querySelector('#discoveryModalContent');
  const title = discoveryModal.querySelector('#discoveryModalTitle');
  const subtitle = discoveryModal.querySelector('#discoveryModalSubtitle');
  const icon = discoveryModal.querySelector('#discoveryModalIcon');

  // Set header for similar artists
  title.textContent = 'Similar Artists';
  subtitle.textContent = `Based on ${data.artist || 'selected artist'}`;
  icon.className = 'fas fa-users text-xl text-purple-400';

  // Show loading state
  content.innerHTML = renderSkeletonLoaders();

  // Show modal
  discoveryModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Fetch similar artists
  fetchSimilarArtists(data.artist);
}

/**
 * Hide the discovery modal
 */
export function hideDiscoveryModal() {
  // Abort any ongoing artist image searches
  if (similarArtistsAbortController) {
    similarArtistsAbortController.abort();
    similarArtistsAbortController = null;
  }

  if (discoveryModal) {
    discoveryModal.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

/**
 * Render skeleton loaders
 */
function renderSkeletonLoaders() {
  const skeletons = Array(5)
    .fill(0)
    .map(
      () => `
    <div class="flex items-center gap-4 p-3 rounded-lg animate-pulse">
      <div class="w-16 h-16 bg-gray-700 rounded-sm shrink-0"></div>
      <div class="grow">
        <div class="h-4 bg-gray-700 rounded-sm w-3/4 mb-2"></div>
        <div class="h-3 bg-gray-700 rounded-sm w-1/2 mb-2"></div>
        <div class="h-3 bg-gray-700 rounded-sm w-1/4"></div>
      </div>
      <div class="w-24 h-8 bg-gray-700 rounded-sm shrink-0"></div>
    </div>
  `
    )
    .join('');

  return `<div class="space-y-3">${skeletons}</div>`;
}

/**
 * Render empty state
 * @param {string} message - Message to display
 */
function renderEmptyState(message) {
  return `
    <div class="text-center py-12">
      <i class="fas fa-search text-4xl text-gray-600 mb-4"></i>
      <p class="text-gray-400">${message}</p>
    </div>
  `;
}

/**
 * Render error state
 * @param {string} message - Error message
 * @param {Function} retryFn - Retry function name as string
 */
function renderErrorState(message, retryAction) {
  return `
    <div class="text-center py-12">
      <i class="fas fa-exclamation-circle text-4xl text-red-500 mb-4"></i>
      <p class="text-gray-400 mb-4">${message}</p>
      <button class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-sm transition-colors" onclick="${retryAction}">
        <i class="fas fa-redo mr-2"></i>Try Again
      </button>
    </div>
  `;
}

/**
 * Fetch similar artists from API
 * @param {string} artistName - Artist name to find similar artists for
 */
async function fetchSimilarArtists(artistName) {
  const content = discoveryModal.querySelector('#discoveryModalContent');

  // Abort any previous artist image searches
  if (similarArtistsAbortController) {
    similarArtistsAbortController.abort();
  }
  similarArtistsAbortController = new AbortController();

  try {
    const data = await apiCall(
      `/api/lastfm/similar-artists?artist=${encodeURIComponent(artistName)}&limit=20`
    );

    if (!data.artists || data.artists.length === 0) {
      content.innerHTML = renderEmptyState(
        'No similar artists found for this artist.'
      );
      return;
    }

    content.innerHTML = renderSimilarArtistsList(data.artists);

    // Lazy-load artist images using the racing provider system
    loadSimilarArtistImages(data.artists, similarArtistsAbortController.signal);
  } catch (err) {
    console.error('Error fetching similar artists:', err);
    content.innerHTML = renderErrorState(
      'Failed to load similar artists.',
      `window.discoveryRetry('similar', '${artistName.replace(/'/g, "\\'")}')`
    );
  }
}

/**
 * Create RateYourMusic URL for an artist
 * @param {string} artistName - Artist name
 * @returns {string} RYM artist URL
 */
function getRymArtistUrl(artistName) {
  // RYM uses lowercase, hyphens for spaces, and removes most special characters
  const slug = artistName
    .toLowerCase()
    .replace(/['']/g, '') // Remove apostrophes
    .replace(/&/g, 'and') // Replace & with and
    .replace(/[^\w\s-]/g, '') // Remove special chars except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Trim leading/trailing hyphens

  return `https://rateyourmusic.com/artist/${slug}`;
}

/**
 * Load artist images for similar artists using the racing provider system
 * @param {Array} artists - Array of artist objects
 * @param {AbortSignal} signal - Abort signal to cancel on modal close
 */
async function loadSimilarArtistImages(artists, signal) {
  for (const artist of artists) {
    if (signal?.aborted) return;

    // Escape special characters for use in CSS selector
    const escapedName = artist.name.replace(/["\\]/g, '\\$&');
    const container = discoveryModal?.querySelector(
      `.artist-image-container[data-artist="${escapedName}"]`
    );
    if (!container) continue;

    // Search for artist image using racing providers (Deezer, iTunes, Wikidata)
    getSearchArtistImageRacing()
      .then((searchFn) => searchFn(artist.name, null, signal))
      .then((imageUrl) => {
        if (signal?.aborted) return;
        if (imageUrl && container) {
          container.classList.remove('animate-pulse');
          container.innerHTML = `
            <img src="${imageUrl}" alt="" class="w-full h-full object-cover" loading="lazy"
                 onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center\\'><i class=\\'fas fa-user text-gray-500\\'></i></div>'">
          `;
        } else if (container) {
          // No image found - remove pulse and show icon
          container.classList.remove('animate-pulse');
        }
      })
      .catch(() => {
        // Error - remove pulse animation
        if (container) {
          container.classList.remove('animate-pulse');
        }
      });
  }
}

/**
 * Render similar artists list
 * @param {Array} artists - Array of artist objects
 */
function renderSimilarArtistsList(artists) {
  const items = artists
    .map((artist) => {
      const matchPercent = Math.round(artist.match * 100);
      const rymUrl = getRymArtistUrl(artist.name);

      return `
      <div class="flex items-center gap-3 sm:gap-4 p-3 bg-gray-800 rounded-lg hover:bg-gray-750 transition-colors">
        <!-- Artist Image (lazy-loaded) -->
        <div class="artist-image-container w-12 h-12 sm:w-14 sm:h-14 bg-gray-700 rounded-full shrink-0 overflow-hidden animate-pulse flex items-center justify-center"
             data-artist="${escapeHtml(artist.name)}">
          <i class="fas fa-user text-gray-500"></i>
        </div>
        
        <!-- Info -->
        <div class="grow min-w-0">
          <p class="font-semibold text-white truncate">${escapeHtml(artist.name)}</p>
          <p class="text-xs text-purple-400">${matchPercent}% match</p>
        </div>
        
        <!-- RateYourMusic Link -->
        <div class="shrink-0">
          <a href="${rymUrl}" target="_blank" rel="noopener noreferrer"
             class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-sm transition-colors whitespace-nowrap inline-flex items-center gap-1">
            <i class="fas fa-external-link-alt text-xs"></i>
            <span class="hidden sm:inline">RYM</span>
          </a>
        </div>
      </div>
    `;
    })
    .join('');

  return `<div class="space-y-2">${items}</div>`;
}

/**
 * Retry function (exposed globally for onclick handlers)
 */
window.discoveryRetry = (type, artist) => {
  if (type === 'similar' && artist) {
    const content = discoveryModal.querySelector('#discoveryModalContent');
    content.innerHTML = renderSkeletonLoaders();
    fetchSimilarArtists(artist);
  }
};
