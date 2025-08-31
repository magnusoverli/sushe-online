/* eslint-disable no-console */
// Global variables
let lists = {};
let currentList = '';
let currentContextAlbum = null;
let currentContextAlbumId = null; // Store album identity as backup
let currentContextList = null;
const _genres = [];
const _countries = [];
let listEventSource = null;
let sseUpdateTimeout = null;
let availableGenres = [];
let availableCountries = [];
let pendingImportData = null;
let pendingImportFilename = null;
let confirmationCallback = null;

// Track loading performance optimization variables
let trackAbortController = null;
let lastLoadedAlbumIndex = null;
const trackMenuCache = new Map();

// Context menu variables

// Position-based points mapping
const POSITION_POINTS = {
  1: 60,
  2: 54,
  3: 50,
  4: 46,
  5: 43,
  6: 40,
  7: 38,
  8: 36,
  9: 34,
  10: 32,
  11: 30,
  12: 29,
  13: 28,
  14: 27,
  15: 26,
  16: 25,
  17: 24,
  18: 23,
  19: 22,
  20: 21,
  21: 20,
  22: 19,
  23: 18,
  24: 17,
  25: 16,
  26: 15,
  27: 14,
  28: 13,
  29: 12,
  30: 11,
  31: 10,
  32: 9,
  33: 8,
  34: 7,
  35: 6,
  36: 5,
  37: 4,
  38: 3,
  39: 2,
  40: 1,
};

window.selectList = selectList;

// Hide context menus when clicking elsewhere
document.addEventListener('click', () => {
  const contextMenu = document.getElementById('contextMenu');
  if (contextMenu) {
    contextMenu.classList.add('hidden');
  }

  const albumContextMenu = document.getElementById('albumContextMenu');
  if (albumContextMenu) {
    albumContextMenu.classList.add('hidden');
    // Clear context album references when menu is hidden
    currentContextAlbum = null;
    currentContextAlbumId = null;

    // Cancel any pending track fetches
    if (trackAbortController) {
      trackAbortController.abort();
      trackAbortController = null;
    }
  }
});

// Prevent default context menu on right-click in list nav
document.addEventListener('contextmenu', (e) => {
  const listButton = e.target.closest('#listNav button');
  if (listButton) {
    e.preventDefault();
  }
});

// Helper function to get points for a position
function getPointsForPosition(position) {
  return POSITION_POINTS[position] || 1; // Default to 1 point for positions > 40
}

function showConfirmation(
  title,
  message,
  subMessage,
  confirmText = 'Confirm',
  onConfirm = null
) {
  const modal = document.getElementById('confirmationModal');
  const titleEl = document.getElementById('confirmationTitle');
  const messageEl = document.getElementById('confirmationMessage');
  const subMessageEl = document.getElementById('confirmationSubMessage');
  const confirmBtn = document.getElementById('confirmationConfirmBtn');
  const cancelBtn = document.getElementById('confirmationCancelBtn');

  titleEl.textContent = title;
  messageEl.textContent = message;
  subMessageEl.textContent = subMessage || '';
  confirmBtn.textContent = confirmText;

  // If onConfirm is provided, use callback style
  if (onConfirm) {
    confirmationCallback = onConfirm;
    modal.classList.remove('hidden');
    setTimeout(() => confirmBtn.focus(), 100);
    return;
  }

  // Otherwise return a promise for async/await style
  return new Promise((resolve) => {
    const handleConfirm = () => {
      modal.classList.add('hidden');
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdropClick);
      resolve(true);
    };

    const handleCancel = () => {
      modal.classList.add('hidden');
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdropClick);
      resolve(false);
    };

    const handleBackdropClick = (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleBackdropClick);

    modal.classList.remove('hidden');
    setTimeout(() => confirmBtn.focus(), 100);
  });
}

function hideConfirmation() {
  const modal = document.getElementById('confirmationModal');
  modal.classList.add('hidden');
  confirmationCallback = null;
}

// Show modal to choose a music service
function showServicePicker(hasSpotify, hasTidal) {
  const modal = document.getElementById('serviceSelectModal');
  const spotifyBtn = document.getElementById('serviceSpotifyBtn');
  const tidalBtn = document.getElementById('serviceTidalBtn');
  const cancelBtn = document.getElementById('serviceCancelBtn');

  if (!modal || !spotifyBtn || !tidalBtn || !cancelBtn) {
    return Promise.resolve(null);
  }

  spotifyBtn.classList.toggle('hidden', !hasSpotify);
  tidalBtn.classList.toggle('hidden', !hasTidal);

  modal.classList.remove('hidden');

  return new Promise((resolve) => {
    const cleanup = () => {
      modal.classList.add('hidden');
      spotifyBtn.onclick = null;
      tidalBtn.onclick = null;
      cancelBtn.onclick = null;
      modal.onclick = null;
      document.removeEventListener('keydown', escHandler);
    };

    const escHandler = (e) => {
      if (e.key === 'Escape') {
        cleanup();
        resolve(null);
      }
    };

    spotifyBtn.onclick = () => {
      cleanup();
      resolve('spotify');
    };
    tidalBtn.onclick = () => {
      cleanup();
      resolve('tidal');
    };
    cancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };
    modal.onclick = (e) => {
      if (e.target === modal) {
        cleanup();
        resolve(null);
      }
    };

    document.addEventListener('keydown', escHandler);
  });
}

// Standardize date formats for release dates
function formatReleaseDate(dateStr) {
  if (!dateStr) return '';

  const userFormat = window.currentUser?.dateFormat || 'MM/DD/YYYY';

  // Year only
  if (/^\d{4}$/.test(dateStr)) {
    return dateStr;
  }

  // Year-month
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    const [year, month] = dateStr.split('-');
    return `${month}/${year}`;
  }

  const iso = normalizeDateForInput(dateStr);
  if (!iso) return dateStr;

  const [year, month, day] = iso.split('-');

  if (userFormat === 'DD/MM/YYYY') {
    return `${day}/${month}/${year}`;
  }
  return `${month}/${day}/${year}`;
}

// Convert various date formats to ISO YYYY-MM-DD for date input fields
function normalizeDateForInput(dateStr) {
  if (!dateStr) return '';

  const userFormat = window.currentUser?.dateFormat;

  // Year only
  if (/^\d{4}$/.test(dateStr)) {
    return `${dateStr}-01-01`;
  }

  // Year-month
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    return `${dateStr}-01`;
  }

  // ISO already
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Formats like DD/MM/YYYY or MM/DD/YYYY or with dashes
  const parts = dateStr.split(/[/-]/);
  if (
    parts.length === 3 &&
    /^\d{1,2}$/.test(parts[0]) &&
    /^\d{1,2}$/.test(parts[1]) &&
    /^\d{4}$/.test(parts[2])
  ) {
    const first = parseInt(parts[0], 10);
    const second = parseInt(parts[1], 10);
    const year = parts[2];
    let day, month;
    if (first > 12) {
      day = first;
      month = second;
    } else if (second > 12) {
      month = first;
      day = second;
    } else if (userFormat === 'DD/MM/YYYY') {
      day = first;
      month = second;
    } else {
      month = first;
      day = second;
    }
    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  }

  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }

  return '';
}

// Convert YYYY-MM-DD to the user's preferred format
function formatDateForStorage(isoDate) {
  if (!isoDate) return '';
  const userFormat = window.currentUser?.dateFormat || 'MM/DD/YYYY';
  const [year, month, day] = isoDate.split('-');
  if (userFormat === 'DD/MM/YYYY') {
    return `${day}/${month}/${year}`;
  }
  return `${month}/${day}/${year}`;
}

// Load available countries
async function loadCountries() {
  try {
    const response = await fetch('/countries.txt');
    const text = await response.text();
    availableCountries = text
      .split('\n')
      .map((c) => c.trim())
      .filter((c, index, _arr) => {
        // Keep the first empty line if it exists, but remove other empty lines
        return c.length > 0 || (index === 0 && c === '');
      });
    // Don't sort if the first item is empty - keep it at the top
    if (availableCountries[0] !== '') {
      availableCountries.sort();
    } else {
      // Sort everything except the first empty item
      const emptyItem = availableCountries.shift();
      availableCountries.sort();
      availableCountries.unshift(emptyItem);
    }
  } catch (error) {
    showToast('Error saving list order', 'error');
    // Revert the change
    const [revertItem] = list.splice(newIndex, 1);
    list.splice(oldIndex, 0, revertItem);
    displayAlbums(lists[currentList]);
  }
}

async function downloadListAsJSON(listName) {
  try {
    // Get the list data
    const listData = lists[listName];

    if (!listData) {
      showToast('List not found', 'error');
      return;
    }

    // Create a copy with rank added based on position
    const exportData = listData.map((album, index) => {
      const exported = { ...album };
      exported.rank = index + 1;
      exported.points = getPointsForPosition(index + 1);
      return exported;
    });

    // Convert to JSON with pretty formatting
    const jsonStr = JSON.stringify(exportData, null, 2);

    // Create blob and file
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const fileName = `${listName}.json`;

    // Check if we're on mobile and if Web Share API is available
    const isMobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      );

    if (isMobile && navigator.share) {
      try {
        // Create a File object (required for sharing files)
        const file = new File([blob], fileName, { type: 'application/json' });

        // Check if the browser can share files
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: listName,
            text: `Album list export: ${listName}`,
          });
          showToast('List shared successfully');
          return;
        }
      } catch (shareError) {
        console.warn('Share API failed, falling back to download:', shareError);
        // Fall through to regular download
      }
    }

    // Regular download for desktop or if share fails
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;

    // For iOS Safari, we need to handle this slightly differently
    if (window.navigator.userAgent.match(/iPhone|iPad|iPod/i)) {
      // iOS devices
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }

    document.body.appendChild(a);
    a.click();

    // Clean up
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);

    showToast(`Downloaded "${listName}"`);
  } catch (error) {
    showToast('Error downloading list', 'error');
  }
}

// Test function to verify confirmation dialog works
window.testConfirmation = async function () {
  const result = await showConfirmation(
    'Test Dialog',
    'This is a test message',
    'This is a sub-message',
    'Confirm'
  );
  return result;
};

// Update Spotify/Tidal playlist for the given list
async function updatePlaylist(listName) {
  try {
    // First check if playlist exists
    showToast('Checking for existing playlist...', 'info');

    let checkResult;
    try {
      checkResult = await apiCall(
        `/api/playlists/${encodeURIComponent(listName)}`,
        {
          method: 'POST',
          body: JSON.stringify({ action: 'check' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } catch (checkError) {
      // If check fails, proceed with update anyway
      checkResult = { exists: false };
    }

    // If playlist exists, ask for confirmation
    if (checkResult && checkResult.exists === true) {
      const confirmed = await showConfirmation(
        'Replace Existing Playlist?',
        `A playlist named "${listName}" already exists in your music service. Do you want to replace it with the current list?`,
        'This will replace all tracks in the existing playlist.',
        'Replace'
      );

      if (!confirmed) {
        showToast('Playlist update cancelled', 'info');
        return;
      }
    }

    // Show progress indicator
    showToast('Updating playlist...', 'info');

    // Create/update the playlist
    const result = await apiCall(
      `/api/playlists/${encodeURIComponent(listName)}`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'update' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    // Show success message with results
    if (result.playlistUrl) {
      const action = result.replacedExisting ? 'replaced' : 'created';
      showToast(
        `Playlist ${action} successfully! ${result.successful || 0} tracks added, ${result.failed || 0} failed`,
        'success'
      );
    } else {
      showToast('Playlist updated successfully!', 'success');
    }
  } catch (error) {
    console.error('Error updating playlist:', error);

    // Handle specific error cases
    if (error.response) {
      try {
        const errorData = await error.response.json();

        if (errorData.code === 'NO_SERVICE') {
          // Show a more helpful message with action button
          const toastEl = showToast(
            'No music service selected! Please choose Spotify or Tidal as your preferred service in Settings.',
            'error',
            8000 // Show for 8 seconds
          );

          // Add a button to go to settings
          if (toastEl && typeof toastEl === 'object') {
            const actionBtn = document.createElement('button');
            actionBtn.className =
              'ml-3 text-blue-400 hover:text-blue-300 underline text-sm';
            actionBtn.textContent = 'Go to Settings';
            actionBtn.onclick = () => (window.location.href = '/settings');
            toastEl.querySelector('.toast-message')?.appendChild(actionBtn);
          }
          return;
        } else if (errorData.code === 'NOT_AUTHENTICATED') {
          showToast(
            `Please reconnect your ${errorData.service || 'music'} account in settings`,
            'error'
          );
          return;
        }

        // Show the actual error message if available
        if (errorData.error) {
          // For NO_SERVICE errors, add a link to settings
          if (errorData.code === 'NO_SERVICE') {
            const toastEl = showToast(errorData.error, 'error', 8000);
            if (toastEl && toastEl.querySelector) {
              const actionBtn = document.createElement('a');
              actionBtn.href = '/settings';
              actionBtn.className =
                'ml-3 text-blue-400 hover:text-blue-300 underline text-sm';
              actionBtn.textContent = 'Go to Settings →';
              const messageEl =
                toastEl.querySelector('.text-sm') ||
                toastEl.querySelector('div');
              if (messageEl) messageEl.appendChild(actionBtn);
            }
          } else {
            showToast(errorData.error, 'error');
          }
          return;
        }
      } catch (parseError) {
        // If we can't parse the error, show generic message
      }
    }

    showToast(
      'Error updating playlist. Please check your music service connection.',
      'error'
    );
  }
}
window.updatePlaylist = updatePlaylist;

// Show playlist validation modal before creating playlist
async function showPlaylistValidationModal(listName, validation) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className =
      'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
        <h3 class="text-lg font-semibold text-white mb-4">Create Playlist "${listName}"</h3>
        
        <div class="space-y-3 mb-6">
          <div class="flex items-center text-green-400">
            <i class="fas fa-check mr-2"></i>
            <span>${validation.totalAlbums} albums in list</span>
          </div>
          
          ${
            validation.albumsWithTracks > 0
              ? `
            <div class="flex items-center text-green-400">
              <i class="fas fa-music mr-2"></i>
              <span>${validation.albumsWithTracks} albums with selected tracks</span>
            </div>
          `
              : ''
          }
          
          ${
            validation.albumsWithoutTracks > 0
              ? `
            <div class="flex items-center text-yellow-400">
              <i class="fas fa-exclamation-triangle mr-2"></i>
              <span>${validation.albumsWithoutTracks} albums will be skipped (no selected tracks)</span>
            </div>
          `
              : ''
          }
          
          <div class="flex items-center text-blue-400">
            <i class="fas fa-list mr-2"></i>
            <span>Estimated ${validation.estimatedTracks} tracks</span>
          </div>
        </div>

        ${
          validation.warnings.length > 0
            ? `
          <div class="bg-yellow-900 border border-yellow-600 rounded p-3 mb-4">
            <h4 class="text-yellow-400 font-medium mb-2">Warnings:</h4>
            <ul class="text-yellow-300 text-sm space-y-1">
              ${validation.warnings.map((w) => `<li>• ${w}</li>`).join('')}
            </ul>
          </div>
        `
            : ''
        }

        <div class="flex space-x-3">
          <button id="cancelPlaylist" class="flex-1 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors">
            Cancel
          </button>
          <button id="proceedPlaylist" class="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors" ${!validation.canProceed ? 'disabled' : ''}>
            ${validation.canProceed ? 'Create Playlist' : 'Cannot Proceed'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const cancelBtn = modal.querySelector('#cancelPlaylist');
    const proceedBtn = modal.querySelector('#proceedPlaylist');

    cancelBtn.onclick = () => {
      document.body.removeChild(modal);
      resolve(false);
    };

    proceedBtn.onclick = () => {
      document.body.removeChild(modal);
      resolve(true);
    };

    // Close on backdrop click
    modal.onclick = (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
        resolve(false);
      }
    };
  });
}

// Show progress modal during playlist creation
function showPlaylistProgressModal(listName) {
  const modal = document.createElement('div');
  modal.className =
    'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
      <h3 class="text-lg font-semibold text-white mb-4">Creating Playlist "${listName}"</h3>
      
      <div class="space-y-4">
        <div class="flex items-center text-blue-400">
          <i class="fas fa-spinner fa-spin mr-2"></i>
          <span>Processing albums...</span>
        </div>
        
        <div class="bg-gray-700 rounded-full h-2">
          <div class="bg-blue-600 h-2 rounded-full transition-all duration-300" style="width: 0%" id="progressBar"></div>
        </div>
        
        <div id="progressText" class="text-gray-400 text-sm">
          Preparing...
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

// Hide progress modal
function hidePlaylistProgressModal(modal) {
  if (modal && modal.parentNode) {
    document.body.removeChild(modal);
  }
}

// Show playlist creation results
function showPlaylistResultModal(listName, result) {
  const modal = document.createElement('div');
  modal.className =
    'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';

  const successRate =
    result.processed > 0
      ? Math.round((result.successful / result.processed) * 100)
      : 0;
  const isSuccess = result.successful > 0;

  modal.innerHTML = `
    <div class="bg-gray-800 rounded-lg p-6 max-w-lg w-full mx-4 max-h-96 overflow-y-auto">
      <h3 class="text-lg font-semibold text-white mb-4">
        Playlist "${listName}" ${isSuccess ? 'Created' : 'Failed'}
      </h3>
      
      <div class="space-y-3 mb-6">
        <div class="flex items-center ${isSuccess ? 'text-green-400' : 'text-red-400'}">
          <i class="fas ${isSuccess ? 'fa-check' : 'fa-times'} mr-2"></i>
          <span>${result.successful}/${result.processed} tracks added successfully (${successRate}%)</span>
        </div>
        
        ${
          result.playlistUrl
            ? `
          <div class="flex items-center text-blue-400">
            <i class="fab fa-${result.service} mr-2"></i>
            <a href="${result.playlistUrl}" target="_blank" class="hover:underline">Open in ${result.service}</a>
          </div>
        `
            : ''
        }
        
        ${
          result.failed > 0
            ? `
          <div class="flex items-center text-yellow-400">
            <i class="fas fa-exclamation-triangle mr-2"></i>
            <span>${result.failed} tracks could not be found</span>
          </div>
        `
            : ''
        }
      </div>

      ${
        result.errors.length > 0
          ? `
        <div class="bg-red-900 border border-red-600 rounded p-3 mb-4 max-h-32 overflow-y-auto">
          <h4 class="text-red-400 font-medium mb-2">Issues:</h4>
          <ul class="text-red-300 text-sm space-y-1">
            ${result.errors
              .slice(0, 10)
              .map((error) => `<li>• ${error}</li>`)
              .join('')}
            ${result.errors.length > 10 ? `<li>• ... and ${result.errors.length - 10} more</li>` : ''}
          </ul>
        </div>
      `
          : ''
      }

      <div class="flex justify-end">
        <button id="closeResult" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
          Close
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('#closeResult');
  closeBtn.onclick = () => {
    document.body.removeChild(modal);
  };

  // Close on backdrop click
  modal.onclick = (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  };

  // Show success toast
  if (isSuccess) {
    showToast(
      `Playlist "${listName}" created with ${result.successful} tracks`,
      'success'
    );
  }
}

// Show service selection modal when no preferred service is set
function showServiceSelectionModal(listName) {
  const modal = document.createElement('div');
  modal.className =
    'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
      <h3 class="text-lg font-semibold text-white mb-4">Choose Music Service</h3>
      
      <p class="text-gray-300 mb-6">
        You haven't set a preferred music service. Choose where to create the playlist "${listName}":
      </p>

      <div class="space-y-3 mb-6">
        <button id="chooseSpotify" class="w-full flex items-center justify-center px-4 py-3 bg-green-600 text-white rounded hover:bg-green-700 transition-colors">
          <i class="fab fa-spotify mr-2"></i>
          Create on Spotify
        </button>
        
        <button id="chooseTidal" class="w-full flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
          <i class="fas fa-music mr-2"></i>
          Create on Tidal
        </button>
      </div>

      <div class="flex justify-between items-center">
        <button id="cancelService" class="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors">
          Cancel
        </button>
        
        <a href="/settings" class="text-blue-400 hover:underline text-sm">
          Set default in settings
        </a>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const spotifyBtn = modal.querySelector('#chooseSpotify');
  const tidalBtn = modal.querySelector('#chooseTidal');
  const cancelBtn = modal.querySelector('#cancelService');

  spotifyBtn.onclick = async () => {
    document.body.removeChild(modal);
    await createPlaylistWithService(listName, 'spotify');
  };

  tidalBtn.onclick = async () => {
    document.body.removeChild(modal);
    await createPlaylistWithService(listName, 'tidal');
  };

  cancelBtn.onclick = () => {
    document.body.removeChild(modal);
  };

  // Close on backdrop click
  modal.onclick = (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  };
}

// Create playlist with specific service
async function createPlaylistWithService(listName, service) {
  try {
    const progressModal = showPlaylistProgressModal(listName);

    const result = await apiCall(
      `/api/playlists/${encodeURIComponent(listName)}`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'update', service }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    hidePlaylistProgressModal(progressModal);
    showPlaylistResultModal(listName, result);
  } catch (error) {
    console.error('Error creating playlist with service:', error);
    showToast(`Error creating playlist on ${service}`, 'error');
  }
}

// Initialize import conflict handling
function initializeImportConflictHandling() {
  const conflictModal = document.getElementById('importConflictModal');
  const renameModal = document.getElementById('importRenameModal');
  const conflictListNameSpan = document.getElementById('conflictListName');
  const originalImportNameSpan = document.getElementById('originalImportName');
  const importNewNameInput = document.getElementById('importNewName');

  // Check if elements exist before setting handlers
  const importOverwriteBtn = document.getElementById('importOverwriteBtn');
  const importRenameBtn = document.getElementById('importRenameBtn');
  const importMergeBtn = document.getElementById('importMergeBtn');
  const importCancelBtn = document.getElementById('importCancelBtn');
  const confirmImportRenameBtn = document.getElementById(
    'confirmImportRenameBtn'
  );
  const cancelImportRenameBtn = document.getElementById(
    'cancelImportRenameBtn'
  );

  if (
    !importOverwriteBtn ||
    !importRenameBtn ||
    !importMergeBtn ||
    !importCancelBtn
  ) {
    // Elements don't exist on this page, skip initialization
    return;
  }

  // Overwrite option
  importOverwriteBtn.onclick = async () => {
    if (!pendingImportData || !pendingImportFilename) return;

    conflictModal.classList.add('hidden');

    try {
      await saveList(pendingImportFilename, pendingImportData);
      updateListNav();
      selectList(pendingImportFilename);
      showToast(
        `Overwritten "${pendingImportFilename}" with ${pendingImportData.length} albums`
      );
    } catch (err) {
      console.error('Import overwrite error:', err);
      showToast('Error overwriting list', 'error');
    }

    pendingImportData = null;
    pendingImportFilename = null;
  };

  // Rename option
  importRenameBtn.onclick = () => {
    conflictModal.classList.add('hidden');
    originalImportNameSpan.textContent = pendingImportFilename;

    // Suggest a new name
    let suggestedName = pendingImportFilename;
    let counter = 1;
    while (lists[suggestedName]) {
      suggestedName = `${pendingImportFilename} (${counter})`;
      counter++;
    }
    importNewNameInput.value = suggestedName;

    renameModal.classList.remove('hidden');

    setTimeout(() => {
      importNewNameInput.focus();
      importNewNameInput.select();
    }, 100);
  };

  // Merge option
  importMergeBtn.onclick = async () => {
    if (!pendingImportData || !pendingImportFilename) return;

    conflictModal.classList.add('hidden');

    try {
      // Get existing list
      const existingList = lists[pendingImportFilename] || [];

      // Merge the lists (avoiding duplicates based on artist + album)
      const existingKeys = new Set(
        existingList.map((album) =>
          `${album.artist}::${album.album}`.toLowerCase()
        )
      );

      const newAlbums = pendingImportData.filter((album) => {
        const key = `${album.artist}::${album.album}`.toLowerCase();
        return !existingKeys.has(key);
      });

      const mergedList = [...existingList, ...newAlbums];

      await saveList(pendingImportFilename, mergedList);
      updateListNav();
      selectList(pendingImportFilename);

      const addedCount = newAlbums.length;
      const skippedCount = pendingImportData.length - addedCount;

      if (skippedCount > 0) {
        showToast(
          `Added ${addedCount} new albums, skipped ${skippedCount} duplicates`
        );
      } else {
        showToast(`Added ${addedCount} albums to "${pendingImportFilename}"`);
      }
    } catch (err) {
      console.error('Import merge error:', err);
      showToast('Error merging lists', 'error');
    }

    pendingImportData = null;
    pendingImportFilename = null;
  };

  // Cancel import
  importCancelBtn.onclick = () => {
    conflictModal.classList.add('hidden');
    pendingImportData = null;
    pendingImportFilename = null;
    showToast('Import cancelled');
  };

  // Rename modal handlers
  if (confirmImportRenameBtn) {
    confirmImportRenameBtn.onclick = async () => {
      const newName = importNewNameInput.value.trim();

      if (!newName) {
        showToast('Please enter a new name', 'error');
        return;
      }

      if (lists[newName]) {
        showToast('A list with this name already exists', 'error');
        return;
      }

      renameModal.classList.add('hidden');

      try {
        await saveList(newName, pendingImportData);
        updateListNav();
        selectList(newName);
        showToast(
          `Imported as "${newName}" with ${pendingImportData.length} albums`
        );
      } catch (err) {
        console.error('Import with rename error:', err);
        showToast('Error importing list', 'error');
      }

      pendingImportData = null;
      pendingImportFilename = null;
    };
  }

  if (cancelImportRenameBtn) {
    cancelImportRenameBtn.onclick = () => {
      renameModal.classList.add('hidden');
      // Go back to conflict modal
      document.getElementById('conflictListName').textContent =
        pendingImportFilename;
      conflictModal.classList.remove('hidden');
    };
  }

  // Enter key in rename input
  if (importNewNameInput) {
    importNewNameInput.onkeypress = (e) => {
      if (e.key === 'Enter' && confirmImportRenameBtn) {
        confirmImportRenameBtn.click();
      }
    };
  }
}

// Make country editable with datalist
function makeCountryEditable(countryDiv, albumIndex) {
  // Check if we're already editing
  if (countryDiv.querySelector('input')) {
    return;
  }

  // Get current country from the live data
  const currentCountry = lists[currentList][albumIndex].country || '';

  // Create input with datalist
  const input = document.createElement('input');
  input.type = 'text';
  input.className =
    'w-full bg-gray-800 text-gray-300 text-sm p-1 rounded border border-gray-700 focus:outline-none focus:border-red-600';
  input.value = currentCountry;
  input.placeholder = 'Type to search countries...';
  input.setAttribute('list', `country-list-${currentList}-${albumIndex}`);

  // Create datalist
  const datalist = document.createElement('datalist');
  datalist.id = `country-list-${currentList}-${albumIndex}`;

  // Add all available countries
  availableCountries.forEach((country) => {
    const option = document.createElement('option');
    option.value = country;
    datalist.appendChild(option);
  });

  // Store the original onclick handler
  const originalOnClick = countryDiv.onclick;
  countryDiv.onclick = null; // Temporarily remove click handler

  // Replace content with input and datalist
  countryDiv.innerHTML = '';
  countryDiv.appendChild(input);
  countryDiv.appendChild(datalist);
  input.focus();
  input.select();

  // Create handleClickOutside function so we can reference it for removal
  let handleClickOutside;

  const restoreDisplay = (valueToDisplay) => {
    // Remove the click outside listener if it exists
    if (handleClickOutside) {
      document.removeEventListener('click', handleClickOutside);
      handleClickOutside = null;
    }

    // Show placeholder if empty
    const displayValue = valueToDisplay || 'Country';
    const displayClass = valueToDisplay
      ? 'text-gray-300'
      : 'text-gray-500 italic';

    countryDiv.innerHTML = `<span class="text-sm ${displayClass} truncate cursor-pointer hover:text-gray-100">${displayValue}</span>`;

    // Restore the original click handler
    countryDiv.onclick = originalOnClick;
  };

  const saveCountry = async (newCountry) => {
    // Trim the input
    newCountry = newCountry.trim();

    // Check if value actually changed
    if (newCountry === currentCountry) {
      restoreDisplay(currentCountry);
      return;
    }

    // Update the data
    lists[currentList][albumIndex].country = newCountry;

    try {
      await saveList(currentList, lists[currentList]);
      restoreDisplay(newCountry);
      showToast(newCountry === '' ? 'Country cleared' : 'Country updated');
    } catch (error) {
      showToast('Error saving country', 'error');
      // Revert on error
      lists[currentList][albumIndex].country = currentCountry;
      restoreDisplay(currentCountry);
    }
  };

  // Handle input change (when selecting from datalist)
  input.addEventListener('change', (e) => {
    saveCountry(e.target.value);
  });

  // Handle blur (when clicking away)
  input.addEventListener('blur', () => {
    saveCountry(input.value);
  });

  // Handle keyboard
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveCountry(input.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      restoreDisplay(currentCountry);
    }
  });

  // Define handleClickOutside
  handleClickOutside = (e) => {
    if (!countryDiv.contains(e.target)) {
      saveCountry(input.value);
    }
  };

  // Small delay to prevent immediate trigger
  setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
  }, 100);
}

// Load available genres
async function loadGenres() {
  try {
    const response = await fetch('/genres.txt');
    const text = await response.text();
    availableGenres = text
      .split('\n')
      .map((g) => g.trim())
      .filter((g, index, arr) => {
        // Keep the first empty line if it exists, but remove other empty lines
        return g.length > 0 || (index === 0 && g === '');
      });
    // Don't sort if the first item is empty - keep it at the top
    if (availableGenres[0] !== '') {
      availableGenres.sort();
    } else {
      // Sort everything except the first empty item
      const emptyItem = availableGenres.shift();
      availableGenres.sort();
      availableGenres.unshift(emptyItem);
    }
  } catch (error) {
    console.error('Error loading genres:', error);
    showToast('Error loading genres', 'error');
  }
}

// Toast notification management
let toastTimer = null;

// Show toast notification with configurable duration
function showToast(message, type = 'success', duration = null) {
  const toast = document.getElementById('toast');

  // Clear any existing timer
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  // Remove 'show' class immediately to reset animation
  toast.classList.remove('show');

  toast.textContent = message;
  toast.className = 'toast ' + type;

  // Show the toast
  setTimeout(() => toast.classList.add('show'), 10);

  // Determine duration based on type and content
  if (duration === null) {
    // Default durations
    if (type === 'success' && message.includes('successfully')) {
      duration = 5000; // 5 seconds for success messages
    } else if (type === 'error') {
      duration = 5000; // 5 seconds for errors
    } else if (message.includes('...')) {
      duration = 10000; // 10 seconds for "loading" messages
    } else {
      duration = 3000; // 3 seconds for other messages
    }
  }

  // Set timer to hide the toast
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    toastTimer = null;
  }, duration);
}

// Make showToast globally available immediately
window.showToast = showToast;

// API helper functions
async function apiCall(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      credentials: 'same-origin',
    });

    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const error = new Error(`HTTP error! status: ${response.status}`);
      error.response = response;
      throw error;
    }

    return await response.json();
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
}

// Fetch link preview metadata
async function fetchLinkPreview(url) {
  try {
    return await apiCall(`/api/unfurl?url=${encodeURIComponent(url)}`);
  } catch (err) {
    console.error('Link preview error:', err);
    return null;
  }
}

function attachLinkPreview(container, comment) {
  const urlMatch = comment && comment.match(/https?:\/\/\S+/);
  if (!urlMatch) return;
  const url = urlMatch[0];
  const previewEl = document.createElement('div');
  previewEl.className = 'mt-2 text-xs bg-gray-800 rounded';
  previewEl.textContent = 'Loading preview...';
  container.appendChild(previewEl);
  fetchLinkPreview(url)
    .then((data) => {
      if (!data) {
        previewEl.remove();
        return;
      }
      const img = data.image
        ? `<img src="${data.image}" class="w-12 h-12 object-cover rounded flex-shrink-0" alt="">`
        : '';
      const desc = data.description
        ? `<div class="text-gray-400 truncate">${data.description}</div>`
        : '';
      previewEl.innerHTML = `<a href="${url}" target="_blank" class="flex gap-2 p-2 items-center">${img}<div class="min-w-0"><div class="font-semibold text-gray-100 truncate">${data.title || url}</div>${desc}</div></a>`;
    })
    .catch(() => previewEl.remove());
}

// Load lists from server
async function loadLists() {
  try {
    lists = await apiCall('/api/lists');
    window.lists = lists;
    updateListNav();
  } catch (error) {
    showToast('Error loading lists', 'error');
  }
}

// Save list to server
async function saveList(name, data) {
  try {
    // Clean up any stored points/ranks before saving
    const cleanedData = data.map((album) => {
      const cleaned = { ...album };
      delete cleaned.points;
      delete cleaned.rank;
      return cleaned;
    });

    await apiCall(`/api/lists/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify({ data: cleanedData }),
    });
    lists[name] = cleanedData;
  } catch (error) {
    showToast('Error saving list', 'error');
    throw error;
  }
}
// Expose saveList for other modules
window.saveList = saveList;

async function fetchTracksForAlbum(album, signal = null) {
  const params = new URLSearchParams({
    id: album.album_id || '',
    artist: album.artist,
    album: album.album,
  });

  const fetchOptions = {
    credentials: 'include',
  };

  // Add abort signal if provided
  if (signal) {
    fetchOptions.signal = signal;
  }

  const resp = await fetch(
    `/api/musicbrainz/tracks?${params.toString()}`,
    fetchOptions
  );
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Failed');
  album.tracks = data.tracks;
  return data.tracks;
}
window.fetchTracksForAlbum = fetchTracksForAlbum;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function autoFetchTracksForList(name) {
  const list = lists[name];
  if (!list) return;

  const toFetch = list.filter(
    (album) => !Array.isArray(album.tracks) || album.tracks.length === 0
  );
  if (toFetch.length === 0) return;

  let updated = false;
  for (const album of toFetch) {
    try {
      await fetchTracksForAlbum(album);
      updated = true;
    } catch (err) {
      console.error('Auto track fetch failed:', err);
    }
    await wait(3000);
  }

  if (updated) {
    try {
      await saveList(name, list);
    } catch (err) {
      console.error('Failed saving tracks for list', err);
    }
  }
}

function subscribeToList(name) {
  if (listEventSource) {
    listEventSource.close();
    listEventSource = null;
  }
  if (!name) return;

  listEventSource = new EventSource(
    `/api/lists/subscribe/${encodeURIComponent(name)}`,
    { withCredentials: true }
  );
  listEventSource.addEventListener('update', (e) => {
    try {
      const data = JSON.parse(e.data);

      // Debounce SSE updates to batch rapid changes
      clearTimeout(sseUpdateTimeout);
      sseUpdateTimeout = setTimeout(() => {
        // Prevent re-rendering if data hasn't actually changed (avoid self-updates)
        const currentData = lists[name];
        const hasChanged =
          !currentData || JSON.stringify(currentData) !== JSON.stringify(data);

        if (hasChanged) {
          lists[name] = data;
          if (currentList === name) {
            displayAlbums(data);
          }
        }
      }, 100);
    } catch (err) {
      console.error('Failed to parse SSE update', err);
    }
  });
  listEventSource.onerror = (err) => {
    console.error('SSE error', err);
  };
}

// Initialize context menu
function initializeContextMenu() {
  const contextMenu = document.getElementById('contextMenu');
  const downloadOption = document.getElementById('downloadListOption');
  const renameOption = document.getElementById('renameListOption');
  const updatePlaylistOption = document.getElementById('updatePlaylistOption');
  const deleteOption = document.getElementById('deleteListOption');

  if (
    !contextMenu ||
    !deleteOption ||
    !renameOption ||
    !downloadOption ||
    !updatePlaylistOption
  )
    return;

  // Update the playlist option text based on user's music service
  const updatePlaylistText = document.getElementById('updatePlaylistText');
  if (updatePlaylistText) {
    const musicService = window.currentUser?.musicService;
    const hasSpotify = window.currentUser?.spotifyAuth;
    const hasTidal = window.currentUser?.tidalAuth;

    if (musicService === 'spotify' && hasSpotify) {
      updatePlaylistText.textContent = 'Send to Spotify';
    } else if (musicService === 'tidal' && hasTidal) {
      updatePlaylistText.textContent = 'Send to Tidal';
    } else if (hasSpotify && !hasTidal) {
      updatePlaylistText.textContent = 'Send to Spotify';
    } else if (hasTidal && !hasSpotify) {
      updatePlaylistText.textContent = 'Send to Tidal';
    } else {
      updatePlaylistText.textContent = 'Send to Music Service';
    }
  }

  // Handle download option click
  downloadOption.onclick = () => {
    contextMenu.classList.add('hidden');

    if (!currentContextList) return;

    downloadListAsJSON(currentContextList);

    currentContextList = null;
  };

  // Handle rename option click
  renameOption.onclick = () => {
    contextMenu.classList.add('hidden');

    if (!currentContextList) return;

    openRenameModal(currentContextList);
  };

  // Handle update playlist option click
  updatePlaylistOption.onclick = async () => {
    contextMenu.classList.add('hidden');

    if (!currentContextList) return;

    try {
      await updatePlaylist(currentContextList);
    } catch (err) {
      console.error('Update playlist failed', err);
    }

    currentContextList = null;
  };

  // Handle delete option click
  deleteOption.onclick = async () => {
    contextMenu.classList.add('hidden');

    if (!currentContextList) return;

    // Confirm deletion
    if (
      confirm(
        `Are you sure you want to delete the list "${currentContextList}"? This cannot be undone.`
      )
    ) {
      try {
        await apiCall(`/api/lists/${encodeURIComponent(currentContextList)}`, {
          method: 'DELETE',
        });

        // Remove from local data
        delete lists[currentContextList];

        // If we're currently viewing this list, clear the view
        if (currentList === currentContextList) {
          currentList = null;
          window.currentList = currentList;

          // Hide the list name in header
          const headerSeparator = document.getElementById('headerSeparator');
          const headerListName = document.getElementById('headerListName');
          const headerAddAlbumBtn =
            document.getElementById('headerAddAlbumBtn');

          if (headerSeparator && headerListName && headerAddAlbumBtn) {
            headerSeparator.classList.add('hidden');
            headerListName.classList.add('hidden');
            headerAddAlbumBtn.classList.add('hidden');
          }

          document.getElementById('albumContainer').innerHTML = `
            <div class="text-center text-gray-500 mt-20">
              <p class="text-xl mb-2">No list selected</p>
              <p class="text-sm">Create or import a list to get started</p>
            </div>
          `;
        }

        // Update the navigation
        updateListNav();

        showToast(`List "${currentContextList}" deleted`);
      } catch (error) {
        showToast('Error deleting list', 'error');
      }
    }

    currentContextList = null;
  };
}

function updateMobileHeader() {
  const headerContainer = document.getElementById('dynamicHeader');
  if (headerContainer && window.currentUser) {
    headerContainer.innerHTML = window.headerComponent(
      window.currentUser,
      'home',
      currentList || ''
    );
  }
}

// Initialize album context menu
function initializeAlbumContextMenu() {
  const contextMenu = document.getElementById('albumContextMenu');
  const removeOption = document.getElementById('removeAlbumOption');
  const editOption = document.getElementById('editAlbumOption');
  const playOption = document.getElementById('playAlbumOption');

  if (!contextMenu || !removeOption || !editOption || !playOption) return;

  // Track selection has been removed from context menu - now available directly in the album list
  if (false) {
    selectTrackOption.onmouseenter = async () => {
      if (currentContextAlbum === null) return;

      // Cancel any in-flight requests if switching albums quickly
      if (trackAbortController) {
        trackAbortController.abort();
        trackAbortController = null;
      }

      const album =
        lists[currentList] && lists[currentList][currentContextAlbum];
      if (!album) return;

      // Check if we already have this menu cached and tracks haven't changed
      const cacheKey = `${currentList}_${currentContextAlbum}_${album.track_pick || ''}`;
      if (
        lastLoadedAlbumIndex === currentContextAlbum &&
        trackMenuCache.has(cacheKey) &&
        album.tracks &&
        album.tracks.length > 0
      ) {
        // Reuse cached menu
        trackSubmenu.innerHTML = trackMenuCache.get(cacheKey);
        trackSubmenu.classList.remove('hidden');

        // Reattach event listeners to cached elements
        reattachTrackListeners(trackSubmenu, album);
        return;
      }

      // Clear previous tracks only if switching to a different album
      if (lastLoadedAlbumIndex !== currentContextAlbum) {
        trackSubmenu.innerHTML = '';
      }
      lastLoadedAlbumIndex = currentContextAlbum;

      // Check if album has tracks
      if (!album.tracks || album.tracks.length === 0) {
        // Try to fetch tracks
        trackSubmenu.innerHTML =
          '<div class="px-4 py-2 text-sm text-gray-500">Loading tracks...</div>';
        trackSubmenu.classList.remove('hidden');

        try {
          // Create abort controller for this request
          trackAbortController = new AbortController();

          // Fetch tracks with abort signal
          await fetchTracksForAlbum(album, trackAbortController.signal);

          // Only save if request wasn't aborted
          if (!trackAbortController.signal.aborted) {
            await saveList(currentList, lists[currentList]);
            trackAbortController = null;
          }
        } catch (error) {
          if (error.name === 'AbortError') {
            // Request was aborted, ignore
            return;
          }
          console.error('Error fetching tracks:', error);
          trackSubmenu.innerHTML =
            '<div class="px-4 py-2 text-sm text-red-400">Failed to load tracks</div>';
          return;
        }
      }

      // Display tracks
      if (album.tracks && album.tracks.length > 0) {
        // Build the menu HTML
        const menuHTML = buildTrackMenu(album);

        // Cache the menu HTML
        trackMenuCache.set(cacheKey, menuHTML);

        // Limit cache size to prevent memory issues
        if (trackMenuCache.size > 20) {
          const firstKey = trackMenuCache.keys().next().value;
          trackMenuCache.delete(firstKey);
        }

        trackSubmenu.innerHTML = menuHTML;
        trackSubmenu.classList.remove('hidden');

        // Attach event listeners
        reattachTrackListeners(trackSubmenu, album);

        // Adjust submenu position if it goes off-screen
        setTimeout(() => {
          const submenuRect = trackSubmenu.getBoundingClientRect();
          const contextRect = contextMenu.getBoundingClientRect();

          // Check if submenu goes off the right edge of the screen
          if (submenuRect.right > window.innerWidth) {
            // Position submenu to the left of the parent menu
            trackSubmenu.style.left = 'auto';
            trackSubmenu.style.right = '100%';
            trackSubmenu.style.marginLeft = '0';
            trackSubmenu.style.marginRight = '0.25rem';
          } else {
            // Reset to default position (right of parent)
            trackSubmenu.style.left = '100%';
            trackSubmenu.style.right = 'auto';
            trackSubmenu.style.marginLeft = '0.25rem';
            trackSubmenu.style.marginRight = '0';
          }

          // Check if submenu goes off the bottom of the screen
          if (submenuRect.bottom > window.innerHeight) {
            const maxHeight = window.innerHeight - contextRect.top - 20;
            trackSubmenu.style.maxHeight = `${maxHeight}px`;
          }
        }, 10);
      } else {
        trackSubmenu.innerHTML =
          '<div class="px-4 py-2 text-sm text-gray-500">No tracks available</div>';
        trackSubmenu.classList.remove('hidden');
      }
    };

    // Helper function to build track menu HTML as a string
    function buildTrackMenu(album) {
      // Sort tracks to ensure they start from track 1
      const sortedTracks = [...album.tracks].sort((a, b) => {
        const aNum = parseInt(
          a.match(/^(\d+)[\.\s\-]/) ? a.match(/^(\d+)/)[1] : 0
        );
        const bNum = parseInt(
          b.match(/^(\d+)[\.\s\-]/) ? b.match(/^(\d+)/)[1] : 0
        );
        if (aNum && bNum) return aNum - bNum;
        return 0;
      });

      let html = '';

      // Add "None" option
      html += `
        <button class="track-menu-option block w-full text-left px-4 py-2 text-sm hover:bg-gray-700 transition-colors whitespace-nowrap"
                data-track-value="">
          <span class="${!album.track_pick ? 'text-red-500' : 'text-gray-400'}">
            ${!album.track_pick ? '<i class="fas fa-check mr-2"></i>' : ''}None (clear selection)
          </span>
        </button>
      `;

      // Add track options
      sortedTracks.forEach((track, idx) => {
        const isSelected =
          album.track_pick === track ||
          album.track_pick === (idx + 1).toString();
        html += `
          <button class="track-menu-option block w-full text-left px-4 py-2 text-sm hover:bg-gray-700 transition-colors whitespace-normal"
                  data-track-value="${track.replace(/"/g, '&quot;')}">
            <span class="${isSelected ? 'text-red-500' : 'text-gray-300'}">
              ${isSelected ? '<i class="fas fa-check mr-2"></i>' : ''}
              ${idx + 1}. ${track}
            </span>
          </button>
        `;
      });

      return html;
    }

    // Helper function to reattach event listeners to track menu buttons
    function reattachTrackListeners(submenu, album) {
      const buttons = submenu.querySelectorAll('.track-menu-option');
      buttons.forEach((button) => {
        button.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();

          const trackValue = button.dataset.trackValue;
          album.track_pick = trackValue;

          await saveList(currentList, lists[currentList]);
          contextMenu.classList.add('hidden');
          trackSubmenu.classList.add('hidden');

          // Clear cache since selection changed
          trackMenuCache.clear();
          lastLoadedAlbumIndex = null;

          if (trackValue) {
            showToast(`Selected track: ${trackValue}`);
          } else {
            showToast('Track selection cleared');
          }
        };
      });
    }

    selectTrackOption.onmouseleave = (e) => {
      // Hide submenu if not hovering over it
      setTimeout(() => {
        if (
          !selectTrackOption.matches(':hover') &&
          !trackSubmenu.matches(':hover')
        ) {
          trackSubmenu.classList.add('hidden');
        }
      }, 200); // Increased timeout for better UX
    };

    trackSubmenu.onmouseleave = (e) => {
      // Hide submenu if not hovering over parent or submenu
      setTimeout(() => {
        if (
          !selectTrackOption.matches(':hover') &&
          !trackSubmenu.matches(':hover')
        ) {
          trackSubmenu.classList.add('hidden');
        }
      }, 200); // Increased timeout for better UX
    };

    // Ensure submenu stays interactive
    trackSubmenu.onmouseenter = (e) => {
      e.stopPropagation();
      trackSubmenu.classList.remove('hidden');
    };
  }

  // Handle edit option click
  editOption.onclick = () => {
    contextMenu.classList.add('hidden');

    if (currentContextAlbum === null) return;

    // Verify the album is still at the expected index, fallback to identity search
    const expectedAlbum =
      lists[currentList] && lists[currentList][currentContextAlbum];
    if (expectedAlbum && currentContextAlbumId) {
      const expectedId =
        `${expectedAlbum.artist}::${expectedAlbum.album}::${expectedAlbum.release_date || ''}`.toLowerCase();
      if (expectedId === currentContextAlbumId) {
        // Index is still valid
        showMobileEditForm(currentContextAlbum);
        return;
      }
    }

    // Index is stale, search by identity
    if (currentContextAlbumId) {
      showMobileEditFormSafe(currentContextAlbumId);
    } else {
      showToast('Album not found - it may have been moved or removed', 'error');
    }
  };

  // Handle play option click
  playOption.onclick = () => {
    contextMenu.classList.add('hidden');
    if (currentContextAlbum === null) return;

    // Verify the album is still at the expected index, fallback to identity search
    const expectedAlbum =
      lists[currentList] && lists[currentList][currentContextAlbum];
    if (expectedAlbum && currentContextAlbumId) {
      const expectedId =
        `${expectedAlbum.artist}::${expectedAlbum.album}::${expectedAlbum.release_date || ''}`.toLowerCase();
      if (expectedId === currentContextAlbumId) {
        // Index is still valid
        playAlbum(currentContextAlbum);
        return;
      }
    }

    // Index is stale, search by identity
    if (currentContextAlbumId) {
      playAlbumSafe(currentContextAlbumId);
    } else {
      showToast('Album not found - it may have been moved or removed', 'error');
    }
  };

  // Handle remove option click
  removeOption.onclick = async () => {
    contextMenu.classList.add('hidden');
    if (currentContextAlbum === null) return;

    // Verify the album is still at the expected index, fallback to identity search
    let album = lists[currentList] && lists[currentList][currentContextAlbum];
    let indexToRemove = currentContextAlbum;

    if (album && currentContextAlbumId) {
      const expectedId =
        `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
      if (expectedId !== currentContextAlbumId) {
        // Index is stale, search by identity
        const result = findAlbumByIdentity(currentContextAlbumId);
        if (result) {
          album = result.album;
          indexToRemove = result.index;
        } else {
          showToast(
            'Album not found - it may have been moved or removed',
            'error'
          );
          return;
        }
      }
    } else if (!album) {
      showToast('Album not found - it may have been moved or removed', 'error');
      return;
    }

    showConfirmation(
      'Remove Album',
      `Remove "${album.album}" by ${album.artist}?`,
      'This will remove the album from this list.',
      'Remove',
      async () => {
        try {
          // Remove from the list using the correct index
          lists[currentList].splice(indexToRemove, 1);

          // Save to server
          await saveList(currentList, lists[currentList]);

          // Update display
          selectList(currentList);

          showToast(`Removed "${album.album}" from the list`);
        } catch (error) {
          console.error('Error removing album:', error);
          showToast('Error removing album', 'error');

          // Reload the list to ensure consistency
          await loadLists();
          selectList(currentList);
        }

        currentContextAlbum = null;
        currentContextAlbumId = null;
      }
    );
  };
}

// Play the selected album on the connected music service
function playAlbum(index) {
  const album = lists[currentList][index];
  if (!album) return;

  const hasSpotify = window.currentUser?.spotifyAuth;
  const hasTidal = window.currentUser?.tidalAuth;
  const preferred = window.currentUser?.musicService;

  const chooseService = () => {
    if (preferred === 'spotify' && hasSpotify) {
      return Promise.resolve('spotify');
    }
    if (preferred === 'tidal' && hasTidal) {
      return Promise.resolve('tidal');
    }
    if (hasSpotify && hasTidal) {
      return showServicePicker(true, true);
    } else if (hasSpotify) {
      return Promise.resolve('spotify');
    } else if (hasTidal) {
      return Promise.resolve('tidal');
    } else {
      showToast('No music service connected', 'error');
      return Promise.resolve(null);
    }
  };

  chooseService().then((service) => {
    hideConfirmation();
    if (!service) return;

    const query = `artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`;
    const endpoint =
      service === 'spotify' ? '/api/spotify/album' : '/api/tidal/album';

    fetch(`${endpoint}?${query}`, { credentials: 'include' })
      .then(async (r) => {
        let data;
        try {
          data = await r.json();
        } catch (_) {
          throw new Error('Invalid response');
        }

        if (!r.ok) {
          throw new Error(data.error || 'Request failed');
        }
        return data;
      })
      .then((data) => {
        if (data.id) {
          if (service === 'spotify') {
            window.location.href = `spotify:album:${data.id}`;
          } else {
            window.location.href = `tidal://album/${data.id}`;
          }
        } else if (data.error) {
          showToast(data.error, 'error');
        } else {
          showToast('Album not found on ' + service, 'error');
        }
      })
      .catch((err) => {
        console.error('Play album error:', err);
        showToast(err.message || 'Failed to open album', 'error');
      });
  });
}

// Create list functionality
function initializeCreateList() {
  const createBtn = document.getElementById('createListBtn');
  const modal = document.getElementById('createListModal');
  const nameInput = document.getElementById('newListName');
  const cancelBtn = document.getElementById('cancelCreateBtn');
  const confirmBtn = document.getElementById('confirmCreateBtn');

  if (!createBtn || !modal) return;

  // Open modal
  createBtn.onclick = () => {
    modal.classList.remove('hidden');
    nameInput.value = '';
    nameInput.focus();
  };

  // Close modal
  const closeModal = () => {
    modal.classList.add('hidden');
    nameInput.value = '';
  };

  cancelBtn.onclick = closeModal;

  // Click outside to close
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  // Create list
  const createList = async () => {
    const listName = nameInput.value.trim();

    if (!listName) {
      showToast('Please enter a list name', 'error');
      nameInput.focus();
      return;
    }

    // Check if list already exists
    if (lists[listName]) {
      showToast('A list with this name already exists', 'error');
      nameInput.focus();
      return;
    }

    try {
      // Create empty list
      await saveList(listName, []);

      // Update navigation
      updateListNav();

      // Select the new list
      selectList(listName);

      // Close modal
      closeModal();

      showToast(`Created list "${listName}"`);
    } catch (error) {
      showToast('Error creating list', 'error');
    }
  };

  confirmBtn.onclick = createList;

  // Enter key to create
  nameInput.onkeypress = (e) => {
    if (e.key === 'Enter') {
      createList();
    }
  };

  // ESC key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });
}

// Rename list functionality
function initializeRenameList() {
  const modal = document.getElementById('renameListModal');
  const currentNameSpan = document.getElementById('currentListName');
  const nameInput = document.getElementById('newListNameInput');
  const cancelBtn = document.getElementById('cancelRenameBtn');
  const confirmBtn = document.getElementById('confirmRenameBtn');

  if (!modal) return;

  // Close modal function
  const closeModal = () => {
    modal.classList.add('hidden');
    nameInput.value = '';
  };

  cancelBtn.onclick = closeModal;

  // Click outside to close
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  // Rename list function
  const renameList = async () => {
    const oldName = currentNameSpan.textContent;
    const newName = nameInput.value.trim();

    if (!newName) {
      showToast('Please enter a new list name', 'error');
      nameInput.focus();
      return;
    }

    if (newName === oldName) {
      showToast('New name must be different from current name', 'error');
      nameInput.focus();
      return;
    }

    // Check if new name already exists
    if (lists[newName]) {
      showToast('A list with this name already exists', 'error');
      nameInput.focus();
      return;
    }

    try {
      // Get the list data
      const listData = lists[oldName];

      // Create new list with new name
      await saveList(newName, listData);

      // Delete old list
      await apiCall(`/api/lists/${encodeURIComponent(oldName)}`, {
        method: 'DELETE',
      });

      // Update local data
      delete lists[oldName];

      // If we're currently viewing this list, update the view
      if (currentList === oldName) {
        currentList = newName;
        window.currentList = currentList;
        selectList(newName);
      }

      // Update navigation
      updateListNav();

      // Close modal
      closeModal();

      showToast(`List renamed from "${oldName}" to "${newName}"`);
    } catch (error) {
      showToast('Error renaming list', 'error');
    }
  };

  confirmBtn.onclick = renameList;

  // Enter key to rename
  nameInput.onkeypress = (e) => {
    if (e.key === 'Enter') {
      renameList();
    }
  };
}

// Open rename modal
function openRenameModal(listName) {
  const modal = document.getElementById('renameListModal');
  const currentNameSpan = document.getElementById('currentListName');
  const nameInput = document.getElementById('newListNameInput');

  if (!modal || !currentNameSpan || !nameInput) return;

  currentNameSpan.textContent = listName;
  nameInput.value = listName;
  modal.classList.remove('hidden');

  // Select all text in the input for easy editing
  setTimeout(() => {
    nameInput.focus();
    nameInput.select();
  }, 100);
}

// Update sidebar navigation
function updateListNav() {
  const nav = document.getElementById('listNav');
  const mobileNav = document.getElementById('mobileListNav');

  const createListItems = (container, isMobile = false) => {
    container.innerHTML = '';

    Object.keys(lists).forEach((listName) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <button class="w-full text-left px-3 py-${isMobile ? '3' : '2'} rounded text-sm hover:bg-gray-800 transition duration-200 ${currentList === listName ? 'bg-gray-800 text-red-500' : 'text-gray-300'} flex items-center">
          <i class="fas fa-list mr-2 flex-shrink-0"></i>
          <span class="truncate">${listName}</span>
        </button>
      `;

      const button = li.querySelector('button');

      if (!isMobile) {
        // Desktop: keep right-click
        button.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();

          currentContextList = listName;

          const contextMenu = document.getElementById('contextMenu');
          if (!contextMenu) return;

          // Update the playlist option text based on user's music service
          const updatePlaylistText =
            document.getElementById('updatePlaylistText');
          if (updatePlaylistText) {
            const musicService = window.currentUser?.musicService;
            const hasSpotify = window.currentUser?.spotifyAuth;
            const hasTidal = window.currentUser?.tidalAuth;

            if (musicService === 'spotify' && hasSpotify) {
              updatePlaylistText.textContent = 'Send to Spotify';
            } else if (musicService === 'tidal' && hasTidal) {
              updatePlaylistText.textContent = 'Send to Tidal';
            } else if (hasSpotify && !hasTidal) {
              updatePlaylistText.textContent = 'Send to Spotify';
            } else if (hasTidal && !hasSpotify) {
              updatePlaylistText.textContent = 'Send to Tidal';
            } else {
              updatePlaylistText.textContent = 'Send to Music Service';
            }
          }

          // Position the menu at cursor
          contextMenu.style.left = `${e.clientX}px`;
          contextMenu.style.top = `${e.clientY}px`;
          contextMenu.classList.remove('hidden');

          // Adjust position if menu goes off screen
          setTimeout(() => {
            const rect = contextMenu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
              contextMenu.style.left = `${e.clientX - rect.width}px`;
            }
            if (rect.bottom > window.innerHeight) {
              contextMenu.style.top = `${e.clientY - rect.height}px`;
            }
          }, 0);
        });
      } else {
        // Mobile: long press
        let pressTimer;
        button.addEventListener(
          'touchstart',
          (e) => {
            pressTimer = setTimeout(() => {
              showMobileListMenu(listName);
            }, 500);
          },
          { passive: true }
        );
        button.addEventListener('touchend', () => clearTimeout(pressTimer), {
          passive: true,
        });
      }

      button.onclick = () => {
        selectList(listName);
        if (isMobile) toggleMobileLists();
      };

      container.appendChild(li);
    });
  };

  createListItems(nav);
  if (mobileNav) createListItems(mobileNav, true);

  // Cache list names locally for faster startup
  try {
    localStorage.setItem('cachedListNames', JSON.stringify(Object.keys(lists)));
  } catch (e) {
    console.warn('Failed to cache list names', e);
  }
}

// Removed complex initializeMobileSorting function - now using unified approach

// Select and display a list
async function selectList(listName) {
  try {
    currentList = listName;
    window.currentList = currentList;
    subscribeToList(listName);

    // Always fetch the latest data when a list is selected
    if (listName) {
      try {
        const freshData = await apiCall(
          `/api/lists/${encodeURIComponent(listName)}`
        );
        lists[listName] = freshData;
      } catch (err) {
        console.warn('Failed to fetch latest list data:', err);
      }
    }

    // Save to localStorage immediately (synchronous)
    if (listName) {
      localStorage.setItem('lastSelectedList', listName);
    }

    // Update the header with current list name
    updateMobileHeader();

    // Update the active state in the list navigation
    updateListNav();

    // Update the header title
    updateHeaderTitle(listName);

    // Display the albums
    displayAlbums(lists[listName]);

    // Automatically fetch tracks for albums in this list
    autoFetchTracksForList(listName);

    // Show/hide FAB based on whether a list is selected (mobile only)
    const fab = document.getElementById('addAlbumFAB');
    if (fab) {
      fab.style.display = listName ? 'flex' : 'none';
    }

    // Persist the selection without blocking UI if changed
    if (listName && listName !== window.lastSelectedList) {
      apiCall('/api/user/last-list', {
        method: 'POST',
        body: JSON.stringify({ listName }),
      })
        .then(() => {
          window.lastSelectedList = listName;
        })
        .catch((error) => {
          console.warn('Failed to save list preference:', error);
        });
    }
  } catch (error) {
    showToast('Error loading list', 'error');
  }
}

function updateHeaderTitle(listName) {
  const headerSeparator = document.getElementById('headerSeparator');
  const headerListName = document.getElementById('headerListName');
  const headerAddAlbumBtn = document.getElementById('headerAddAlbumBtn');

  if (listName && headerSeparator && headerListName) {
    headerSeparator.classList.remove('hidden');
    headerListName.classList.remove('hidden');
    headerListName.textContent = listName;

    // Also show the add album button in header if it exists
    if (headerAddAlbumBtn) {
      headerAddAlbumBtn.classList.remove('hidden');
    }
  }
}

// Mobile edit form
function editMobileAlbum(index) {
  // Show a mobile-friendly edit form
  // This replaces the inline editing on desktop
}

function removeAlbum(index) {
  lists[currentList].splice(index, 1);
  saveList(currentList, lists[currentList]);
  selectList(currentList);
  showToast('Album removed');
}

// Make genre editable with datalist
function makeGenreEditable(genreDiv, albumIndex, genreField) {
  // Check if we're already editing
  if (genreDiv.querySelector('input')) {
    return;
  }

  // Get current genre from the live data
  const currentGenre = lists[currentList][albumIndex][genreField] || '';

  // Create input with datalist
  const input = document.createElement('input');
  input.type = 'text';
  input.className =
    'w-full bg-gray-800 text-gray-300 text-sm p-1 rounded border border-gray-700 focus:outline-none focus:border-red-600';
  input.value = currentGenre;
  input.placeholder = `Type to search ${genreField === 'genre_1' ? 'primary' : 'secondary'} genre...`;
  input.setAttribute(
    'list',
    `genre-list-${currentList}-${albumIndex}-${genreField}`
  );

  // Create datalist
  const datalist = document.createElement('datalist');
  datalist.id = `genre-list-${currentList}-${albumIndex}-${genreField}`;

  // Add all available genres
  availableGenres.forEach((genre) => {
    const option = document.createElement('option');
    option.value = genre;
    datalist.appendChild(option);
  });

  // Store the original onclick handler
  const originalOnClick = genreDiv.onclick;
  genreDiv.onclick = null; // Temporarily remove click handler

  // Replace content with input and datalist
  genreDiv.innerHTML = '';
  genreDiv.appendChild(input);
  genreDiv.appendChild(datalist);
  input.focus();
  input.select();

  // Create handleClickOutside function so we can reference it for removal
  let handleClickOutside;

  const restoreDisplay = (valueToDisplay) => {
    // Remove the click outside listener if it exists
    if (handleClickOutside) {
      document.removeEventListener('click', handleClickOutside);
      handleClickOutside = null;
    }

    // Determine what to display based on value and field
    let displayValue = valueToDisplay;
    let displayClass;

    if (genreField === 'genre_1') {
      // For Genre 1: show placeholder if empty
      displayValue = valueToDisplay || 'Genre 1';
      displayClass = valueToDisplay ? 'text-gray-300' : 'text-gray-500 italic';
    } else {
      // For Genre 2: show placeholder if empty, but treat 'Genre 2' and '-' as empty
      if (
        !valueToDisplay ||
        valueToDisplay === 'Genre 2' ||
        valueToDisplay === '-'
      ) {
        displayValue = 'Genre 2';
        displayClass = 'text-gray-500 italic';
      } else {
        displayValue = valueToDisplay;
        displayClass = 'text-gray-400';
      }
    }

    genreDiv.innerHTML = `<span class="text-sm ${displayClass} truncate cursor-pointer hover:text-gray-100">${displayValue}</span>`;

    // Restore the original click handler
    genreDiv.onclick = originalOnClick;
  };

  const saveGenre = async (newGenre) => {
    // Trim the input
    newGenre = newGenre.trim();

    // Check if value actually changed
    if (newGenre === currentGenre) {
      restoreDisplay(currentGenre);
      return;
    }

    // Update the data
    lists[currentList][albumIndex][genreField] = newGenre;

    try {
      await saveList(currentList, lists[currentList]);
      restoreDisplay(newGenre);
      showToast(newGenre === '' ? 'Genre cleared' : 'Genre updated');
    } catch (error) {
      showToast('Error saving genre', 'error');
      // Revert on error
      lists[currentList][albumIndex][genreField] = currentGenre;
      restoreDisplay(currentGenre);
    }
  };

  // Handle input change (when selecting from datalist)
  input.addEventListener('change', (e) => {
    saveGenre(e.target.value);
  });

  // Handle blur (when clicking away)
  input.addEventListener('blur', () => {
    saveGenre(input.value);
  });

  // Handle keyboard
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveGenre(input.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      restoreDisplay(currentGenre);
    }
  });

  // Define handleClickOutside
  handleClickOutside = (e) => {
    if (!genreDiv.contains(e.target)) {
      saveGenre(input.value);
    }
  };

  // Small delay to prevent immediate trigger
  setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
  }, 100);
}

// Make comment editable
function makeCommentEditable(commentDiv, albumIndex) {
  const currentComment =
    lists[currentList][albumIndex].comments ||
    lists[currentList][albumIndex].comment ||
    '';

  // Create textarea
  const textarea = document.createElement('textarea');
  textarea.className =
    'w-full bg-gray-800 text-gray-300 text-sm p-2 rounded border border-gray-700 focus:outline-none focus:border-red-600 resize-none';
  textarea.value = currentComment;
  textarea.rows = 2;

  // Replace div content with textarea
  commentDiv.innerHTML = '';
  commentDiv.appendChild(textarea);
  textarea.focus();
  textarea.select();

  // Save on blur or enter
  const saveComment = async () => {
    const newComment = textarea.value.trim();
    lists[currentList][albumIndex].comments = newComment;
    lists[currentList][albumIndex].comment = newComment;

    try {
      await saveList(currentList, lists[currentList]);

      // Update display without re-rendering everything
      let displayComment = newComment;
      if (displayComment === 'Comment') {
        displayComment = '';
      }

      commentDiv.innerHTML = `<span class="text-sm text-gray-300 italic line-clamp-2 cursor-pointer hover:text-gray-100">${displayComment}</span>`;

      // Re-add click handler
      commentDiv.onclick = () => makeCommentEditable(commentDiv, albumIndex);

      if (newComment !== currentComment) {
        showToast('Comment updated');
      }
    } catch (error) {
      showToast('Error saving comment', 'error');
      // Revert on error
      commentDiv.innerHTML = `<span class="text-sm text-gray-300 italic line-clamp-2 cursor-pointer hover:text-gray-100">${currentComment}</span>`;
      commentDiv.onclick = () => makeCommentEditable(commentDiv, albumIndex);
    }
  };

  textarea.addEventListener('blur', saveComment);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      textarea.blur();
    }
    if (e.key === 'Escape') {
      // Cancel editing
      let displayComment = currentComment;
      if (displayComment === 'Comment') {
        displayComment = '';
      }
      commentDiv.innerHTML = `<span class="text-sm text-gray-300 italic line-clamp-2 cursor-pointer hover:text-gray-100">${displayComment}</span>`;
      commentDiv.onclick = () => makeCommentEditable(commentDiv, albumIndex);
    }
  });
}

// Show track selection menu for quick track picking
function showTrackSelectionMenu(album, albumIndex, x, y) {
  // Remove any existing menu
  const existingMenu = document.getElementById('quickTrackMenu');
  if (existingMenu) existingMenu.remove();

  const menu = document.createElement('div');
  menu.id = 'quickTrackMenu';
  menu.className =
    'absolute z-50 bg-gray-800 rounded-lg shadow-xl border border-gray-700 max-h-96 overflow-y-auto';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.minWidth = '250px';

  if (!album.tracks || album.tracks.length === 0) {
    menu.innerHTML =
      '<div class="px-4 py-2 text-sm text-gray-500">No tracks available</div>';
  } else {
    // Sort tracks by track number
    const sortedTracks = [...album.tracks].sort((a, b) => {
      const numA = parseInt(
        a.match(/^(\d+)[\.\s\-]/) ? a.match(/^(\d+)/)[1] : 0
      );
      const numB = parseInt(
        b.match(/^(\d+)[\.\s\-]/) ? b.match(/^(\d+)/)[1] : 0
      );
      return numA && numB ? numA - numB : 0;
    });

    let menuHTML = `
      <div class="track-menu-option px-4 py-2 hover:bg-gray-700 cursor-pointer text-sm" data-track-value="">
        <span class="${!album.track_pick ? 'text-red-500' : 'text-gray-400'}">
          ${!album.track_pick ? '<i class="fas fa-check mr-2"></i>' : ''}None (clear selection)
        </span>
      </div>
      <div class="border-t border-gray-700"></div>
    `;

    sortedTracks.forEach((track, idx) => {
      const isSelected =
        album.track_pick === track || album.track_pick === (idx + 1).toString();
      const match = track.match(/^(\d+)[\.\s\-]?\s*(.*)$/);
      const trackNum = match ? match[1] : idx + 1;
      const trackName = match ? match[2] : track;

      menuHTML += `
        <div class="track-menu-option px-4 py-2 hover:bg-gray-700 cursor-pointer text-sm ${isSelected ? 'bg-gray-700/50' : ''}" 
             data-track-value="${track}">
          <span class="${isSelected ? 'text-red-500' : 'text-gray-300'}">
            ${isSelected ? '<i class="fas fa-check mr-2"></i>' : ''}
            <span class="font-medium">${trackNum}.</span> ${trackName}
          </span>
        </div>
      `;
    });

    menu.innerHTML = menuHTML;

    // Add click handlers
    menu.querySelectorAll('.track-menu-option').forEach((option) => {
      option.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const trackValue = option.dataset.trackValue;

        album.track_pick = trackValue;
        await saveList(currentList, lists[currentList]);

        menu.remove();
        selectList(currentList); // Refresh the display
        showToast(
          trackValue
            ? `Selected track: ${trackValue.substring(0, 50)}...`
            : 'Track selection cleared'
        );
      };
    });
  }

  document.body.appendChild(menu);

  // Position adjustment to keep menu on screen
  setTimeout(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 10}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${y - rect.height}px`;
    }
  }, 0);

  // Close menu when clicking outside
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };

  setTimeout(() => {
    document.addEventListener('click', closeMenu);
  }, 0);
}

// Shared album data processing
function processAlbumData(album, index) {
  const position = index + 1;
  const albumName = album.album || 'Unknown Album';
  const artist = album.artist || 'Unknown Artist';
  const releaseDate = formatReleaseDate(album.release_date || '');
  const country = album.country || '';
  const countryDisplay = country || 'Country';
  const countryClass = country ? 'text-gray-300' : 'text-gray-500 italic';

  const genre1 = album.genre_1 || album.genre || '';
  const genre1Display = genre1 || 'Genre 1';
  const genre1Class = genre1 ? 'text-gray-300' : 'text-gray-500 italic';

  let genre2 = album.genre_2 || '';
  if (genre2 === 'Genre 2' || genre2 === '-') genre2 = '';
  const genre2Display = genre2 || 'Genre 2';
  const genre2Class = genre2 ? 'text-gray-300' : 'text-gray-500 italic';

  let comment = album.comments || album.comment || '';
  if (comment === 'Comment') comment = '';

  const coverImage = album.cover_image || '';
  const imageFormat = album.cover_image_format || 'PNG';

  // Process track pick
  let trackPick = album.track_pick || '';
  let trackPickDisplay = '';
  let trackPickClass = 'text-gray-500 italic';

  if (trackPick && album.tracks && Array.isArray(album.tracks)) {
    // Find the track that matches
    const trackMatch = album.tracks.find((t) => t === trackPick);
    if (trackMatch) {
      // Extract track number and name
      const match = trackMatch.match(/^(\d+)[\.\s\-]?\s*(.*)$/);
      if (match) {
        const trackNum = match[1];
        const trackName = match[2] || '';
        trackPickDisplay = trackName
          ? `${trackNum}. ${trackName}`
          : `Track ${trackNum}`;
        trackPickClass = 'text-gray-300';
      } else {
        trackPickDisplay = trackMatch;
        trackPickClass = 'text-gray-300';
      }
    } else if (trackPick.match(/^\d+$/)) {
      // Just a track number
      trackPickDisplay = `Track ${trackPick}`;
      trackPickClass = 'text-gray-300';
    } else {
      trackPickDisplay = trackPick;
      trackPickClass = 'text-gray-300';
    }
  }

  if (!trackPickDisplay) {
    trackPickDisplay = 'Select Track';
  }

  return {
    position,
    albumName,
    artist,
    releaseDate,
    country,
    countryDisplay,
    countryClass,
    genre1,
    genre1Display,
    genre1Class,
    genre2,
    genre2Display,
    genre2Class,
    comment,
    coverImage,
    imageFormat,
    trackPick,
    trackPickDisplay,
    trackPickClass,
  };
}

// Create album item component (works for both desktop and mobile)
function createAlbumItem(album, index, isMobile = false) {
  const data = processAlbumData(album, index);

  if (isMobile) {
    return createMobileAlbumCard(data, index);
  } else {
    return createDesktopAlbumRow(data, index);
  }
}

// Create desktop album row (preserves exact current design)
function createDesktopAlbumRow(data, index) {
  const row = document.createElement('div');
  row.className =
    'album-row album-grid gap-4 px-4 py-2 border-b border-gray-800 hover:bg-gray-800/30 transition-colors';
  row.dataset.index = index;

  row.innerHTML = `
    <div class="flex items-center justify-center text-gray-400 font-medium position-display" data-position-element="true">${data.position}</div>
    <div class="flex items-center">
      <div class="album-cover-container">
        ${
          data.coverImage
            ? `
          <img src="data:image/${data.imageFormat};base64,${data.coverImage}" 
              alt="${data.albumName}" 
              class="album-cover rounded shadow-lg"
              loading="lazy"
              onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'album-cover-placeholder rounded bg-gray-800 shadow-lg\\'><svg width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\' class=\\'text-gray-600\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\' ry=\\'2\\'></rect><circle cx=\\'8.5\\' cy=\\'8.5\\' r=\\'1.5\\'></circle><polyline points=\\'21 15 16 10 5 21\\'></polyline></svg></div>'"
          >
        `
            : `
          <div class="album-cover-placeholder rounded bg-gray-800 shadow-lg">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-600">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          </div>
        `
        }
      </div>
    </div>
    <div class="flex flex-col justify-center">
      <div class="font-semibold text-white truncate">${data.albumName}</div>
      <div class="text-xs text-gray-400 mt-0.5">${data.releaseDate}</div>
    </div>
    <div class="flex items-center">
      <span class="text-sm text-gray-300 truncate">${data.artist}</span>
    </div>
    <div class="flex items-center country-cell">
      <span class="text-sm ${data.countryClass} truncate cursor-pointer hover:text-gray-100">${data.countryDisplay}</span>
    </div>
    <div class="flex items-center genre-1-cell">
      <span class="text-sm ${data.genre1Class} truncate cursor-pointer hover:text-gray-100">${data.genre1Display}</span>
    </div>
    <div class="flex items-center genre-2-cell">
      <span class="text-sm ${data.genre2Class} truncate cursor-pointer hover:text-gray-100">${data.genre2Display}</span>
    </div>
    <div class="flex items-center comment-cell">
      <span class="text-sm text-gray-300 italic line-clamp-2 cursor-pointer hover:text-gray-100">${data.comment}</span>
    </div>
    <div class="flex items-center track-cell">
      <span class="text-sm ${data.trackPickClass} truncate cursor-pointer hover:text-gray-100" title="${data.trackPick || 'Click to select track'}">${data.trackPickDisplay}</span>
    </div>
  `;

  // Add shared event handlers
  attachDesktopEventHandlers(row, index);
  return row;
}

// Shared event handlers for desktop rows
function attachDesktopEventHandlers(row, index) {
  // Add click handler to track cell for quick selection
  const trackCell = row.querySelector('.track-cell');
  if (trackCell) {
    trackCell.onclick = async () => {
      const album = lists[currentList][index];
      if (!album.tracks || album.tracks.length === 0) {
        showToast('Fetching tracks...', 'info');
        try {
          await fetchTracksForAlbum(album);
          await saveList(currentList, lists[currentList]);
        } catch (err) {
          showToast('Error fetching tracks', 'error');
          return;
        }
      }

      // Show track selection menu at the cell position
      const rect = trackCell.getBoundingClientRect();
      showTrackSelectionMenu(album, index, rect.left, rect.bottom);
    };
  }

  // Add click handler to country cell
  const countryCell = row.querySelector('.country-cell');
  countryCell.onclick = () => makeCountryEditable(countryCell, index);

  // Add click handlers to genre cells
  const genre1Cell = row.querySelector('.genre-1-cell');
  genre1Cell.onclick = () => makeGenreEditable(genre1Cell, index, 'genre_1');

  const genre2Cell = row.querySelector('.genre-2-cell');
  genre2Cell.onclick = () => makeGenreEditable(genre2Cell, index, 'genre_2');

  // Add click handler to comment cell
  const commentCell = row.querySelector('.comment-cell');
  commentCell.onclick = () => makeCommentEditable(commentCell, index);

  // Attach link preview
  const album = lists[currentList][index];
  const comment = album.comments || album.comment || '';
  attachLinkPreview(commentCell, comment);

  // Right-click handler for album rows
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Store both index and album identity for safety
    const album = lists[currentList][index];
    const albumId =
      `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();

    currentContextAlbum = index;
    currentContextAlbumId = albumId; // Store identity as backup

    const contextMenu = document.getElementById('albumContextMenu');
    if (!contextMenu) return;

    contextMenu.style.left = `${e.clientX}px`;
    contextMenu.style.top = `${e.clientY}px`;
    contextMenu.classList.remove('hidden');

    setTimeout(() => {
      const rect = contextMenu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        contextMenu.style.left = `${e.clientX - rect.width}px`;
      }
      if (rect.bottom > window.innerHeight) {
        contextMenu.style.top = `${e.clientY - rect.height}px`;
      }
    }, 0);
  });
}

// Create mobile album card (preserves exact current design)
function createMobileAlbumCard(data, index) {
  const cardWrapper = document.createElement('div');
  cardWrapper.className = 'album-card-wrapper';

  const card = document.createElement('div');
  card.className =
    'album-card album-row bg-gray-900 border-b border-gray-800 touch-manipulation transition-all relative overflow-hidden';
  card.dataset.index = index;

  card.innerHTML = `
    <div class="flex items-center h-full">
      <!-- Position number on the far left -->
      <div class="flex-shrink-0 px-1 flex items-center justify-start text-gray-500 font-medium text-sm position-display" data-position-element="true">
        ${data.position}
      </div>

      <!-- Album cover -->
      <div class="flex-shrink-0 p-1 pl-0">
        ${
          data.coverImage
            ? `
          <img src="data:image/${data.imageFormat};base64,${data.coverImage}"
              alt="${data.albumName}"
              class="w-20 h-20 rounded-lg object-cover shadow-md"
              loading="lazy">
        `
            : `
          <div class="w-20 h-20 bg-gray-800 rounded-lg shadow-md flex items-center justify-center">
            <i class="fas fa-compact-disc text-xl text-gray-600"></i>
          </div>
        `
        }
      </div>
      
      <!-- Main content -->
      <div class="flex-1 min-w-0 py-3 pr-3">
        <div class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            <h3 class="font-semibold text-white text-base leading-tight truncate">${data.albumName}</h3>
            <p class="text-sm text-gray-400 truncate mt-0.5">${data.artist}</p>
            
            <!-- Date and Country row -->
            <div class="flex items-center gap-2 mt-1 text-xs text-gray-500">
              <span class="whitespace-nowrap">${data.releaseDate}</span>
              ${data.country ? `<span>• ${data.country}</span>` : ''}
            </div>
            
            <!-- Genres row (if any) -->
            ${
              data.genre1 || data.genre2
                ? `
              <div class="text-xs text-gray-500 truncate">
                ${data.genre1}${data.genre2 ? ` / ${data.genre2}` : ''}
              </div>
            `
                : ''
            }
            
            <!-- Track selection (if any) -->
            ${
              data.trackPick && data.trackPickDisplay !== 'Select Track'
                ? `
              <div class="text-xs text-blue-400 truncate mt-1">
                <i class="fas fa-music mr-1"></i>${data.trackPickDisplay}
              </div>
            `
                : ''
            }
            
            ${
              data.comment
                ? `
              <p class="text-xs text-gray-400 italic mt-1 line-clamp-1">${data.comment}</p>
            `
                : ''
            }
          </div>
        </div>
      </div>

      <!-- Actions on the right -->
      <div class="flex items-center justify-center flex-shrink-0 w-8 border-l border-gray-800/50">
        <button onclick="event.stopPropagation(); showMobileAlbumMenu(this)"
                class="p-2 text-gray-400 active:text-gray-200 no-drag">
          <i class="fas fa-ellipsis-v"></i>
        </button>
      </div>
    </div>
  `;

  cardWrapper.appendChild(card);

  // Add shared event handlers
  attachMobileEventHandlers(card, index);
  return cardWrapper;
}

// Shared event handlers for mobile cards
function attachMobileEventHandlers(card, index) {
  // Attach link preview to content area
  const album = lists[currentList][index];
  const comment = album.comments || album.comment || '';
  const contentDiv = card.querySelector('.flex-1.min-w-0');
  if (contentDiv) attachLinkPreview(contentDiv, comment);
}

// Display albums function - now consolidated
function displayAlbums(albums) {
  const isMobile = window.innerWidth < 1024; // Tailwind's lg breakpoint
  const container = document.getElementById('albumContainer');

  if (!container) {
    console.error('Album container not found!');
    return;
  }

  container.innerHTML = '';

  if (!albums || albums.length === 0) {
    container.innerHTML = `
      <div class="text-center text-gray-500 mt-20 px-4">
        <p class="text-xl mb-2">This list is empty</p>
        <p class="text-sm">Click the + button to add albums${isMobile ? '' : ' or use the Add Album button'}</p>
      </div>
    `;
    return;
  }

  // Create container based on view type
  let albumContainer;

  if (!isMobile) {
    // Desktop: Table layout with header
    albumContainer = document.createElement('div');
    albumContainer.className = 'w-full relative';

    // Header
    const header = document.createElement('div');
    header.className =
      'album-row album-header album-grid gap-4 px-4 py-2 text-sm font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-800 sticky top-0 bg-black z-10';
    header.style.alignItems = 'center';
    header.innerHTML = `
      <div class="text-center">#</div>
      <div></div>
      <div>Album</div>
      <div>Artist</div>
      <div>Country</div>
      <div>Genre 1</div>
      <div>Genre 2</div>
      <div>Comment</div>
      <div>Track</div>
    `;
    albumContainer.appendChild(header);

    const rowsContainer = document.createElement('div');
    rowsContainer.className = 'album-rows-container relative';

    // Create album rows
    albums.forEach((album, index) => {
      const row = createAlbumItem(album, index, false);
      rowsContainer.appendChild(row);
    });

    albumContainer.appendChild(rowsContainer);
  } else {
    // Mobile: Card layout
    albumContainer = document.createElement('div');
    albumContainer.className = 'mobile-album-list pb-20'; // Space for bottom nav

    // Create album cards
    albums.forEach((album, index) => {
      const card = createAlbumItem(album, index, true);
      albumContainer.appendChild(card);
    });
  }

  container.appendChild(albumContainer);

  // Pre-populate position element cache for better performance
  prePopulatePositionCache(albumContainer, isMobile);

  // Initialize sorting
  initializeUnifiedSorting(container, isMobile);
}

// Clear position cache when rebuilding
function clearPositionCache() {
  positionElementCache = new WeakMap();
}

// Rebuild position cache after clearing
function rebuildPositionCache(container, isMobile) {
  clearPositionCache();
  prePopulatePositionCache(container, isMobile);
}

// Pre-populate position element cache for better performance
function prePopulatePositionCache(container, isMobile) {
  let rows;

  if (isMobile) {
    rows = container.children;
  } else {
    const rowsContainer = container.querySelector('.album-rows-container');
    rows = rowsContainer ? rowsContainer.children : container.children;
  }

  // Pre-populate cache during initial render
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Try O(1) lookup first using data attribute
    let positionEl = row.querySelector('[data-position-element="true"]');

    // Fallback to optimized single class selector
    if (!positionEl) {
      positionEl = row.querySelector('.position-display');
    }

    if (positionEl) {
      positionElementCache.set(row, positionEl);
    }
  }
}

let positionElementCache = new WeakMap();

// Optimized position number update with caching
function updatePositionNumbers(container, isMobile) {
  let rows;

  if (isMobile) {
    rows = container.children;
  } else {
    const rowsContainer = container.querySelector('.album-rows-container');
    rows = rowsContainer ? rowsContainer.children : container.children;
  }

  // Direct execution for immediate position updates
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Use cached position element or find and cache it
    let positionEl = positionElementCache.get(row);
    if (!positionEl) {
      // Try O(1) lookup first using data attribute
      positionEl = row.querySelector('[data-position-element="true"]');

      // Fallback to optimized single class selector
      if (!positionEl) {
        positionEl = row.querySelector('.position-display');
      }

      if (positionEl) {
        positionElementCache.set(row, positionEl);
      }
    }

    if (positionEl) {
      positionEl.textContent = i + 1;
    }
    row.dataset.index = i;
  }
}

// Debounced save function to batch rapid changes
let saveTimeout = null;
function debouncedSaveList(listName, listData, delay = 300) {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      await saveList(listName, listData);
    } catch (error) {
      console.error('Error saving list:', error);
      showToast('Error saving list order', 'error');
    }
  }, delay);
}

// Mobile autoscroll implementation
let mobileAutoscrollInterval = null;
let mobileScrollContainer = null;

function startMobileAutoscroll(sortableContainer) {
  // Find the main scroll container if not already found
  if (!mobileScrollContainer) {
    mobileScrollContainer = document.querySelector(
      'main .h-full.overflow-y-auto'
    );
  }
  if (!mobileScrollContainer) {
    console.warn('Mobile scroll container not found');
    return;
  }

  // Clear any existing interval
  stopMobileAutoscroll();

  // Start monitoring for autoscroll
  mobileAutoscrollInterval = setInterval(() => {
    // Try multiple selectors to find the dragged element
    let draggedElement =
      document.querySelector('.sortable-drag') ||
      document.querySelector('.sortable-chosen') ||
      document.querySelector('.dragging-mobile');

    if (!draggedElement) return;

    const containerRect = mobileScrollContainer.getBoundingClientRect();
    const draggedRect = draggedElement.getBoundingClientRect();

    const scrollZoneSize = 100; // Increased trigger zone for easier mobile use
    const scrollSpeed = 6; // Slightly slower for better control

    // Check if dragged element is near top or bottom of scroll container
    const distanceFromTop = draggedRect.top - containerRect.top;
    const distanceFromBottom = containerRect.bottom - draggedRect.bottom;

    // More generous boundaries for mobile
    if (distanceFromTop < scrollZoneSize && distanceFromTop > -50) {
      // Scroll up
      const intensity = Math.max(0.1, 1 - distanceFromTop / scrollZoneSize);
      const scrollAmount = scrollSpeed * intensity;
      mobileScrollContainer.scrollTop = Math.max(
        0,
        mobileScrollContainer.scrollTop - scrollAmount
      );
    } else if (
      distanceFromBottom < scrollZoneSize &&
      distanceFromBottom > -50
    ) {
      // Scroll down
      const intensity = Math.max(0.1, 1 - distanceFromBottom / scrollZoneSize);
      const scrollAmount = scrollSpeed * intensity;
      const maxScroll =
        mobileScrollContainer.scrollHeight - mobileScrollContainer.clientHeight;
      mobileScrollContainer.scrollTop = Math.min(
        maxScroll,
        mobileScrollContainer.scrollTop + scrollAmount
      );
    }
  }, 16); // ~60fps
}

function stopMobileAutoscroll() {
  if (mobileAutoscrollInterval) {
    clearInterval(mobileAutoscrollInterval);
    mobileAutoscrollInterval = null;
  }
  mobileScrollContainer = null;
}

// Touch-based autoscroll for mobile
let touchAutoscrollInterval = null;
let lastTouchY = null;

function startTouchAutoscroll(draggedElement) {
  if (!mobileScrollContainer) {
    mobileScrollContainer = document.querySelector(
      'main .h-full.overflow-y-auto'
    );
  }
  if (!mobileScrollContainer) return;

  // Track touch movements
  const handleTouchMove = (e) => {
    if (e.touches && e.touches.length > 0) {
      lastTouchY = e.touches[0].clientY;
    }
  };

  document.addEventListener('touchmove', handleTouchMove, { passive: true });

  // Clear any existing interval
  stopTouchAutoscroll();

  touchAutoscrollInterval = setInterval(() => {
    if (lastTouchY === null) return;

    const containerRect = mobileScrollContainer.getBoundingClientRect();
    const scrollZoneSize = 120; // Larger zone for touch
    const scrollSpeed = 8;

    // Check touch position relative to scroll container
    const distanceFromTop = lastTouchY - containerRect.top;
    const distanceFromBottom = containerRect.bottom - lastTouchY;

    if (distanceFromTop < scrollZoneSize && distanceFromTop > 0) {
      // Scroll up
      const intensity = Math.max(0.1, 1 - distanceFromTop / scrollZoneSize);
      const scrollAmount = scrollSpeed * intensity;
      mobileScrollContainer.scrollTop = Math.max(
        0,
        mobileScrollContainer.scrollTop - scrollAmount
      );
    } else if (distanceFromBottom < scrollZoneSize && distanceFromBottom > 0) {
      // Scroll down
      const intensity = Math.max(0.1, 1 - distanceFromBottom / scrollZoneSize);
      const scrollAmount = scrollSpeed * intensity;
      const maxScroll =
        mobileScrollContainer.scrollHeight - mobileScrollContainer.clientHeight;
      mobileScrollContainer.scrollTop = Math.min(
        maxScroll,
        mobileScrollContainer.scrollTop + scrollAmount
      );
    }
  }, 16);

  // Store the cleanup function
  touchAutoscrollInterval._cleanup = () => {
    document.removeEventListener('touchmove', handleTouchMove);
  };
}

function stopTouchAutoscroll() {
  if (touchAutoscrollInterval) {
    clearInterval(touchAutoscrollInterval);
    if (touchAutoscrollInterval._cleanup) {
      touchAutoscrollInterval._cleanup();
    }
    touchAutoscrollInterval = null;
  }
  lastTouchY = null;
}

// Clear cache when list changes - use rebuildPositionCache instead
// Unified sorting function using SortableJS for both desktop and mobile
function initializeUnifiedSorting(container, isMobile) {
  if (!window.Sortable) {
    console.error('SortableJS not loaded');
    return;
  }

  // Clean up any existing sortable instance
  if (container._sortable) {
    container._sortable.destroy();
  }

  // Find the sortable container
  const sortableContainer = isMobile
    ? container.querySelector('.mobile-album-list') || container
    : container.querySelector('.album-rows-container') || container;

  if (!sortableContainer) {
    console.error('Sortable container not found');
    return;
  }

  // Initialize mobile scroll container reference for mobile
  if (isMobile && !mobileScrollContainer) {
    mobileScrollContainer = document.querySelector(
      'main .h-full.overflow-y-auto'
    );
  }

  // Configure SortableJS options
  const sortableOptions = {
    animation: 200,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',

    // Touch-and-hold configuration for mobile
    ...(isMobile && {
      delay: 500, // 500ms touch-and-hold delay
      delayOnTouchOnly: true,
      touchStartThreshold: 10,
      forceFallback: true,
      fallbackTolerance: 5,
      // Prevent scrolling during drag
      preventOnFilter: false,
      onChoose: function (evt) {
        // Disable scrolling on the container when drag starts
        if (mobileScrollContainer) {
          mobileScrollContainer.style.overflowY = 'hidden';
          mobileScrollContainer.style.touchAction = 'none';
        }
      },
      onUnchoose: function (evt) {
        // Re-enable scrolling when drag is cancelled
        if (mobileScrollContainer) {
          mobileScrollContainer.style.overflowY = 'auto';
          mobileScrollContainer.style.touchAction = 'auto';
        }
      },
    }),

    // Filter to prevent dragging on interactive elements
    filter: 'button, input, textarea, select, .no-drag',
    preventOnFilter: true,

    // Configure scrolling - disable built-in autoscroll on mobile, use custom implementation
    scroll: !isMobile, // Disable built-in autoscroll on mobile
    scrollSensitivity: isMobile ? 50 : 30,
    scrollSpeed: isMobile ? 15 : 10,

    // Enhanced event handlers
    onStart: function (evt) {
      // Visual feedback
      if (!isMobile) {
        document.body.classList.add('desktop-dragging');
      } else {
        // Mobile-specific feedback - don't manipulate body overflow
        evt.item.classList.add('dragging-mobile');

        // Disable scrolling during drag to prevent conflicts
        if (mobileScrollContainer) {
          mobileScrollContainer.style.overflowY = 'hidden';
          mobileScrollContainer.style.touchAction = 'none';
        }

        // Start custom autoscroll for mobile
        startMobileAutoscroll(sortableContainer);

        // Also start touch-based autoscroll
        startTouchAutoscroll(evt.item);

        // Haptic feedback if available
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
      }
    },
    onEnd: async function (evt) {
      // Clean up visual feedback
      if (!isMobile) {
        document.body.classList.remove('desktop-dragging');
      } else {
        evt.item.classList.remove('dragging-mobile');

        // Re-enable scrolling after drag ends
        if (mobileScrollContainer) {
          mobileScrollContainer.style.overflowY = 'auto';
          mobileScrollContainer.style.touchAction = 'auto';
        }

        // Stop custom autoscroll for mobile
        stopMobileAutoscroll();
        stopTouchAutoscroll();
      }

      const oldIndex = evt.oldIndex;
      const newIndex = evt.newIndex;

      if (oldIndex !== newIndex) {
        try {
          // Update the data
          const list = lists[currentList];
          const [movedItem] = list.splice(oldIndex, 1);
          list.splice(newIndex, 0, movedItem);

          // Immediate optimistic UI update
          updatePositionNumbers(sortableContainer, isMobile);

          // Debounced server save to batch rapid changes
          debouncedSaveList(currentList, list);
        } catch (error) {
          console.error('Error saving reorder:', error);
          if (window.showToast) {
            window.showToast('Error saving changes', 'error');
          }
          // Revert the change on error
          const items = Array.from(evt.to.children);
          const itemToMove = items[newIndex];
          if (oldIndex < items.length) {
            evt.to.insertBefore(itemToMove, items[oldIndex]);
          } else {
            evt.to.appendChild(itemToMove);
          }
          updatePositionNumbers(sortableContainer, isMobile);
        }
      }
    },
  };
  // Initialize SortableJS
  const sortable = new Sortable(sortableContainer, sortableOptions);

  // Store reference for cleanup
  container._sortable = sortable;
}

// Add this function to handle mobile album actions
window.showMobileAlbumMenu = function (indexOrElement) {
  let index = indexOrElement;
  if (typeof indexOrElement !== 'number') {
    const card = indexOrElement.closest('.album-card');
    if (!card) return;
    index = parseInt(card.dataset.index);
  }

  // Validate index
  if (
    isNaN(index) ||
    index < 0 ||
    !lists[currentList] ||
    index >= lists[currentList].length
  ) {
    console.error('Invalid album index:', index);
    return;
  }

  const album = lists[currentList][index];

  // Create a unique identifier for this album to prevent stale index issues
  const albumId =
    `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();

  const actionSheet = document.createElement('div');
  actionSheet.className = 'fixed inset-0 z-50 lg:hidden';
  actionSheet.innerHTML = `
    <div class="absolute inset-0 bg-black bg-opacity-50" onclick="this.parentElement.remove()"></div>
    <div class="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl safe-area-bottom">
      <div class="p-4">
        <div class="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4"></div>
        <h3 class="font-semibold text-white mb-1 truncate">${album.album}</h3>
        <p class="text-sm text-gray-400 mb-4 truncate">${album.artist}</p>
        
        <button onclick="showMobileEditFormSafe('${albumId}'); this.closest('.fixed').remove();"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
          <i class="fas fa-edit mr-3 text-gray-400"></i>Edit Details
        </button>

        <button onclick="this.closest('.fixed').remove(); playAlbumSafe('${albumId}');"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
          <i class="fas fa-play mr-3 text-gray-400"></i>Play Album
        </button>

        <button onclick="this.closest('.fixed').remove(); removeAlbumSafe('${albumId}');"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded text-red-500">
          <i class="fas fa-trash mr-3"></i>Remove from List
        </button>
        
        <button onclick="this.closest('.fixed').remove()" 
                class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded">
          Cancel
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(actionSheet);
};

// Helper function to find album by identity instead of index
function findAlbumByIdentity(albumId) {
  if (!currentList || !lists[currentList]) return null;

  for (let i = 0; i < lists[currentList].length; i++) {
    const album = lists[currentList][i];
    const currentId =
      `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
    if (currentId === albumId) {
      return { album, index: i };
    }
  }
  return null;
}

// Safe wrapper for mobile edit form that uses album identity
window.showMobileEditFormSafe = function (albumId) {
  const result = findAlbumByIdentity(albumId);
  if (!result) {
    showToast('Album not found - it may have been moved or removed', 'error');
    return;
  }
  showMobileEditForm(result.index);
};

// Safe wrapper for play album that uses album identity
window.playAlbumSafe = function (albumId) {
  const result = findAlbumByIdentity(albumId);
  if (!result) {
    showToast('Album not found - it may have been moved or removed', 'error');
    return;
  }
  playAlbum(result.index);
};

// Safe wrapper for remove album that uses album identity
window.removeAlbumSafe = function (albumId) {
  const result = findAlbumByIdentity(albumId);
  if (!result) {
    showToast('Album not found - it may have been moved or removed', 'error');
    return;
  }

  // Use the existing remove logic but with the current index
  currentContextAlbum = result.index;
  document.getElementById('removeAlbumOption').click();
};

// Mobile edit form (basic implementation)
window.showMobileEditForm = function (index) {
  // Validate inputs
  if (!currentList || !lists[currentList]) {
    showToast('No list selected', 'error');
    return;
  }

  if (isNaN(index) || index < 0 || index >= lists[currentList].length) {
    showToast('Invalid album selected', 'error');
    return;
  }

  const album = lists[currentList][index];
  const originalReleaseDate = album.release_date || '';
  const inputReleaseDate = originalReleaseDate
    ? normalizeDateForInput(originalReleaseDate) ||
      new Date().toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  // Create the edit modal
  const editModal = document.createElement('div');
  editModal.className =
    'fixed inset-0 z-50 bg-gray-900 flex flex-col overflow-hidden lg:max-w-2xl lg:mx-auto lg:my-8 lg:rounded-lg lg:shadow-2xl';
  editModal.innerHTML = `
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b border-gray-800 flex-shrink-0">
      <button onclick="this.closest('.fixed').remove()" class="p-2 -m-2 text-gray-400 hover:text-white">
        <i class="fas fa-times text-xl"></i>
      </button>
      <h3 class="text-lg font-semibold text-white flex-1 text-center px-4">Edit Album</h3>
      <button id="mobileEditSaveBtn" class="text-red-500 font-semibold whitespace-nowrap">Save</button>
    </div>
    
    <!-- Form Content -->
    <div class="flex-1 overflow-y-auto overflow-x-hidden -webkit-overflow-scrolling-touch">
      <form id="mobileEditForm" class="p-4 space-y-4 max-w-full">
        <!-- Album Cover Preview -->
        ${
          album.cover_image
            ? `
          <div class="flex justify-center mb-4">
            <img src="data:image/${album.cover_image_format || 'PNG'};base64,${album.cover_image}" 
                 alt="${album.album}" 
                 class="w-32 h-32 rounded-lg object-cover shadow-md">
          </div>
        `
            : ''
        }
        
        <!-- Artist Name -->
        <div class="w-full">
          <label class="block text-gray-400 text-sm mb-2">Artist</label>
          <input 
            type="text" 
            id="editArtist" 
            value="${album.artist || ''}"
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
            placeholder="Artist name"
          >
        </div>
        
        <!-- Album Title -->
        <div class="w-full">
          <label class="block text-gray-400 text-sm mb-2">Album</label>
          <input 
            type="text" 
            id="editAlbum" 
            value="${album.album || ''}"
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
            placeholder="Album title"
          >
        </div>
        
        <!-- Release Date -->
        <div class="w-full">
          <label class="block text-gray-400 text-sm mb-2">Release Date</label>
          <input
            type="date"
            id="editReleaseDate"
            value="${inputReleaseDate}"
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
            style="display: block; width: 100%; min-height: 48px; -webkit-appearance: none;"
          >
          ${!album.release_date ? '<p class="text-xs text-gray-500 mt-1">No date set - defaulting to today</p>' : ''}
        </div>
        
        <!-- Country - Native Select -->
        <div class="w-full">
          <label class="block text-gray-400 text-sm mb-2">Country</label>
          <div class="relative">
            <select 
              id="editCountry" 
              class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-red-600 transition duration-200 appearance-none pr-10"
            >
              <option value="">Select a country...</option>
              ${availableCountries
                .map(
                  (country) =>
                    `<option value="${country}" ${country === album.country ? 'selected' : ''}>${country}</option>`
                )
                .join('')}
            </select>
            <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </div>
          </div>
        </div>
        
        <!-- Genre 1 - Native Select -->
        <div class="w-full">
          <label class="block text-gray-400 text-sm mb-2">Primary Genre</label>
          <div class="relative">
            <select 
              id="editGenre1" 
              class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-red-600 transition duration-200 appearance-none pr-10"
            >
              <option value="">Select a genre...</option>
              ${availableGenres
                .map(
                  (genre) =>
                    `<option value="${genre}" ${genre === (album.genre_1 || album.genre) ? 'selected' : ''}>${genre}</option>`
                )
                .join('')}
            </select>
            <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </div>
          </div>
        </div>
        
        <!-- Genre 2 - Native Select -->
        <div class="w-full">
          <label class="block text-gray-400 text-sm mb-2">Secondary Genre</label>
          <div class="relative">
            <select 
              id="editGenre2" 
              class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-red-600 transition duration-200 appearance-none pr-10"
            >
              <option value="">None (optional)</option>
              ${availableGenres
                .map((genre) => {
                  const currentGenre2 =
                    album.genre_2 &&
                    album.genre_2 !== 'Genre 2' &&
                    album.genre_2 !== '-'
                      ? album.genre_2
                      : '';
                  return `<option value="${genre}" ${genre === currentGenre2 ? 'selected' : ''}>${genre}</option>`;
                })
                .join('')}
            </select>
            <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </div>
          </div>
        </div>
        
        <!-- Comments -->
        <div class="w-full">
          <label class="block text-gray-400 text-sm mb-2">Comments</label>
          <textarea
            id="editComments"
            rows="3"
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200 resize-none"
            placeholder="Add your notes..."
          >${album.comments || album.comment || ''}</textarea>
        </div>

        <!-- Track Selection -->
        <div class="w-full" id="trackPickWrapper">
          <div class="flex items-center justify-between">
            <label class="block text-gray-400 text-sm mb-2">Selected Track</label>
            <button type="button" id="fetchTracksBtn" class="text-xs text-red-500 hover:underline">Get</button>
          </div>
          <div id="trackPickContainer">
          ${
            Array.isArray(album.tracks) && album.tracks.length > 0
              ? `
            <ul class="space-y-2">
              ${album.tracks
                .map(
                  (t, idx) => `
                <li>
                  <label class="flex items-center space-x-2">
                    <input type="checkbox" class="track-pick-checkbox" value="${t}" ${t === (album.track_pick || '') ? 'checked' : ''}>
                    <span>${t}</span>
                  </label>
                </li>`
                )
                .join('')}
            </ul>
          `
              : `
            <input type="number" id="editTrackPickNumber" value="${album.track_pick || ''}"
                   class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
                   placeholder="Enter track number">
          `
          }
          </div>
        </div>

        <!-- Spacer for bottom padding -->
        <div class="h-4"></div>
      </form>
    </div>
  `;

  document.body.appendChild(editModal);

  function setupTrackPickCheckboxes() {
    if (!trackPickContainer) return;
    const boxes = trackPickContainer.querySelectorAll(
      'input.track-pick-checkbox'
    );
    boxes.forEach((box) => {
      box.onchange = () => {
        if (box.checked) {
          boxes.forEach((other) => {
            if (other !== box) other.checked = false;
          });
        }
      };
    });
  }

  // Fetch track list when button is clicked
  const fetchBtn = document.getElementById('fetchTracksBtn');
  const trackPickContainer = document.getElementById('trackPickContainer');
  setupTrackPickCheckboxes();
  if (fetchBtn) {
    fetchBtn.onclick = async () => {
      if (!album.album_id) return;
      fetchBtn.textContent = '...';
      fetchBtn.disabled = true;
      try {
        const tracks = await fetchTracksForAlbum(album);
        album.tracks = tracks;
        if (trackPickContainer) {
          trackPickContainer.innerHTML =
            tracks.length > 0
              ? `<ul class="space-y-2">${tracks
                  .map(
                    (t) => `
                <li>
                  <label class="flex items-center space-x-2">
                    <input type="checkbox" class="track-pick-checkbox" value="${t}">
                    <span>${t}</span>
                  </label>
                </li>`
                  )
                  .join('')}</ul>`
              : `<input type="number" id="editTrackPickNumber" value="${album.track_pick || ''}"
                   class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
                   placeholder="Enter track number">`;
          setupTrackPickCheckboxes();
        }
        showToast('Tracks loaded');
      } catch (err) {
        console.error('Track fetch error:', err);
        showToast('Error fetching tracks', 'error');
      } finally {
        fetchBtn.textContent = 'Get';
        fetchBtn.disabled = false;
      }
    };
  }

  // Handle save (rest of the code remains the same)
  document.getElementById('mobileEditSaveBtn').onclick = async function () {
    // Gather all the values
    const newDateValue = document.getElementById('editReleaseDate').value;
    const normalizedOriginal = normalizeDateForInput(originalReleaseDate);
    const finalReleaseDate =
      originalReleaseDate && newDateValue === normalizedOriginal
        ? originalReleaseDate
        : formatDateForStorage(newDateValue);

    const updatedAlbum = {
      ...album,
      artist: document.getElementById('editArtist').value.trim(),
      album: document.getElementById('editAlbum').value.trim(),
      release_date: finalReleaseDate,
      country: document.getElementById('editCountry').value,
      genre_1: document.getElementById('editGenre1').value,
      genre: document.getElementById('editGenre1').value, // Keep both for compatibility
      genre_2: document.getElementById('editGenre2').value,
      // Persist tracks that may have been fetched while editing
      tracks: Array.isArray(album.tracks) ? album.tracks : undefined,
      track_pick: (() => {
        if (Array.isArray(album.tracks) && album.tracks.length > 0) {
          const checked = document.querySelector(
            '#trackPickContainer input[type="checkbox"]:checked'
          );
          return checked ? checked.value.trim() : '';
        }
        const numInput = document.getElementById('editTrackPickNumber');
        return numInput ? numInput.value.trim() : '';
      })(),
      comments: document.getElementById('editComments').value.trim(),
      comment: document.getElementById('editComments').value.trim(), // Keep both for compatibility
    };

    // Validate required fields
    if (!updatedAlbum.artist || !updatedAlbum.album) {
      showToast('Artist and Album are required', 'error');
      return;
    }

    // Update the album in the list
    lists[currentList][index] = updatedAlbum;

    try {
      // Save to server
      await saveList(currentList, lists[currentList]);

      // Close the modal first
      editModal.remove();

      // Force refresh the display to show changes
      displayAlbums(lists[currentList]);

      showToast('Album updated successfully');
    } catch (error) {
      console.error('Error saving album:', error);
      showToast('Error saving changes', 'error');

      // Revert changes on error
      lists[currentList][index] = album;

      // Close modal even on error
      editModal.remove();

      // Refresh display to show reverted state
      displayAlbums(lists[currentList]);
    }
  };

  // Focus on first input
  setTimeout(() => {
    document.getElementById('editArtist').focus();
  }, 100);
};

// File import handlers moved inside DOMContentLoaded

document.addEventListener('DOMContentLoaded', () => {
  // Convert server-side flash messages to toast notifications
  function convertFlashToToast() {
    // Add 'js-enabled' class to body to enable CSS that hides flash messages
    document.body.classList.add('js-enabled');

    // Find all flash messages with data-flash attribute
    const flashMessages = document.querySelectorAll('[data-flash]');

    console.log('Flash messages found:', flashMessages.length);
    flashMessages.forEach((element) => {
      const type = element.dataset.flash; // 'error', 'success', 'info'
      let message;

      // For login.ejs which uses data-flash-content
      if (element.dataset.flashContent) {
        message = element.dataset.flashContent;
      } else {
        // For templates.js which has text content directly
        message = element.textContent.trim();
      }

      console.log('Processing flash:', {
        type,
        message,
        hasContent: !!message,
      });

      if (message) {
        showToast(message, type);
      }
    });
  }

  // Call the conversion function immediately - this works on all pages
  convertFlashToToast();

  // Check if we're on a main app page (not auth pages)
  const isAuthPage = window.location.pathname.match(
    /\/(login|register|forgot)/
  );
  if (isAuthPage) {
    // Don't initialize main app features on auth pages
    return;
  }

  // Sidebar collapse functionality
  function initializeSidebarCollapse() {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const mainContent = document.querySelector('.main-content');

    if (!sidebar || !sidebarToggle || !mainContent) return;

    // Check localStorage for saved state
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

    // Apply initial state
    if (isCollapsed) {
      sidebar.classList.add('collapsed');
      mainContent.classList.add('sidebar-collapsed');
    }

    // Toggle handler
    sidebarToggle.addEventListener('click', () => {
      const isCurrentlyCollapsed = sidebar.classList.contains('collapsed');

      if (isCurrentlyCollapsed) {
        sidebar.classList.remove('collapsed');
        mainContent.classList.remove('sidebar-collapsed');
        localStorage.setItem('sidebarCollapsed', 'false');
      } else {
        sidebar.classList.add('collapsed');
        mainContent.classList.add('sidebar-collapsed');
        localStorage.setItem('sidebarCollapsed', 'true');
      }
    });
  }

  // Initialize sidebar collapse first
  initializeSidebarCollapse();

  // Quickly populate sidebar using cached list names
  const cachedLists = localStorage.getItem('cachedListNames');
  if (cachedLists) {
    try {
      const names = JSON.parse(cachedLists);
      names.forEach((name) => {
        if (!lists[name]) lists[name] = [];
      });
      updateListNav();
    } catch (err) {
      console.warn('Failed to parse cached list names:', err);
    }
  }

  // Load all required data and initialize features
  Promise.all([loadGenres(), loadCountries(), loadLists()])
    .then(() => {
      initializeContextMenu();
      initializeAlbumContextMenu();
      initializeCreateList();
      initializeRenameList();
      initializeImportConflictHandling();

      // Check localStorage first, then fall back to server value
      const localLastList = localStorage.getItem('lastSelectedList');
      const serverLastList = window.lastSelectedList;

      // Prioritize local storage if it exists and is valid
      if (localLastList && lists[localLastList]) {
        selectList(localLastList);
      } else if (serverLastList && lists[serverLastList]) {
        selectList(serverLastList);
        // Also update localStorage with server value
        localStorage.setItem('lastSelectedList', serverLastList);
      }

      // Initialize file import handlers
      const importBtn = document.getElementById('importBtn');
      const fileInput = document.getElementById('fileInput');

      if (importBtn && fileInput) {
        importBtn.onclick = () => {
          fileInput.click();
        };

        fileInput.onchange = async (e) => {
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = async (e) => {
              try {
                const data = JSON.parse(e.target.result);
                const fileName = file.name.replace(/\.json$/, '');

                // Check for existing list
                if (lists[fileName]) {
                  // Show import conflict modal
                  pendingImportData = data;
                  pendingImportFilename = fileName;
                  document.getElementById('conflictListName').textContent =
                    fileName;
                  document
                    .getElementById('importConflictModal')
                    .classList.remove('hidden');
                } else {
                  // Import directly
                  await saveList(fileName, data);
                  updateListNav();
                  selectList(fileName);
                  showToast(`Successfully imported ${data.length} albums`);
                }
              } catch (err) {
                showToast('Error importing file: ' + err.message, 'error');
              }
            };
            reader.onerror = () => {
              showToast('Error reading file', 'error');
            };
            reader.readAsText(file);
          }
          e.target.value = ''; // Reset file input
        };
      }

      // Initialize confirmation modal handlers
      const confirmModal = document.getElementById('confirmationModal');
      const cancelBtn = document.getElementById('confirmationCancelBtn');
      const confirmBtn = document.getElementById('confirmationConfirmBtn');

      if (confirmModal && cancelBtn && confirmBtn) {
        // Cancel button
        cancelBtn.onclick = hideConfirmation;

        // Confirm button
        confirmBtn.onclick = () => {
          if (confirmationCallback) {
            confirmationCallback();
          }
          hideConfirmation();
        };

        // Click outside to close
        confirmModal.onclick = (e) => {
          if (e.target === confirmModal) {
            hideConfirmation();
          }
        };

        // ESC key to close
        document.addEventListener('keydown', (e) => {
          if (
            e.key === 'Escape' &&
            !confirmModal.classList.contains('hidden')
          ) {
            hideConfirmation();
          }
        });
      }
    })
    .catch((err) => {
      showToast('Failed to initialize', 'error');
    });
});
// Add this right after the DOMContentLoaded event listener
window.addEventListener('beforeunload', () => {
  if (currentList) {
    localStorage.setItem('lastSelectedList', currentList);
  }
  if (listEventSource) {
    listEventSource.close();
  }
});

// Expose playAlbum for inline handlers
window.playAlbum = playAlbum;
