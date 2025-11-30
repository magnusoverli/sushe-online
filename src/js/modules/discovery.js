/**
 * Discovery Module
 *
 * Handles Last.fm-based music discovery features:
 * - Similar artists (based on album's artist)
 * - Personal recommendations (based on listening history)
 *
 * @module discovery
 */

import { showToast } from './utils.js';

// Module state
let discoveryModal = null;
let _currentModalType = null; // Prefixed with _ as it's set but used for future features
let userLists = [];

/**
 * Initialize the discovery module
 */
export function initDiscovery() {
  createModalElement();
  fetchUserLists();
}

/**
 * Fetch user's lists for the "Add to..." dropdown
 */
async function fetchUserLists() {
  try {
    const response = await fetch('/api/user/lists-summary', {
      credentials: 'include',
    });
    if (response.ok) {
      const data = await response.json();
      userLists = data.lists || [];
    }
  } catch (err) {
    console.error('Failed to fetch user lists:', err);
  }
}

/**
 * Refresh user lists (call after adding album)
 */
export function refreshUserLists() {
  fetchUserLists();
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
    'hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="discovery-modal-content bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
      <!-- Modal Header -->
      <div class="p-4 sm:p-6 border-b border-gray-800 flex items-center justify-between flex-shrink-0">
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
      
      <!-- Modal Content (scrollable) -->
      <div id="discoveryModalContent" class="p-4 sm:p-6 overflow-y-auto flex-grow">
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
 * Show the discovery modal
 * @param {string} type - 'similar' or 'recommendations'
 * @param {Object} data - Additional data (e.g., artist name for similar)
 */
export function showDiscoveryModal(type, data = {}) {
  if (!discoveryModal) {
    createModalElement();
  }

  _currentModalType = type;
  const content = discoveryModal.querySelector('#discoveryModalContent');
  const title = discoveryModal.querySelector('#discoveryModalTitle');
  const subtitle = discoveryModal.querySelector('#discoveryModalSubtitle');
  const icon = discoveryModal.querySelector('#discoveryModalIcon');

  // Set header based on type
  if (type === 'similar') {
    title.textContent = 'Similar Artists';
    subtitle.textContent = `Based on ${data.artist || 'selected artist'}`;
    icon.className = 'fas fa-users text-xl text-purple-400';
  } else {
    title.textContent = 'Recommendations';
    subtitle.textContent = 'Based on your Last.fm listening history';
    icon.className = 'fas fa-lightbulb text-xl text-yellow-400';
  }

  // Show loading state
  content.innerHTML = renderSkeletonLoaders();

  // Show modal
  discoveryModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Fetch data
  if (type === 'similar') {
    fetchSimilarArtists(data.artist);
  } else {
    fetchRecommendations();
  }
}

/**
 * Hide the discovery modal
 */
export function hideDiscoveryModal() {
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
      <div class="w-16 h-16 bg-gray-700 rounded flex-shrink-0"></div>
      <div class="flex-grow">
        <div class="h-4 bg-gray-700 rounded w-3/4 mb-2"></div>
        <div class="h-3 bg-gray-700 rounded w-1/2 mb-2"></div>
        <div class="h-3 bg-gray-700 rounded w-1/4"></div>
      </div>
      <div class="w-24 h-8 bg-gray-700 rounded flex-shrink-0"></div>
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
      <button class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors" onclick="${retryAction}">
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

  try {
    const response = await fetch(
      `/api/lastfm/similar-artists?artist=${encodeURIComponent(artistName)}&limit=20`,
      { credentials: 'include' }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch similar artists');
    }

    const data = await response.json();

    if (!data.artists || data.artists.length === 0) {
      content.innerHTML = renderEmptyState(
        'No similar artists found for this artist.'
      );
      return;
    }

    content.innerHTML = renderSimilarArtistsList(data.artists);
  } catch (err) {
    console.error('Error fetching similar artists:', err);
    content.innerHTML = renderErrorState(
      'Failed to load similar artists.',
      `window.discoveryRetry('similar', '${artistName.replace(/'/g, "\\'")}')`
    );
  }
}

/**
 * Fetch recommendations from API
 */
async function fetchRecommendations() {
  const content = discoveryModal.querySelector('#discoveryModalContent');
  const subtitle = discoveryModal.querySelector('#discoveryModalSubtitle');

  try {
    const response = await fetch('/api/lastfm/recommendations', {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to fetch recommendations');
    }

    const data = await response.json();

    if (!data.albums || data.albums.length === 0) {
      content.innerHTML = renderEmptyState(
        data.message ||
          'No recommendations available. Add genres to your albums!'
      );
      return;
    }

    // Update subtitle to show what genres recommendations are based on
    if (data.basedOn && data.basedOn.length > 0) {
      const genreList = data.basedOn.map((g) => capitalizeGenre(g)).join(', ');
      subtitle.textContent = `Based on: ${genreList}`;
    }

    content.innerHTML = renderRecommendationsList(data.albums);
    attachAddButtonHandlers();
  } catch (err) {
    console.error('Error fetching recommendations:', err);
    content.innerHTML = renderErrorState(
      'Failed to load recommendations.',
      "window.discoveryRetry('recommendations')"
    );
  }
}

/**
 * Capitalize genre name properly
 * @param {string} genre - Genre name in lowercase
 * @returns {string} Capitalized genre
 */
function capitalizeGenre(genre) {
  if (!genre) return '';
  return genre
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
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
 * Render similar artists list
 * @param {Array} artists - Array of artist objects
 */
function renderSimilarArtistsList(artists) {
  const items = artists
    .map((artist) => {
      const matchPercent = Math.round(artist.match * 100);
      const rymUrl = getRymArtistUrl(artist.name);
      const hasImage = artist.image && artist.image.trim() !== '';

      return `
      <div class="flex items-center gap-3 sm:gap-4 p-3 bg-gray-800 rounded-lg hover:bg-gray-750 transition-colors">
        <!-- Artist Image -->
        <div class="w-12 h-12 sm:w-14 sm:h-14 bg-gray-700 rounded-full flex-shrink-0 overflow-hidden">
          ${
            hasImage
              ? `<img src="${artist.image}" alt="" class="w-full h-full object-cover" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center\\'><i class=\\'fas fa-user text-gray-500\\'></i></div>'">`
              : '<div class="w-full h-full flex items-center justify-center"><i class="fas fa-user text-gray-500"></i></div>'
          }
        </div>
        
        <!-- Info -->
        <div class="flex-grow min-w-0">
          <p class="font-semibold text-white truncate">${escapeHtml(artist.name)}</p>
          <p class="text-xs text-purple-400">${matchPercent}% match</p>
        </div>
        
        <!-- RateYourMusic Link -->
        <div class="flex-shrink-0">
          <a href="${rymUrl}" target="_blank" rel="noopener noreferrer"
             class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors whitespace-nowrap inline-flex items-center gap-1">
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
 * Render recommendations list
 * @param {Array} albums - Array of album objects
 */
function renderRecommendationsList(albums) {
  const items = albums
    .map((album) => {
      const playcount = album.playcount
        ? album.playcount.toLocaleString()
        : '0';
      const genreLabel = album.genre ? capitalizeGenre(album.genre) : '';
      const isNewArtist = album.isNewArtist;

      return `
      <div class="flex items-center gap-3 sm:gap-4 p-3 bg-gray-800 rounded-lg hover:bg-gray-750 transition-colors">
        <!-- Album Image -->
        <div class="w-14 h-14 sm:w-16 sm:h-16 bg-gray-700 rounded flex-shrink-0 overflow-hidden">
          ${
            album.image
              ? `<img src="${album.image}" alt="" class="w-full h-full object-cover" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center\\'><i class=\\'fas fa-compact-disc text-gray-600\\'></i></div>'">`
              : '<div class="w-full h-full flex items-center justify-center"><i class="fas fa-compact-disc text-gray-600"></i></div>'
          }
        </div>
        
        <!-- Info -->
        <div class="flex-grow min-w-0">
          <p class="font-semibold text-white truncate">
            ${escapeHtml(album.artist)}
            ${isNewArtist ? '<span class="ml-1 text-xs text-green-400" title="New artist for you">NEW</span>' : ''}
          </p>
          <p class="text-sm text-gray-400 truncate">${escapeHtml(album.album)}</p>
          <p class="text-xs text-gray-500">
            ${genreLabel ? `<span class="text-yellow-500">${escapeHtml(genreLabel)}</span> · ` : ''}${playcount} plays
          </p>
        </div>
        
        <!-- Add Button -->
        <div class="flex-shrink-0">
          <button class="add-to-list-btn px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors whitespace-nowrap"
               data-artist="${escapeHtml(album.artist)}"
               data-album="${escapeHtml(album.album)}"
               data-mbid="${album.mbid || ''}">
            <i class="fas fa-plus mr-1"></i><span class="hidden sm:inline">Add to...</span><span class="sm:hidden">Add</span>
          </button>
        </div>
      </div>
    `;
    })
    .join('');

  return `<div class="space-y-2">${items}</div>`;
}

/**
 * Attach click handlers to "Add to..." buttons
 */
function attachAddButtonHandlers() {
  const buttons = discoveryModal.querySelectorAll('.add-to-list-btn');

  buttons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showListSelector(btn);
    });
  });
}

/**
 * Show the list selector popover
 * @param {HTMLElement} button - The button that was clicked
 */
function showListSelector(button) {
  // Remove any existing popover
  const existingPopover = document.querySelector('.list-selector-popover');
  if (existingPopover) existingPopover.remove();

  const artist = button.dataset.artist;
  const album = button.dataset.album;
  const mbid = button.dataset.mbid;

  // Create popover
  const popover = document.createElement('div');
  popover.className =
    'list-selector-popover fixed bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-[60] py-2 max-h-64 overflow-y-auto min-w-48';

  if (userLists.length === 0) {
    popover.innerHTML = `
      <div class="px-4 py-3 text-sm text-gray-400">
        <p>No lists available.</p>
        <p class="text-xs mt-1">Create a list first.</p>
      </div>
    `;
  } else {
    popover.innerHTML = `
      <div class="px-3 py-2 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-700">Select List</div>
      ${userLists
        .map(
          (list) => `
        <button class="list-option w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                data-list-name="${escapeHtml(list.name)}"
                data-list-id="${list.id}">
          <i class="fas fa-list mr-2 text-gray-500"></i>${escapeHtml(list.name)}
          ${list.year ? `<span class="text-xs text-gray-500 ml-1">(${list.year})</span>` : ''}
        </button>
      `
        )
        .join('')}
    `;
  }

  document.body.appendChild(popover);

  // Position popover near the button
  const buttonRect = button.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();

  let left = buttonRect.left;
  let top = buttonRect.bottom + 4;

  // Adjust if overflowing right
  if (left + popoverRect.width > window.innerWidth - 16) {
    left = window.innerWidth - popoverRect.width - 16;
  }

  // Adjust if overflowing bottom
  if (top + popoverRect.height > window.innerHeight - 16) {
    top = buttonRect.top - popoverRect.height - 4;
  }

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;

  // Add click handlers to list options
  popover.querySelectorAll('.list-option').forEach((option) => {
    option.addEventListener('click', () => {
      const listName = option.dataset.listName;
      addAlbumToList(artist, album, mbid, listName, button);
      popover.remove();
    });
  });

  // Close on click outside
  const closeHandler = (e) => {
    if (!popover.contains(e.target) && e.target !== button) {
      popover.remove();
      document.removeEventListener('click', closeHandler);
    }
  };

  // Delay adding the listener to avoid immediate trigger
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
  }, 0);
}

/**
 * Add album to list using MusicBrainz flow
 * @param {string} artist - Artist name
 * @param {string} album - Album name
 * @param {string} mbid - MusicBrainz ID (optional)
 * @param {string} listName - Target list name
 * @param {HTMLElement} button - The button element to update
 */
async function addAlbumToList(artist, album, mbid, listName, button) {
  // Update button to show loading
  const originalContent = button.innerHTML;
  button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  button.disabled = true;

  try {
    // Use the app's existing album search/add flow
    // This triggers the MusicBrainz lookup and proper album addition
    const searchEvent = new CustomEvent('discovery-add-album', {
      detail: { artist, album, mbid, listName },
    });
    window.dispatchEvent(searchEvent);

    // The actual addition will be handled by app.js listening to this event
    // For now, show success state
    button.innerHTML = '<i class="fas fa-check text-green-400"></i>';
    button.classList.remove('bg-gray-700', 'hover:bg-gray-600');
    button.classList.add('bg-gray-800');

    // Update button to show which list
    setTimeout(() => {
      button.outerHTML = `<span class="text-xs text-gray-500 whitespace-nowrap">Adding to "${escapeHtml(listName)}"...</span>`;
    }, 500);
  } catch (err) {
    console.error('Error adding album:', err);
    button.innerHTML = originalContent;
    button.disabled = false;
    showToast('Failed to add album', 'error');
  }
}

/**
 * Escape HTML to prevent XSS
 * @param {string} str - String to escape
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Retry function (exposed globally for onclick handlers)
 */
window.discoveryRetry = (type, artist) => {
  if (type === 'similar' && artist) {
    const content = discoveryModal.querySelector('#discoveryModalContent');
    content.innerHTML = renderSkeletonLoaders();
    fetchSimilarArtists(artist);
  } else if (type === 'recommendations') {
    const content = discoveryModal.querySelector('#discoveryModalContent');
    content.innerHTML = renderSkeletonLoaders();
    fetchRecommendations();
  }
};

// Export for use in app.js
export { fetchUserLists };
