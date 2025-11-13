
import genresText from '../data/genres.txt?raw';
import countriesText from '../data/countries.txt?raw';


let musicServicesModule = null;
let importExportModule = null;


let lists = {};
let currentList = '';
let currentContextAlbum = null;
let currentContextAlbumId = null; 
let currentContextList = null;
const _genres = [];
const _countries = [];
let listEventSource = null;
let sseUpdateTimeout = null;


const availableGenres = genresText
  .split('\n')
  .map((g) => g.trim())
  .filter((g, index) => {
    
    return g.length > 0 || (index === 0 && g === '');
  })
  .sort((a, b) => {
    
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b);
  });

const availableCountries = countriesText
  .split('\n')
  .map((c) => c.trim())
  .filter((c, index) => {
    
    return c.length > 0 || (index === 0 && c === '');
  })
  .sort((a, b) => {
    
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b);
  });


window.availableCountries = availableCountries;

let pendingImportData = null;
let pendingImportFilename = null;
let confirmationCallback = null;



function hasListChanged(oldList, newList) {
  if (!oldList || !newList) return true;
  if (oldList.length !== newList.length) return true;

  
  const sampleSize = Math.min(15, oldList.length);
  for (let i = 0; i < sampleSize; i++) {
    const oldAlbum = oldList[i];
    const newAlbum = newList[i];
    if (!oldAlbum || !newAlbum) return true;
    if (
      oldAlbum._id !== newAlbum._id ||
      oldAlbum.position !== newAlbum.position
    ) {
      return true;
    }
  }

  
  
  return false;
}



function positionContextMenu(menu, x, y) {
  
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove('hidden');

  
  requestAnimationFrame(() => {
    
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    
    let adjustedX = x;
    let adjustedY = y;

    if (rect.right > viewportWidth) {
      adjustedX = x - rect.width;
    }
    if (rect.bottom > viewportHeight) {
      adjustedY = y - rect.height;
    }

    
    if (adjustedX !== x || adjustedY !== y) {
      menu.style.left = `${adjustedX}px`;
      menu.style.top = `${adjustedY}px`;
    }
  });
}


let trackAbortController = null;




const _POSITION_POINTS = {
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


document.addEventListener('click', () => {
  const contextMenu = document.getElementById('contextMenu');
  if (contextMenu) {
    contextMenu.classList.add('hidden');
  }

  const albumContextMenu = document.getElementById('albumContextMenu');
  if (albumContextMenu) {
    albumContextMenu.classList.add('hidden');
    
    currentContextAlbum = null;
    currentContextAlbumId = null;

    
    if (trackAbortController) {
      trackAbortController.abort();
      trackAbortController = null;
    }
  }
});


document.addEventListener('contextmenu', (e) => {
  const listButton = e.target.closest('#listNav button');
  if (listButton) {
    e.preventDefault();
  }
});

export function showConfirmation(
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

  
  if (onConfirm) {
    confirmationCallback = onConfirm;

    const handleConfirm = () => {
      modal.classList.add('hidden');
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdropClick);
      document.removeEventListener('keydown', handleEscKey);
      if (confirmationCallback) {
        confirmationCallback();
        confirmationCallback = null;
      }
    };

    const handleCancel = () => {
      modal.classList.add('hidden');
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdropClick);
      document.removeEventListener('keydown', handleEscKey);
      confirmationCallback = null;
    };

    const handleBackdropClick = (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    };

    const handleEscKey = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleBackdropClick);
    document.addEventListener('keydown', handleEscKey);

    modal.classList.remove('hidden');
    setTimeout(() => confirmBtn.focus(), 100);
    return;
  }

  
  return new Promise((resolve) => {
    const handleConfirm = () => {
      modal.classList.add('hidden');
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdropClick);
      document.removeEventListener('keydown', handleEscKey);
      resolve(true);
    };

    const handleCancel = () => {
      modal.classList.add('hidden');
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdropClick);
      document.removeEventListener('keydown', handleEscKey);
      resolve(false);
    };

    const handleBackdropClick = (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    };

    const handleEscKey = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleBackdropClick);
    document.addEventListener('keydown', handleEscKey);

    modal.classList.remove('hidden');
    setTimeout(() => confirmBtn.focus(), 100);
  });
}

function hideConfirmation() {
  const modal = document.getElementById('confirmationModal');
  modal.classList.add('hidden');
  confirmationCallback = null;
}


async function showServicePicker(hasSpotify, hasTidal) {
  if (!musicServicesModule) {
    musicServicesModule = await import('./modules/music-services.js');
  }
  return musicServicesModule.showServicePicker(hasSpotify, hasTidal);
}


function formatReleaseDate(dateStr) {
  if (!dateStr) return '';

  const userFormat = window.currentUser?.dateFormat || 'MM/DD/YYYY';

  
  if (/^\d{4}$/.test(dateStr)) {
    return dateStr;
  }

  
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


function normalizeDateForInput(dateStr) {
  if (!dateStr) return '';

  const userFormat = window.currentUser?.dateFormat;

  
  if (/^\d{4}$/.test(dateStr)) {
    return `${dateStr}-01-01`;
  }

  
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    return `${dateStr}-01`;
  }

  
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  
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


function formatDateForStorage(isoDate) {
  if (!isoDate) return '';
  const userFormat = window.currentUser?.dateFormat || 'MM/DD/YYYY';
  const [year, month, day] = isoDate.split('-');
  if (userFormat === 'DD/MM/YYYY') {
    return `${day}/${month}/${year}`;
  }
  return `${month}/${day}/${year}`;
}



async function downloadListAsJSON(listName) {
  if (!importExportModule) {
    showToast('Loading export module...', 'info', 1000);
    importExportModule = await import('./modules/import-export.js');
  }
  return importExportModule.downloadListAsJSON(listName, lists);
}


window.testConfirmation = async function () {
  const result = await showConfirmation(
    'Test Dialog',
    'This is a test message',
    'This is a sub-message',
    'Confirm'
  );
  return result;
};

async function updatePlaylist(listName, listData = null) {
  if (!musicServicesModule) {
    showToast('Loading playlist integration...', 'info', 1000);
    musicServicesModule = await import('./modules/music-services.js');
  }
  
  const data = listData !== null ? listData : lists[listName] || [];
  return musicServicesModule.updatePlaylist(listName, data);
}
window.updatePlaylist = updatePlaylist;


async function _showPlaylistValidationModal(listName, validation) {
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

    
    modal.onclick = (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
        resolve(false);
      }
    };
  });
}


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


function hidePlaylistProgressModal(modal) {
  if (modal && modal.parentNode) {
    document.body.removeChild(modal);
  }
}


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

  
  modal.onclick = (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  };

  
  if (isSuccess) {
    showToast(
      `Playlist "${listName}" created with ${result.successful} tracks`,
      'success'
    );
  }
}


function _showServiceSelectionModal(listName) {
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

  
  modal.onclick = (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  };
}


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


function initializeImportConflictHandling() {
  const conflictModal = document.getElementById('importConflictModal');
  const renameModal = document.getElementById('importRenameModal');
  const _conflictListNameSpan = document.getElementById('conflictListName');
  const originalImportNameSpan = document.getElementById('originalImportName');
  const importNewNameInput = document.getElementById('importNewName');

  
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
    
    return;
  }

  
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

  
  importRenameBtn.onclick = () => {
    conflictModal.classList.add('hidden');
    originalImportNameSpan.textContent = pendingImportFilename;

    
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

  
  importMergeBtn.onclick = async () => {
    if (!pendingImportData || !pendingImportFilename) return;

    conflictModal.classList.add('hidden');

    try {
      
      const existingList = lists[pendingImportFilename] || [];

      
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

  
  importCancelBtn.onclick = () => {
    conflictModal.classList.add('hidden');
    pendingImportData = null;
    pendingImportFilename = null;
    showToast('Import cancelled');
  };

  
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
      
      document.getElementById('conflictListName').textContent =
        pendingImportFilename;
      conflictModal.classList.remove('hidden');
    };
  }

  
  if (importNewNameInput) {
    importNewNameInput.onkeypress = (e) => {
      if (e.key === 'Enter' && confirmImportRenameBtn) {
        confirmImportRenameBtn.click();
      }
    };
  }
}


function makeCountryEditable(countryDiv, albumIndex) {
  
  if (countryDiv.querySelector('input')) {
    return;
  }

  
  const currentCountry = lists[currentList][albumIndex].country || '';

  
  const input = document.createElement('input');
  input.type = 'text';
  input.className =
    'w-full bg-gray-800 text-gray-300 text-sm p-1 rounded border border-gray-700 focus:outline-none focus:border-gray-500';
  input.value = currentCountry;
  input.placeholder = 'Type to search countries...';
  input.setAttribute('list', `country-list-${currentList}-${albumIndex}`);

  
  const datalist = document.createElement('datalist');
  datalist.id = `country-list-${currentList}-${albumIndex}`;

  
  availableCountries.forEach((country) => {
    const option = document.createElement('option');
    option.value = country;
    datalist.appendChild(option);
  });

  
  const originalOnClick = countryDiv.onclick;
  countryDiv.onclick = null; 

  
  countryDiv.innerHTML = '';
  countryDiv.appendChild(input);
  countryDiv.appendChild(datalist);
  input.focus();
  input.select();

  
  let handleClickOutside;

  const restoreDisplay = (valueToDisplay) => {
    
    if (handleClickOutside) {
      document.removeEventListener('click', handleClickOutside);
      handleClickOutside = null;
    }

    
    const displayValue = valueToDisplay || 'Country';
    const displayClass = valueToDisplay
      ? 'text-gray-300'
      : 'text-gray-500 italic';

    countryDiv.innerHTML = `<span class="text-sm ${displayClass} truncate cursor-pointer hover:text-gray-100">${displayValue}</span>`;

    
    countryDiv.onclick = originalOnClick;
  };

  const saveCountry = async (newCountry) => {
    
    newCountry = newCountry.trim();

    
    if (newCountry === currentCountry) {
      restoreDisplay(currentCountry);
      return;
    }

    
    if (newCountry !== '') {
      const isValid = availableCountries.some(
        (country) => country.toLowerCase() === newCountry.toLowerCase()
      );

      if (!isValid) {
        
        restoreDisplay(currentCountry);
        return;
      }

      
      const matchedCountry = availableCountries.find(
        (country) => country.toLowerCase() === newCountry.toLowerCase()
      );
      newCountry = matchedCountry; 
    }

    
    lists[currentList][albumIndex].country = newCountry;

    
    restoreDisplay(newCountry);

    try {
      await saveList(currentList, lists[currentList]);
      showToast(newCountry === '' ? 'Country cleared' : 'Country updated');
    } catch (_error) {
      showToast('Error saving country', 'error');
      
      lists[currentList][albumIndex].country = currentCountry;
      restoreDisplay(currentCountry);
    }
  };

  
  input.addEventListener('change', (e) => {
    saveCountry(e.target.value);
  });

  
  input.addEventListener('blur', () => {
    saveCountry(input.value);
  });

  
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveCountry(input.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      restoreDisplay(currentCountry);
    }
  });

  
  handleClickOutside = (e) => {
    if (!countryDiv.contains(e.target)) {
      saveCountry(input.value);
    }
  };

  
  setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
  }, 100);
}


let toastTimer = null;


export function showToast(message, type = 'success', duration = null) {
  const toast = document.getElementById('toast');

  
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  
  toast.classList.remove('show');

  toast.textContent = message;
  toast.className = 'toast ' + type;

  
  setTimeout(() => toast.classList.add('show'), 10);

  
  if (duration === null) {
    
    if (type === 'success' && message.includes('successfully')) {
      duration = 5000; 
    } else if (type === 'error') {
      duration = 5000; 
    } else if (message.includes('...')) {
      duration = 10000; 
    } else {
      duration = 3000; 
    }
  }

  
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    toastTimer = null;
  }, duration);
}


window.showToast = showToast;


export async function apiCall(url, options = {}) {
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
        
        try {
          const errorData = await response.json();

          
          
          if (
            errorData.code === 'TOKEN_EXPIRED' ||
            errorData.code === 'TOKEN_REFRESH_FAILED' ||
            (errorData.code === 'NOT_AUTHENTICATED' && errorData.service)
          ) {
            const error = new Error(
              errorData.error || `HTTP error! status: ${response.status}`
            );
            error.response = response;
            error.data = errorData;
            throw error;
          }

          
          clearListsCache();
          window.location.href = '/login';
          return;
        } catch (parseError) {
          
          if (parseError.data) {
            
            throw parseError;
          }
          
          clearListsCache();
          window.location.href = '/login';
          return;
        }
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
window.apiCall = apiCall;


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


function clearListsCache() {
  try {
    localStorage.removeItem('lists_cache');
    localStorage.removeItem('lists_cache_timestamp');
  } catch (error) {
    console.warn('Failed to clear lists cache:', error);
  }
}


async function loadLists() {
  try {
    const CACHE_KEY = 'lists_cache';
    const CACHE_TIMESTAMP_KEY = 'lists_cache_timestamp';
    const CACHE_TTL = 0; 

    let loadedFromCache = false;

    try {
      const cached = localStorage.getItem(CACHE_KEY);
      const cacheTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);

      if (cached) {
        const _cacheAge = Date.now() - (parseInt(cacheTimestamp) || 0);
        lists = JSON.parse(cached);

        if (typeof lists === 'object' && lists !== null) {
          window.lists = lists;
          updateListNav();
          loadedFromCache = true;

          
          trySelectLastList();
        } else {
          localStorage.removeItem(CACHE_KEY);
          localStorage.removeItem(CACHE_TIMESTAMP_KEY);
        }
      }
    } catch (cacheError) {
      console.warn('Cache read failed, clearing:', cacheError);
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(CACHE_TIMESTAMP_KEY);
    }

    const shouldRefresh =
      !loadedFromCache ||
      Date.now() - (parseInt(localStorage.getItem(CACHE_TIMESTAMP_KEY)) || 0) >
        CACHE_TTL;

    if (shouldRefresh) {
      const freshLists = await apiCall('/api/lists');

      
      listsDataFreshTimestamp = Date.now();

      
      const hasChanges = Object.keys(freshLists).some((listName) =>
        hasListChanged(lists[listName], freshLists[listName])
      );

      if (hasChanges || !loadedFromCache) {
        lists = freshLists;
        window.lists = lists;
        updateListNav();

        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(lists));
          localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
        } catch (storageError) {
          console.warn('Failed to cache lists:', storageError);
        }

        
        if (!loadedFromCache) {
          trySelectLastList();
        }
      }
    }
  } catch (error) {
    console.error('Error loading lists:', error);
    showToast('Error loading lists', 'error');
  }
}


let listsDataFreshTimestamp = 0;
const DATA_FRESH_WINDOW = 5000; 

function trySelectLastList() {
  
  if (window.currentList) return;

  const localLastList = localStorage.getItem('lastSelectedList');
  const serverLastList = window.lastSelectedList;

  
  const dataIsFresh = Date.now() - listsDataFreshTimestamp < DATA_FRESH_WINDOW;

  
  if (localLastList && lists[localLastList]) {
    selectList(localLastList, dataIsFresh);
  } else if (serverLastList && lists[serverLastList]) {
    selectList(serverLastList, dataIsFresh);
    
    localStorage.setItem('lastSelectedList', serverLastList);
  }
}


async function saveList(name, data) {
  try {
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

    try {
      localStorage.setItem('lists_cache', JSON.stringify(lists));
      localStorage.setItem('lists_cache_timestamp', Date.now().toString());

      
      localStorage.setItem(
        `lastSelectedListData_${name}`,
        JSON.stringify(cleanedData)
      );
    } catch (storageError) {
      console.warn('Failed to update cache after save:', storageError);
    }
  } catch (error) {
    showToast('Error saving list', 'error');
    throw error;
  }
}

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


async function pLimit(concurrency, tasks) {
  const results = [];
  const executing = [];

  for (const task of tasks) {
    const promise = task().then((result) => {
      executing.splice(executing.indexOf(promise), 1);
      return result;
    });

    results.push(promise);
    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
}



async function autoFetchTracksForList(name) {
  const list = lists[name];
  if (!list) return;

  const toFetch = list.filter(
    (album) => !Array.isArray(album.tracks) || album.tracks.length === 0
  );
  if (toFetch.length === 0) return;

  
  
  const tasks = toFetch.map((album) => () => {
    return fetchTracksForAlbum(album).catch((err) => {
      console.error('Auto track fetch failed:', err);
      return null; 
    });
  });

  await pLimit(5, tasks);
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

      
      clearTimeout(sseUpdateTimeout);
      sseUpdateTimeout = setTimeout(() => {
        
        
        const lastDragTime = activeDragOperations.get(name);
        if (lastDragTime && Date.now() - lastDragTime < 2000) {
          
          return;
        }

        
        
        const currentData = lists[name];
        const hasChanged = hasListChanged(currentData, data);

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

  
  downloadOption.onclick = () => {
    contextMenu.classList.add('hidden');

    if (!currentContextList) return;

    downloadListAsJSON(currentContextList);

    currentContextList = null;
  };

  
  renameOption.onclick = () => {
    contextMenu.classList.add('hidden');

    if (!currentContextList) return;

    openRenameModal(currentContextList);
  };

  
  updatePlaylistOption.onclick = async () => {
    contextMenu.classList.add('hidden');

    if (!currentContextList) return;

    try {
      
      const listData = lists[currentContextList] || [];
      await updatePlaylist(currentContextList, listData);
    } catch (err) {
      console.error('Update playlist failed', err);
    }

    currentContextList = null;
  };

  
  deleteOption.onclick = async () => {
    contextMenu.classList.add('hidden');

    if (!currentContextList) return;

    
    const confirmed = await showConfirmation(
      'Delete List',
      `Are you sure you want to delete the list "${currentContextList}"?`,
      'This action cannot be undone.',
      'Delete'
    );

    if (confirmed) {
      try {
        await apiCall(`/api/lists/${encodeURIComponent(currentContextList)}`, {
          method: 'DELETE',
        });

        delete lists[currentContextList];

        try {
          localStorage.setItem('lists_cache', JSON.stringify(lists));
          localStorage.setItem('lists_cache_timestamp', Date.now().toString());
        } catch (storageError) {
          console.warn('Failed to update cache after delete:', storageError);
        }

        if (currentList === currentContextList) {
          currentList = null;
          window.currentList = currentList;

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

        updateListNav();

        showToast(`List "${currentContextList}" deleted`);
      } catch (_error) {
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


function initializeAlbumContextMenu() {
  const contextMenu = document.getElementById('albumContextMenu');
  const removeOption = document.getElementById('removeAlbumOption');
  const editOption = document.getElementById('editAlbumOption');
  const playOption = document.getElementById('playAlbumOption');

  if (!contextMenu || !removeOption || !editOption || !playOption) return;

  
  editOption.onclick = () => {
    contextMenu.classList.add('hidden');

    if (currentContextAlbum === null) return;

    
    const expectedAlbum =
      lists[currentList] && lists[currentList][currentContextAlbum];
    if (expectedAlbum && currentContextAlbumId) {
      const expectedId =
        `${expectedAlbum.artist}::${expectedAlbum.album}::${expectedAlbum.release_date || ''}`.toLowerCase();
      if (expectedId === currentContextAlbumId) {
        
        showMobileEditForm(currentContextAlbum);
        return;
      }
    }

    
    if (currentContextAlbumId) {
      showMobileEditFormSafe(currentContextAlbumId);
    } else {
      showToast('Album not found - it may have been moved or removed', 'error');
    }
  };

  
  playOption.onclick = () => {
    contextMenu.classList.add('hidden');
    if (currentContextAlbum === null) return;

    
    const expectedAlbum =
      lists[currentList] && lists[currentList][currentContextAlbum];
    if (expectedAlbum && currentContextAlbumId) {
      const expectedId =
        `${expectedAlbum.artist}::${expectedAlbum.album}::${expectedAlbum.release_date || ''}`.toLowerCase();
      if (expectedId === currentContextAlbumId) {
        
        playAlbum(currentContextAlbum);
        return;
      }
    }

    
    if (currentContextAlbumId) {
      playAlbumSafe(currentContextAlbumId);
    } else {
      showToast('Album not found - it may have been moved or removed', 'error');
    }
  };

  
  removeOption.onclick = async () => {
    contextMenu.classList.add('hidden');
    if (currentContextAlbum === null) return;

    
    let album = lists[currentList] && lists[currentList][currentContextAlbum];
    let indexToRemove = currentContextAlbum;

    if (album && currentContextAlbumId) {
      const expectedId =
        `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
      if (expectedId !== currentContextAlbumId) {
        
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
          
          lists[currentList].splice(indexToRemove, 1);

          
          await saveList(currentList, lists[currentList]);

          
          selectList(currentList);

          showToast(`Removed "${album.album}" from the list`);
        } catch (error) {
          console.error('Error removing album:', error);
          showToast('Error removing album', 'error');

          
          await loadLists();
          selectList(currentList);
        }

        currentContextAlbum = null;
        currentContextAlbumId = null;
      }
    );
  };
}


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


function initializeCreateList() {
  const createBtn = document.getElementById('createListBtn');
  const modal = document.getElementById('createListModal');
  const nameInput = document.getElementById('newListName');
  const cancelBtn = document.getElementById('cancelCreateBtn');
  const confirmBtn = document.getElementById('confirmCreateBtn');

  if (!createBtn || !modal) return;

  
  createBtn.onclick = () => {
    modal.classList.remove('hidden');
    nameInput.value = '';
    nameInput.focus();
  };

  
  const closeModal = () => {
    modal.classList.add('hidden');
    nameInput.value = '';
  };

  cancelBtn.onclick = closeModal;

  
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  
  const createList = async () => {
    const listName = nameInput.value.trim();

    if (!listName) {
      showToast('Please enter a list name', 'error');
      nameInput.focus();
      return;
    }

    
    if (lists[listName]) {
      showToast('A list with this name already exists', 'error');
      nameInput.focus();
      return;
    }

    try {
      
      await saveList(listName, []);

      
      updateListNav();

      
      selectList(listName);

      
      closeModal();

      showToast(`Created list "${listName}"`);
    } catch (_error) {
      showToast('Error creating list', 'error');
    }
  };

  confirmBtn.onclick = createList;

  
  nameInput.onkeypress = (e) => {
    if (e.key === 'Enter') {
      createList();
    }
  };

  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });
}


function initializeRenameList() {
  const modal = document.getElementById('renameListModal');
  const currentNameSpan = document.getElementById('currentListName');
  const nameInput = document.getElementById('newListNameInput');
  const cancelBtn = document.getElementById('cancelRenameBtn');
  const confirmBtn = document.getElementById('confirmRenameBtn');

  if (!modal) return;

  
  const closeModal = () => {
    modal.classList.add('hidden');
    nameInput.value = '';
  };

  cancelBtn.onclick = closeModal;

  
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  
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

    
    if (lists[newName]) {
      showToast('A list with this name already exists', 'error');
      nameInput.focus();
      return;
    }

    try {
      
      const listData = lists[oldName];

      
      await saveList(newName, listData);

      await apiCall(`/api/lists/${encodeURIComponent(oldName)}`, {
        method: 'DELETE',
      });

      delete lists[oldName];

      try {
        localStorage.setItem('lists_cache', JSON.stringify(lists));
        localStorage.setItem('lists_cache_timestamp', Date.now().toString());
      } catch (storageError) {
        console.warn('Failed to update cache after rename:', storageError);
      }

      if (currentList === oldName) {
        currentList = newName;
        window.currentList = currentList;
        selectList(newName);
      }

      updateListNav();

      closeModal();

      showToast(`List renamed from "${oldName}" to "${newName}"`);
    } catch (_error) {
      showToast('Error renaming list', 'error');
    }
  };

  confirmBtn.onclick = renameList;

  
  nameInput.onkeypress = (e) => {
    if (e.key === 'Enter') {
      renameList();
    }
  };
}


function openRenameModal(listName) {
  const modal = document.getElementById('renameListModal');
  const currentNameSpan = document.getElementById('currentListName');
  const nameInput = document.getElementById('newListNameInput');

  if (!modal || !currentNameSpan || !nameInput) return;

  currentNameSpan.textContent = listName;
  nameInput.value = listName;
  modal.classList.remove('hidden');

  
  setTimeout(() => {
    nameInput.focus();
    nameInput.select();
  }, 100);
}


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
        
        button.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();

          currentContextList = listName;

          const contextMenu = document.getElementById('contextMenu');
          if (!contextMenu) return;

          
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

          
          positionContextMenu(contextMenu, e.clientX, e.clientY);
        });
      } else {
        
        let pressTimer;
        button.addEventListener(
          'touchstart',
          (_e) => {
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

  
  try {
    localStorage.setItem('cachedListNames', JSON.stringify(Object.keys(lists)));
  } catch (e) {
    console.warn('Failed to cache list names', e);
  }
}




async function selectList(listName, skipFetch = false) {
  try {
    currentList = listName;
    window.currentList = currentList;
    subscribeToList(listName);

    
    const cachedListData = localStorage.getItem(
      `lastSelectedListData_${listName}`
    );
    if (cachedListData && !lists[listName]) {
      try {
        lists[listName] = JSON.parse(cachedListData);
      } catch (err) {
        console.warn('Failed to parse cached list data:', err);
      }
    }

    
    if (lists[listName]) {
      displayAlbums(lists[listName]);
    }

    
    if (listName && !skipFetch) {
      try {
        const freshData = await apiCall(
          `/api/lists/${encodeURIComponent(listName)}`
        );
        lists[listName] = freshData;

        
        try {
          localStorage.setItem(
            `lastSelectedListData_${listName}`,
            JSON.stringify(freshData)
          );
        } catch (storageErr) {
          console.warn('Failed to cache list data:', storageErr);
        }

        
        if (currentList === listName) {
          displayAlbums(freshData);
        }
      } catch (err) {
        console.warn('Failed to fetch latest list data:', err);
      }
    }

    
    if (listName) {
      localStorage.setItem('lastSelectedList', listName);
    }

    
    updateMobileHeader();

    
    updateListNav();

    
    updateHeaderTitle(listName);

    
    const fab = document.getElementById('addAlbumFAB');
    if (fab) {
      fab.style.display = listName ? 'flex' : 'none';
    }

    
    
    if (listName) {
      autoFetchTracksForList(listName).catch((err) => {
        console.error('Background track fetch failed:', err);
      });
    }

    
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
  } catch (_error) {
    showToast('Error loading list', 'error');
  }
}


window.selectList = selectList;

function updateHeaderTitle(listName) {
  const headerSeparator = document.getElementById('headerSeparator');
  const headerListName = document.getElementById('headerListName');
  const headerAddAlbumBtn = document.getElementById('headerAddAlbumBtn');

  if (listName && headerSeparator && headerListName) {
    headerSeparator.classList.remove('hidden');
    headerListName.classList.remove('hidden');
    headerListName.textContent = listName;

    
    if (headerAddAlbumBtn) {
      headerAddAlbumBtn.classList.remove('hidden');
    }
  }
}


function _editMobileAlbum(_index) {
  
  
}

function _removeAlbum(index) {
  lists[currentList].splice(index, 1);
  saveList(currentList, lists[currentList]);
  selectList(currentList);
  showToast('Album removed');
}


function makeGenreEditable(genreDiv, albumIndex, genreField) {
  
  if (genreDiv.querySelector('input')) {
    return;
  }

  
  const currentGenre = lists[currentList][albumIndex][genreField] || '';

  
  const input = document.createElement('input');
  input.type = 'text';
  input.className =
    'w-full bg-gray-800 text-gray-300 text-sm p-1 rounded border border-gray-700 focus:outline-none focus:border-gray-500';
  input.value = currentGenre;
  input.placeholder = `Type to search ${genreField === 'genre_1' ? 'primary' : 'secondary'} genre...`;
  input.setAttribute(
    'list',
    `genre-list-${currentList}-${albumIndex}-${genreField}`
  );

  
  const datalist = document.createElement('datalist');
  datalist.id = `genre-list-${currentList}-${albumIndex}-${genreField}`;

  
  availableGenres.forEach((genre) => {
    const option = document.createElement('option');
    option.value = genre;
    datalist.appendChild(option);
  });

  
  const originalOnClick = genreDiv.onclick;
  genreDiv.onclick = null; 

  
  genreDiv.innerHTML = '';
  genreDiv.appendChild(input);
  genreDiv.appendChild(datalist);
  input.focus();
  input.select();

  
  let handleClickOutside;

  const restoreDisplay = (valueToDisplay) => {
    
    if (handleClickOutside) {
      document.removeEventListener('click', handleClickOutside);
      handleClickOutside = null;
    }

    
    let displayValue = valueToDisplay;
    let displayClass;

    if (genreField === 'genre_1') {
      
      displayValue = valueToDisplay || 'Genre 1';
      displayClass = valueToDisplay ? 'text-gray-300' : 'text-gray-500 italic';
    } else {
      
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

    
    genreDiv.onclick = originalOnClick;
  };

  const saveGenre = async (newGenre) => {
    
    newGenre = newGenre.trim();

    
    if (newGenre === currentGenre) {
      restoreDisplay(currentGenre);
      return;
    }

    
    if (newGenre !== '') {
      const isValid = availableGenres.some(
        (genre) => genre.toLowerCase() === newGenre.toLowerCase()
      );

      if (!isValid) {
        
        restoreDisplay(currentGenre);
        return;
      }

      
      const matchedGenre = availableGenres.find(
        (genre) => genre.toLowerCase() === newGenre.toLowerCase()
      );
      newGenre = matchedGenre; 
    }

    
    lists[currentList][albumIndex][genreField] = newGenre;

    
    restoreDisplay(newGenre);

    try {
      await saveList(currentList, lists[currentList]);
      showToast(newGenre === '' ? 'Genre cleared' : 'Genre updated');
    } catch (_error) {
      showToast('Error saving genre', 'error');
      
      lists[currentList][albumIndex][genreField] = currentGenre;
      restoreDisplay(currentGenre);
    }
  };

  
  input.addEventListener('change', (e) => {
    saveGenre(e.target.value);
  });

  
  input.addEventListener('blur', () => {
    saveGenre(input.value);
  });

  
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveGenre(input.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      restoreDisplay(currentGenre);
    }
  });

  
  handleClickOutside = (e) => {
    if (!genreDiv.contains(e.target)) {
      saveGenre(input.value);
    }
  };

  
  setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
  }, 100);
}


function makeCommentEditable(commentDiv, albumIndex) {
  const currentComment =
    lists[currentList][albumIndex].comments ||
    lists[currentList][albumIndex].comment ||
    '';

  
  const textarea = document.createElement('textarea');
  textarea.className =
    'w-full bg-gray-800 text-gray-300 text-sm p-2 rounded border border-gray-700 focus:outline-none focus:border-gray-500 resize-none';
  textarea.value = currentComment;
  textarea.rows = 2;

  
  commentDiv.innerHTML = '';
  commentDiv.appendChild(textarea);
  textarea.focus();
  textarea.select();

  
  const saveComment = async () => {
    const newComment = textarea.value.trim();
    lists[currentList][albumIndex].comments = newComment;
    lists[currentList][albumIndex].comment = newComment;

    try {
      await saveList(currentList, lists[currentList]);

      
      let displayComment = newComment;
      let displayClass = 'text-gray-300';

      
      if (!displayComment) {
        displayComment = 'Comment';
        displayClass = 'text-gray-500';
      }

      commentDiv.innerHTML = `<span class="text-sm ${displayClass} line-clamp-2 cursor-pointer hover:text-gray-100 comment-text">${displayComment}</span>`;

      
      commentDiv.onclick = () => makeCommentEditable(commentDiv, albumIndex);

      
      const commentTextEl = commentDiv.querySelector('.comment-text');
      if (commentTextEl && newComment) {
        setTimeout(() => {
          if (isTextTruncated(commentTextEl)) {
            commentTextEl.setAttribute('data-comment', newComment);
          }
        }, 0);
      }

      if (newComment !== currentComment) {
        showToast('Comment updated');
      }
    } catch (_error) {
      showToast('Error saving comment', 'error');
      
      let revertDisplay = currentComment;
      let revertClass = 'text-gray-300';
      if (!revertDisplay) {
        revertDisplay = 'Comment';
        revertClass = 'text-gray-500';
      }
      commentDiv.innerHTML = `<span class="text-sm ${revertClass} italic line-clamp-2 cursor-pointer hover:text-gray-100 comment-text">${revertDisplay}</span>`;
      commentDiv.onclick = () => makeCommentEditable(commentDiv, albumIndex);

      
      const revertTextEl = commentDiv.querySelector('.comment-text');
      if (revertTextEl && currentComment) {
        setTimeout(() => {
          if (isTextTruncated(revertTextEl)) {
            revertTextEl.setAttribute('data-comment', currentComment);
          }
        }, 0);
      }
    }
  };

  textarea.addEventListener('blur', saveComment);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      textarea.blur();
    }
    if (e.key === 'Escape') {
      
      let displayComment = currentComment;
      let displayClass = 'text-gray-300';

      
      if (!displayComment) {
        displayComment = 'Comment';
        displayClass = 'text-gray-500';
      }

      commentDiv.innerHTML = `<span class="text-sm ${displayClass} line-clamp-2 cursor-pointer hover:text-gray-100 comment-text">${displayComment}</span>`;
      commentDiv.onclick = () => makeCommentEditable(commentDiv, albumIndex);

      
      const cancelTextEl = commentDiv.querySelector('.comment-text');
      if (cancelTextEl && currentComment) {
        setTimeout(() => {
          if (isTextTruncated(cancelTextEl)) {
            cancelTextEl.setAttribute('data-comment', currentComment);
          }
        }, 0);
      }
    }
  });
}


function updateTrackCellDisplay(albumIndex, trackValue, tracks) {
  const isMobile = window.innerWidth < 1024;

  if (isMobile) {
    
    const container = document.getElementById('albumContainer');
    const mobileList = container?.querySelector('.mobile-album-list');
    if (!mobileList) return;

    const card = mobileList.children[albumIndex];
    if (!card) return;

    
    
    return;
  }

  
  const container = document.getElementById('albumContainer');
  const rowsContainer = container?.querySelector('.album-rows-container');
  if (!rowsContainer) return;

  const row = rowsContainer.children[albumIndex];
  if (!row) return;

  const trackCell = row.querySelector('.track-cell');
  if (!trackCell) return;

  
  let trackPickDisplay = '';
  let trackPickClass = 'text-gray-800 italic';

  if (trackValue && tracks && Array.isArray(tracks)) {
    const trackMatch = tracks.find((t) => t === trackValue);
    if (trackMatch) {
      const match = trackMatch.match(/^(\d+)[.\s-]?\s*(.*)$/);
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
    } else if (trackValue.match(/^\d+$/)) {
      trackPickDisplay = `Track ${trackValue}`;
      trackPickClass = 'text-gray-300';
    } else {
      trackPickDisplay = trackValue;
      trackPickClass = 'text-gray-300';
    }
  }

  if (!trackPickDisplay) {
    trackPickDisplay = 'Select Track';
  }

  
  trackCell.innerHTML = `<span class="text-sm ${trackPickClass} truncate cursor-pointer hover:text-gray-100" title="${trackValue || 'Click to select track'}">${trackPickDisplay}</span>`;

  
  trackCell.onclick = async () => {
    const currentIndex = parseInt(row.dataset.index);
    const album = lists[currentList][currentIndex];
    if (!album.tracks || album.tracks.length === 0) {
      showToast('Fetching tracks...', 'info');
      try {
        await fetchTracksForAlbum(album);
        await saveList(currentList, lists[currentList]);
      } catch (_err) {
        showToast('Error fetching tracks', 'error');
        return;
      }
    }

    const rect = trackCell.getBoundingClientRect();
    showTrackSelectionMenu(album, currentIndex, rect.left, rect.bottom);
  };
}


function showTrackSelectionMenu(album, albumIndex, x, y) {
  
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
    
    const sortedTracks = [...album.tracks].sort((a, b) => {
      const numA = parseInt(a.match(/^(\d+)[.\s-]/) ? a.match(/^(\d+)/)[1] : 0);
      const numB = parseInt(b.match(/^(\d+)[.\s-]/) ? b.match(/^(\d+)/)[1] : 0);
      return numA && numB ? numA - numB : 0;
    });

    const currentAlbum = lists[currentList][albumIndex];
    const hasNoSelection = !currentAlbum || !currentAlbum.track_pick;

    let menuHTML = `
      <div class="track-menu-option px-4 py-2 hover:bg-gray-700 cursor-pointer text-sm" data-track-value="">
        <span class="${hasNoSelection ? 'text-red-500' : 'text-gray-400'}">
          ${hasNoSelection ? '<i class="fas fa-check mr-2"></i>' : ''}None (clear selection)
        </span>
      </div>
      <div class="border-t border-gray-700"></div>
    `;

    sortedTracks.forEach((track, idx) => {
      const isSelected =
        currentAlbum &&
        (currentAlbum.track_pick === track ||
          currentAlbum.track_pick === (idx + 1).toString());
      const match = track.match(/^(\d+)[.\s-]?\s*(.*)$/);
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

    
    menu.querySelectorAll('.track-menu-option').forEach((option) => {
      option.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const trackValue = option.dataset.trackValue;

        const freshAlbum = lists[currentList][albumIndex];
        if (!freshAlbum) {
          showToast('Album not found - list may have been updated', 'error');
          menu.remove();
          return;
        }

        const previousValue = freshAlbum.track_pick;

        freshAlbum.track_pick = trackValue;

        menu.remove();

        updateTrackCellDisplay(albumIndex, trackValue, freshAlbum.tracks);

        showToast(
          trackValue
            ? `Selected track: ${trackValue.substring(0, 50)}...`
            : 'Track selection cleared'
        );

        try {
          await saveList(currentList, lists[currentList]);
        } catch (_error) {
          freshAlbum.track_pick = previousValue;
          updateTrackCellDisplay(albumIndex, previousValue, freshAlbum.tracks);
          showToast('Error saving track selection', 'error');
        }
      };
    });
  }

  document.body.appendChild(menu);

  
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    if (rect.right > viewportWidth) {
      adjustedX = viewportWidth - rect.width - 10;
    }
    if (rect.bottom > viewportHeight) {
      adjustedY = y - rect.height;
    }

    if (adjustedX !== x || adjustedY !== y) {
      menu.style.left = `${adjustedX}px`;
      menu.style.top = `${adjustedY}px`;
    }
  });

  
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


function processAlbumData(album, index) {
  const position = index + 1;
  const albumName = album.album || 'Unknown Album';
  const artist = album.artist || 'Unknown Artist';
  const releaseDate = formatReleaseDate(album.release_date || '');
  const country = album.country || '';
  const countryDisplay = country || 'Country';
  const countryClass = country ? 'text-gray-300' : 'text-gray-800 italic';

  const genre1 = album.genre_1 || album.genre || '';
  const genre1Display = genre1 || 'Genre 1';
  const genre1Class = genre1 ? 'text-gray-300' : 'text-gray-800 italic';

  let genre2 = album.genre_2 || '';
  if (genre2 === 'Genre 2' || genre2 === '-') genre2 = '';
  const genre2Display = genre2 || 'Genre 2';
  const genre2Class = genre2 ? 'text-gray-300' : 'text-gray-800 italic';

  let comment = album.comments || album.comment || '';
  if (comment === 'Comment') comment = '';

  const coverImage = album.cover_image || '';
  const imageFormat = album.cover_image_format || 'PNG';

  
  const trackPick = album.track_pick || '';
  let trackPickDisplay = '';
  let trackPickClass = 'text-gray-800 italic';

  if (trackPick && album.tracks && Array.isArray(album.tracks)) {
    
    const trackMatch = album.tracks.find((t) => t === trackPick);
    if (trackMatch) {
      
      const match = trackMatch.match(/^(\d+)[.\s-]?\s*(.*)$/);
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


function createAlbumItem(album, index, isMobile = false) {
  const data = processAlbumData(album, index);

  if (isMobile) {
    return createMobileAlbumCard(data, index);
  } else {
    return createDesktopAlbumRow(data, index);
  }
}


function createDesktopAlbumRow(data, index) {
  const row = document.createElement('div');
  row.className = 'album-row album-grid gap-4 py-2';
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
      <div class="font-semibold text-gray-100 truncate">${data.albumName}</div>
      <div class="text-xs text-gray-400 mt-0.5">${data.releaseDate}</div>
    </div>
    <div class="flex items-center">
      <span class="text-sm ${data.artist ? 'text-gray-300' : 'text-gray-800 italic'} truncate cursor-pointer hover:text-gray-100">${data.artist}</span>
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
    <div class="flex items-center comment-cell relative">
      <span class="text-sm ${data.comment ? 'text-gray-300' : 'text-gray-800 italic'} line-clamp-2 cursor-pointer hover:text-gray-100 comment-text">${data.comment || 'Comment'}</span>
    </div>
    <div class="flex items-center track-cell">
      <span class="text-sm ${data.trackPickClass} truncate cursor-pointer hover:text-gray-100" title="${data.trackPick || 'Click to select track'}">${data.trackPickDisplay}</span>
    </div>
  `;

  
  attachDesktopEventHandlers(row, index);
  return row;
}


function attachDesktopEventHandlers(row, index) {
  
  const trackCell = row.querySelector('.track-cell');
  if (trackCell) {
    trackCell.onclick = async () => {
      const currentIndex = parseInt(row.dataset.index);
      const album = lists[currentList][currentIndex];
      if (!album.tracks || album.tracks.length === 0) {
        showToast('Fetching tracks...', 'info');
        try {
          await fetchTracksForAlbum(album);
          await saveList(currentList, lists[currentList]);
        } catch (_err) {
          showToast('Error fetching tracks', 'error');
          return;
        }
      }

      
      const rect = trackCell.getBoundingClientRect();
      showTrackSelectionMenu(album, currentIndex, rect.left, rect.bottom);
    };
  }

  
  const countryCell = row.querySelector('.country-cell');
  countryCell.onclick = () => {
    const currentIndex = parseInt(row.dataset.index);
    makeCountryEditable(countryCell, currentIndex);
  };

  
  const genre1Cell = row.querySelector('.genre-1-cell');
  genre1Cell.onclick = () => {
    const currentIndex = parseInt(row.dataset.index);
    makeGenreEditable(genre1Cell, currentIndex, 'genre_1');
  };

  const genre2Cell = row.querySelector('.genre-2-cell');
  genre2Cell.onclick = () => {
    const currentIndex = parseInt(row.dataset.index);
    makeGenreEditable(genre2Cell, currentIndex, 'genre_2');
  };

  
  const commentCell = row.querySelector('.comment-cell');
  commentCell.onclick = () => {
    const currentIndex = parseInt(row.dataset.index);
    makeCommentEditable(commentCell, currentIndex);
  };

  
  const album = lists[currentList][index];
  const comment = album.comments || album.comment || '';
  attachLinkPreview(commentCell, comment);

  
  const commentTextEl = commentCell.querySelector('.comment-text');
  if (commentTextEl && comment) {
    
    setTimeout(() => {
      if (isTextTruncated(commentTextEl)) {
        commentTextEl.setAttribute('data-comment', comment);
      }
    }, 0);
  }

  
  
  row.addEventListener('dblclick', (e) => {
    
    const isInteractiveCell =
      e.target.closest('.country-cell') ||
      e.target.closest('.genre-1-cell') ||
      e.target.closest('.genre-2-cell') ||
      e.target.closest('.comment-cell') ||
      e.target.closest('.track-cell');

    
    if (isInteractiveCell) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    
    const currentIndex = parseInt(row.dataset.index);

    
    if (lists[currentList] && lists[currentList][currentIndex]) {
      showMobileEditForm(currentIndex);
    } else {
      showToast('Album not found', 'error');
    }
  });

  
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();

    
    const currentIndex = parseInt(row.dataset.index);
    const album = lists[currentList][currentIndex];
    const albumId =
      `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();

    currentContextAlbum = currentIndex;
    currentContextAlbumId = albumId; 

    const contextMenu = document.getElementById('albumContextMenu');
    if (!contextMenu) return;

    
    positionContextMenu(contextMenu, e.clientX, e.clientY);
  });
}


function createMobileAlbumCard(data, index) {
  const cardWrapper = document.createElement('div');
  cardWrapper.className = 'album-card-wrapper';

  const card = document.createElement('div');
  card.className =
    'album-card album-row bg-gray-900 touch-manipulation transition-all relative overflow-hidden';
  card.dataset.index = index;

  card.innerHTML = `
    <div class="flex items-center h-full">
      <!-- Left section: Position number, Album cover, and Release date -->
      <div class="flex-shrink-0 flex items-center">
        <!-- Position number -->
        <div class="flex items-center justify-center text-gray-500 font-medium text-sm position-display pl-1.5" data-position-element="true">
          ${data.position}
        </div>

        <!-- Album cover with release date below -->
        <div class="flex flex-col items-center pl-1.5 py-1">
          <div class="flex-shrink-0">
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
          <!-- Release date below image -->
          <div class="text-xs text-gray-500 mt-1 whitespace-nowrap">
            ${data.releaseDate}
          </div>
        </div>
      </div>
      
      <!-- Main content -->
      <div class="flex-1 min-w-0 py-3 pr-3">
        <div class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            <h3 class="font-semibold text-white text-base leading-tight truncate">${data.albumName}</h3>
            <p class="text-sm text-gray-400 truncate mt-0.5">${data.artist}</p>
            
            <!-- Country row -->
            ${
              data.country
                ? `
              <div class="text-xs text-gray-500 mt-1">
                ${data.country}
              </div>
            `
                : ''
            }
            
            <!-- Genres row (if any) -->
            ${
              data.genre1 || data.genre2
                ? `
              <div class="text-xs text-gray-500 truncate mt-1">
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
        <button data-album-menu-btn
                class="p-2 text-gray-400 active:text-gray-200 no-drag">
          <i class="fas fa-ellipsis-v"></i>
        </button>
      </div>
    </div>
  `;

  cardWrapper.appendChild(card);

  
  attachMobileEventHandlers(card, index);
  return cardWrapper;
}


function attachMobileEventHandlers(card, index) {
  
  const album = lists[currentList][index];
  const comment = album.comments || album.comment || '';
  const contentDiv = card.querySelector('.flex-1.min-w-0');
  if (contentDiv) attachLinkPreview(contentDiv, comment);

  
  const menuBtn = card.querySelector('[data-album-menu-btn]');
  if (menuBtn) {
    
    menuBtn.addEventListener(
      'touchstart',
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );

    menuBtn.addEventListener(
      'touchend',
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      window.showMobileAlbumMenu(menuBtn);
    });
  }
}






const ENABLE_INCREMENTAL_UPDATES = true;


let lastRenderedAlbums = null;


function detectUpdateType(oldAlbums, newAlbums) {
  
  if (!ENABLE_INCREMENTAL_UPDATES || !oldAlbums) {
    return 'FULL_REBUILD';
  }

  
  if (oldAlbums.length !== newAlbums.length) {
    return 'FULL_REBUILD';
  }

  
  let positionChanges = 0;
  let fieldChanges = 0;
  let complexChanges = 0;

  for (let i = 0; i < newAlbums.length; i++) {
    const oldAlbum = oldAlbums[i];
    const newAlbum = newAlbums[i];

    
    const oldId =
      oldAlbum._id ||
      `${oldAlbum.artist}::${oldAlbum.album}::${oldAlbum.release_date}`;
    const newId =
      newAlbum._id ||
      `${newAlbum.artist}::${newAlbum.album}::${newAlbum.release_date}`;

    if (oldId !== newId) {
      positionChanges++;
    } else {
      
      if (
        oldAlbum.artist !== newAlbum.artist ||
        oldAlbum.album !== newAlbum.album ||
        oldAlbum.release_date !== newAlbum.release_date ||
        oldAlbum.country !== newAlbum.country ||
        oldAlbum.genre_1 !== newAlbum.genre_1 ||
        oldAlbum.genre_2 !== newAlbum.genre_2 ||
        oldAlbum.comments !== newAlbum.comments ||
        oldAlbum.track_pick !== newAlbum.track_pick
      ) {
        fieldChanges++;
      }

      
      if (oldAlbum.cover_image !== newAlbum.cover_image) {
        complexChanges++;
      }
    }
  }

  
  if (complexChanges > 0) {
    return 'FULL_REBUILD'; 
  }
  if (positionChanges === 0 && fieldChanges > 0 && fieldChanges <= 10) {
    return 'FIELD_UPDATE'; 
  }
  if (fieldChanges === 0 && positionChanges > 0) {
    return 'POSITION_UPDATE'; 
  }
  if (positionChanges + fieldChanges <= 15) {
    return 'HYBRID_UPDATE'; 
  }

  return 'FULL_REBUILD'; 
}


function updateAlbumFields(albums, isMobile) {
  const container = document.getElementById('albumContainer');
  if (!container) return false;

  const rowsContainer = isMobile
    ? container.querySelector('.mobile-album-list')
    : container.querySelector('.album-rows-container');

  if (!rowsContainer) return false;

  const rows = Array.from(rowsContainer.children);

  if (rows.length !== albums.length) {
    console.warn('DOM/data length mismatch, falling back');
    return false;
  }

  try {
    albums.forEach((album, index) => {
      const row = rows[index];
      if (!row) return;

      
      row.dataset.index = index;

      
      const data = processAlbumData(album, index);

      
      const positionEl =
        row.querySelector('[data-position-element="true"]') ||
        row.querySelector('.position-display');
      if (positionEl && positionEl.textContent !== data.position.toString()) {
        positionEl.textContent = data.position;
      }

      
      const artistSpan = isMobile
        ? row.querySelector(
            '.font-semibold.text-white + .text-sm.text-gray-400'
          )
        : row.querySelectorAll('.flex.items-center > span')[0];
      if (artistSpan) {
        artistSpan.textContent = data.artist;
        artistSpan.className = isMobile
          ? 'text-sm text-gray-400 truncate'
          : `text-sm ${data.artist ? 'text-gray-300' : 'text-gray-800 italic'} truncate cursor-pointer hover:text-gray-100`;
      }

      
      if (!isMobile) {
        const albumNameDiv = row.querySelector('.font-semibold.text-gray-100');
        if (albumNameDiv) albumNameDiv.textContent = data.albumName;

        const releaseDateDiv = row.querySelector('.text-xs.text-gray-400');
        if (releaseDateDiv) releaseDateDiv.textContent = data.releaseDate;
      } else {
        const albumNameEl = row.querySelector('.font-semibold.text-white');
        if (albumNameEl) albumNameEl.textContent = data.albumName;

        const releaseDateEl = row.querySelector('.text-xs.text-gray-500.mt-1');
        if (releaseDateEl) releaseDateEl.textContent = data.releaseDate;
      }

      
      const countryCell =
        row.querySelector('.country-cell') ||
        row.querySelector('[data-field="country"]');
      if (countryCell) {
        const countrySpan = countryCell.querySelector('span');
        if (countrySpan) {
          countrySpan.textContent = data.countryDisplay;
          countrySpan.className = `text-sm ${data.countryClass} truncate cursor-pointer hover:text-gray-100`;
        }
      }

      
      const genre1Cell =
        row.querySelector('.genre-1-cell') ||
        row.querySelector('[data-field="genre1"]');
      if (genre1Cell) {
        const genre1Span = genre1Cell.querySelector('span');
        if (genre1Span) {
          genre1Span.textContent = data.genre1Display;
          genre1Span.className = `text-sm ${data.genre1Class} truncate cursor-pointer hover:text-gray-100`;
        }
      }

      
      const genre2Cell =
        row.querySelector('.genre-2-cell') ||
        row.querySelector('[data-field="genre2"]');
      if (genre2Cell) {
        const genre2Span = genre2Cell.querySelector('span');
        if (genre2Span) {
          genre2Span.textContent = data.genre2Display;
          genre2Span.className = `text-sm ${data.genre2Class} truncate cursor-pointer hover:text-gray-100`;
        }
      }

      
      const commentCell =
        row.querySelector('.comment-cell') ||
        row.querySelector('[data-field="comment"]');
      if (commentCell) {
        const commentSpan = commentCell.querySelector('span');
        if (commentSpan) {
          commentSpan.textContent = data.comment || 'Comment';
          commentSpan.className = `text-sm ${data.comment ? 'text-gray-300' : 'text-gray-800 italic'} line-clamp-2 cursor-pointer hover:text-gray-100 comment-text`;

          
          if (data.comment) {
            commentSpan.setAttribute('data-comment', data.comment);
          } else {
            commentSpan.removeAttribute('data-comment');
          }
        }
      }

      
      const trackCell = row.querySelector('.track-cell');
      if (trackCell) {
        const trackSpan = trackCell.querySelector('span');
        if (trackSpan) {
          trackSpan.textContent = data.trackPickDisplay;
          trackSpan.className = `text-sm ${data.trackPickClass} truncate cursor-pointer hover:text-gray-100`;
          trackSpan.title = data.trackPick || 'Click to select track';
        }
      }
    });

    return true; 
  } catch (err) {
    console.error('Field update failed:', err);
    return false;
  }
}


function verifyDOMIntegrity(albums, isMobile) {
  const container = document.getElementById('albumContainer');
  if (!container) return false;

  const rowsContainer = isMobile
    ? container.querySelector('.mobile-album-list')
    : container.querySelector('.album-rows-container');

  if (!rowsContainer) return false;

  const rows = rowsContainer.children;
  return rows.length === albums.length;
}


function displayAlbums(albums) {
  const isMobile = window.innerWidth < 1024; 
  const container = document.getElementById('albumContainer');

  if (!container) {
    console.error('Album container not found!');
    return;
  }

  
  const updateType = detectUpdateType(lastRenderedAlbums, albums);

  if (updateType === 'FIELD_UPDATE' || updateType === 'HYBRID_UPDATE') {
    
    const success = updateAlbumFields(albums, isMobile);

    if (success && verifyDOMIntegrity(albums, isMobile)) {
      
      lastRenderedAlbums = albums ? JSON.parse(JSON.stringify(albums)) : null;

      
      const albumContainer = isMobile
        ? container.querySelector('.mobile-album-list')
        : container.querySelector('.album-rows-container');
      if (albumContainer) {
        prePopulatePositionCache(albumContainer, isMobile);
      }

      return; 
    }
    
    console.warn(
      `Incremental update (${updateType}) failed, falling back to full rebuild`
    );
  }

  
  
  
  positionElementCache = new WeakMap();

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

  
  let albumContainer;

  if (!isMobile) {
    
    albumContainer = document.createElement('div');
    albumContainer.className = 'w-full relative';

    
    const header = document.createElement('div');
    header.className =
      'album-header album-grid gap-4 py-2 text-sm font-semibold uppercase tracking-wider text-gray-300 border-b border-gray-800 sticky top-0 bg-black z-10';
    header.style.alignItems = 'center';
    header.innerHTML = `
      <div class="text-center">#</div>
      <div>Album</div>
      <div></div>
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

    
    albums.forEach((album, index) => {
      const row = createAlbumItem(album, index, false);
      rowsContainer.appendChild(row);
    });

    albumContainer.appendChild(rowsContainer);
  } else {
    
    albumContainer = document.createElement('div');
    albumContainer.className = 'mobile-album-list pb-20'; 

    
    albums.forEach((album, index) => {
      const card = createAlbumItem(album, index, true);
      albumContainer.appendChild(card);
    });
  }

  container.appendChild(albumContainer);

  
  prePopulatePositionCache(albumContainer, isMobile);

  
  initializeUnifiedSorting(container, isMobile);

  
  lastRenderedAlbums = albums ? JSON.parse(JSON.stringify(albums)) : null;
}


function clearPositionCache() {
  positionElementCache = new WeakMap();
}


function _rebuildPositionCache(container, isMobile) {
  clearPositionCache();
  prePopulatePositionCache(container, isMobile);
}


function prePopulatePositionCache(container, isMobile) {
  let rows;

  if (isMobile) {
    rows = container.children;
  } else {
    const rowsContainer = container.querySelector('.album-rows-container');
    rows = rowsContainer ? rowsContainer.children : container.children;
  }

  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    
    let positionEl = row.querySelector('[data-position-element="true"]');

    
    if (!positionEl) {
      positionEl = row.querySelector('.position-display');
    }

    if (positionEl) {
      positionElementCache.set(row, positionEl);
    }
  }
}

let positionElementCache = new WeakMap();


function updatePositionNumbers(container, isMobile) {
  let rows;

  if (isMobile) {
    rows = container.children;
  } else {
    const rowsContainer = container.querySelector('.album-rows-container');
    rows = rowsContainer ? rowsContainer.children : container.children;
  }

  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    
    let positionEl = positionElementCache.get(row);
    if (!positionEl) {
      
      positionEl = row.querySelector('[data-position-element="true"]');

      
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


function isTextTruncated(element) {
  
  return element.scrollHeight > element.clientHeight;
}


const activeDragOperations = new Map(); 


let saveTimeout = null;
function debouncedSaveList(listName, listData, delay = 300) {
  clearTimeout(saveTimeout);

  
  activeDragOperations.set(listName, Date.now());

  saveTimeout = setTimeout(async () => {
    try {
      await saveList(listName, listData);
      
      
      setTimeout(() => {
        activeDragOperations.delete(listName);
      }, 1000); 
    } catch (error) {
      console.error('Error saving list:', error);
      showToast('Error saving list order', 'error');
      activeDragOperations.delete(listName);
    }
  }, delay);
}





function initializeUnifiedSorting(container, isMobile) {
  if (!window.Sortable) {
    console.error('SortableJS not loaded');
    return;
  }

  
  if (container._sortable) {
    container._sortable.destroy();
  }

  
  const sortableContainer = isMobile
    ? container.querySelector('.mobile-album-list') || container
    : container.querySelector('.album-rows-container') || container;

  if (!sortableContainer) {
    console.error('Sortable container not found');
    return;
  }

  
  const scrollElement = isMobile
    ? sortableContainer.closest('.overflow-y-auto')
    : sortableContainer;

  
  const sortableOptions = {
    animation: 200,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',

    
    ...(isMobile && {
      delay: 350, 
      delayOnTouchOnly: true,
      touchStartThreshold: 3, 
      forceFallback: true,
      fallbackTolerance: 5,
    }),

    
    filter: 'button, input, textarea, select, .no-drag',
    preventOnFilter: false,

    
    scroll: scrollElement, 
    scrollSensitivity: isMobile ? 100 : 30, 
    scrollSpeed: isMobile ? 25 : 15, 
    bubbleScroll: false, 

    
    onStart: function (evt) {
      
      if (!isMobile) {
        document.body.classList.add('desktop-dragging');
      } else {
        
        evt.item.classList.add('dragging-mobile');

        
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
      }
    },
    onEnd: async function (evt) {
      
      if (!isMobile) {
        document.body.classList.remove('desktop-dragging');
      } else {
        evt.item.classList.remove('dragging-mobile');
      }

      const oldIndex = evt.oldIndex;
      const newIndex = evt.newIndex;

      if (oldIndex !== newIndex) {
        try {
          
          activeDragOperations.set(currentList, Date.now());

          
          const list = lists[currentList];
          const [movedItem] = list.splice(oldIndex, 1);
          list.splice(newIndex, 0, movedItem);

          
          updatePositionNumbers(sortableContainer, isMobile);

          
          debouncedSaveList(currentList, list);
        } catch (error) {
          console.error('Error saving reorder:', error);
          if (window.showToast) {
            window.showToast('Error saving changes', 'error');
          }
          
          const items = Array.from(evt.to.children);
          const itemToMove = items[newIndex];
          if (oldIndex < items.length) {
            evt.to.insertBefore(itemToMove, items[oldIndex]);
          } else {
            evt.to.appendChild(itemToMove);
          }
          updatePositionNumbers(sortableContainer, isMobile);
          activeDragOperations.delete(currentList);
        }
      }
    },
  };
  
  const sortable = new Sortable(sortableContainer, sortableOptions);

  
  container._sortable = sortable;
}


window.showMobileAlbumMenu = function (indexOrElement) {
  let index = indexOrElement;
  if (typeof indexOrElement !== 'number') {
    const card = indexOrElement.closest('.album-card');
    if (!card) return;
    index = parseInt(card.dataset.index);
  }

  
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

  
  const albumId =
    `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();

  
  const existingSheet = document.querySelector(
    '.fixed.inset-0.z-50.lg\\:hidden'
  );
  if (existingSheet) {
    existingSheet.remove();
  }

  const actionSheet = document.createElement('div');
  actionSheet.className = 'fixed inset-0 z-50 lg:hidden';
  actionSheet.innerHTML = `
    <div class="absolute inset-0 bg-black bg-opacity-50" data-backdrop></div>
    <div class="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl safe-area-bottom">
      <div class="p-4">
        <div class="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4"></div>
        <h3 class="font-semibold text-white mb-1 truncate">${album.album}</h3>
        <p class="text-sm text-gray-400 mb-4 truncate">${album.artist}</p>
        
        <button data-action="edit"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
          <i class="fas fa-edit mr-3 text-gray-400"></i>Edit Details
        </button>

        <button data-action="play"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
          <i class="fas fa-play mr-3 text-gray-400"></i>Play Album
        </button>

        <button data-action="remove"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded text-red-500">
          <i class="fas fa-trash mr-3"></i>Remove from List
        </button>
        
        <button data-action="cancel"
                class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded">
          Cancel
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(actionSheet);

  
  const backdrop = actionSheet.querySelector('[data-backdrop]');
  const editBtn = actionSheet.querySelector('[data-action="edit"]');
  const playBtn = actionSheet.querySelector('[data-action="play"]');
  const removeBtn = actionSheet.querySelector('[data-action="remove"]');
  const cancelBtn = actionSheet.querySelector('[data-action="cancel"]');

  const closeSheet = () => {
    actionSheet.remove();
  };

  backdrop.addEventListener('click', closeSheet);
  cancelBtn.addEventListener('click', closeSheet);

  editBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeSheet();
    window.showMobileEditFormSafe(albumId);
  });

  playBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeSheet();
    window.playAlbumSafe(albumId);
  });

  removeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeSheet();
    window.removeAlbumSafe(albumId);
  });
};


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


window.showMobileEditFormSafe = function (albumId) {
  const result = findAlbumByIdentity(albumId);
  if (!result) {
    showToast('Album not found - it may have been moved or removed', 'error');
    return;
  }
  showMobileEditForm(result.index);
};


window.playAlbumSafe = function (albumId) {
  const result = findAlbumByIdentity(albumId);
  if (!result) {
    showToast('Album not found - it may have been moved or removed', 'error');
    return;
  }
  playAlbum(result.index);
};


window.removeAlbumSafe = function (albumId) {
  const result = findAlbumByIdentity(albumId);
  if (!result) {
    showToast('Album not found - it may have been moved or removed', 'error');
    return;
  }

  
  currentContextAlbum = result.index;
  document.getElementById('removeAlbumOption').click();
};


window.showMobileEditForm = function (index) {
  
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

  
  const existingModals = document.querySelectorAll(
    '.fixed.inset-0.z-50.bg-gray-900'
  );
  existingModals.forEach((modal) => modal.remove());

  
  const editModal = document.createElement('div');
  editModal.className =
    'fixed inset-0 z-50 bg-gray-900 flex flex-col overflow-hidden lg:max-w-2xl lg:max-h-[85vh] lg:mx-auto lg:mt-20 lg:mb-8 lg:rounded-lg lg:shadow-2xl';
  editModal.innerHTML = `
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b border-gray-800 flex-shrink-0">
      <button data-close-editor class="p-2 -m-2 text-gray-400 hover:text-white">
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
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
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
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
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
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
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
              class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500 transition duration-200 appearance-none pr-10"
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
              class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500 transition duration-200 appearance-none pr-10"
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
              class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500 transition duration-200 appearance-none pr-10"
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
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200 resize-none"
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
                  (t, _idx) => `
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
                   class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
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

  
  const closeBtn = editModal.querySelector('[data-close-editor]');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      editModal.remove();
      
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
    });
  }

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
                   class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
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

  
  document.getElementById('mobileEditSaveBtn').onclick = async function () {
    
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
      genre: document.getElementById('editGenre1').value, 
      genre_2: document.getElementById('editGenre2').value,
      
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
      comment: document.getElementById('editComments').value.trim(), 
    };

    
    if (!updatedAlbum.artist || !updatedAlbum.album) {
      showToast('Artist and Album are required', 'error');
      return;
    }

    
    lists[currentList][index] = updatedAlbum;

    
    editModal.remove();

    
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;

    
    displayAlbums(lists[currentList]);

    
    try {
      await saveList(currentList, lists[currentList]);
      showToast('Album updated successfully');
    } catch (error) {
      console.error('Error saving album:', error);
      showToast('Error saving changes', 'error');

      
      lists[currentList][index] = album;

      
      displayAlbums(lists[currentList]);
    }
  };

  
  setTimeout(() => {
    document.getElementById('editArtist').focus();
  }, 100);
};



document.addEventListener('DOMContentLoaded', () => {
  
  function convertFlashToToast() {
    
    document.body.classList.add('js-enabled');

    
    const flashMessages = document.querySelectorAll('[data-flash]');

    console.log('Flash messages found:', flashMessages.length);
    flashMessages.forEach((element) => {
      const type = element.dataset.flash; 
      let message;

      
      if (element.dataset.flashContent) {
        message = element.dataset.flashContent;
      } else {
        
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

  
  convertFlashToToast();

  
  const isAuthPage = window.location.pathname.match(
    /\/(login|register|forgot)/
  );
  if (isAuthPage) {
    
    return;
  }

  
  function initializeSidebarCollapse() {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const mainContent = document.querySelector('.main-content');

    if (!sidebar || !sidebarToggle || !mainContent) return;

    
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

    
    if (isCollapsed) {
      sidebar.classList.add('collapsed');
      mainContent.classList.add('sidebar-collapsed');
    }

    
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

  
  initializeSidebarCollapse();

  
  const fab = document.getElementById('addAlbumFAB');
  if (fab) {
    fab.addEventListener('click', () => {
      if (window.openAddAlbumModal) {
        window.openAddAlbumModal();
      } else {
        console.error('openAddAlbumModal not found');
        showToast('Error: Add album function not available', 'error');
      }
    });
  }

  
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

  
  window.addEventListener('storage', (e) => {
    if (e.key === 'lists_cache' && e.newValue) {
      try {
        const updatedLists = JSON.parse(e.newValue);
        if (updatedLists && typeof updatedLists === 'object') {
          lists = updatedLists;
          window.lists = lists;
          updateListNav();

          if (currentList && !lists[currentList]) {
            currentList = null;
            window.currentList = null;
            document.getElementById('albumContainer').innerHTML = `
              <div class="text-center text-gray-500 mt-20">
                <p class="text-xl mb-2">No list selected</p>
                <p class="text-sm">Create or import a list to get started</p>
              </div>
            `;
          }
        }
      } catch (err) {
        console.warn('Failed to sync lists from other tab:', err);
      }
    }
  });

  
  
  loadLists()
    .then(() => {
      initializeContextMenu();
      initializeAlbumContextMenu();
      initializeCreateList();
      initializeRenameList();
      initializeImportConflictHandling();

      

      
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

                
                if (lists[fileName]) {
                  
                  pendingImportData = data;
                  pendingImportFilename = fileName;
                  document.getElementById('conflictListName').textContent =
                    fileName;
                  document
                    .getElementById('importConflictModal')
                    .classList.remove('hidden');
                } else {
                  
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
          e.target.value = ''; 
        };
      }

      
      
    })
    .catch((_err) => {
      showToast('Failed to initialize', 'error');
    });
});

window.addEventListener('beforeunload', () => {
  if (currentList) {
    localStorage.setItem('lastSelectedList', currentList);
  }
  if (listEventSource) {
    listEventSource.close();
  }
});


window.playAlbum = playAlbum;
