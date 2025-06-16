// Global variables
let currentList = null;
let lists = {};
let listEventSource = null;
let availableGenres = [];
let availableCountries = [];
let pendingImportData = null;
let pendingImportFilename = null;
let confirmationCallback = null;

// Context menu variables
let currentContextList = null;
let currentContextAlbum = null;

// Position-based points mapping
const POSITION_POINTS = {
    1: 60, 2: 54, 3: 50, 4: 46, 5: 43, 6: 40, 7: 38, 8: 36, 9: 34, 10: 32,
    11: 30, 12: 29, 13: 28, 14: 27, 15: 26, 16: 25, 17: 24, 18: 23, 19: 22, 20: 21,
    21: 20, 22: 19, 23: 18, 24: 17, 25: 16, 26: 15, 27: 14, 28: 13, 29: 12, 30: 11,
    31: 10, 32: 9, 33: 8, 34: 7, 35: 6, 36: 5, 37: 4, 38: 3, 39: 2, 40: 1
};

window.selectList = selectList;

// Hide context menu when clicking elsewhere
document.addEventListener('click', () => {
  const contextMenu = document.getElementById('contextMenu');
  if (contextMenu) {
    contextMenu.classList.add('hidden');
  }
  
  const albumContextMenu = document.getElementById('albumContextMenu');
  if (albumContextMenu) {
    albumContextMenu.classList.add('hidden');
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

function showConfirmation(title, message, subMessage, confirmText = 'Confirm', onConfirm = null) {
  const modal = document.getElementById('confirmationModal');
  const titleEl = document.getElementById('confirmationTitle');
  const messageEl = document.getElementById('confirmationMessage');
  const subMessageEl = document.getElementById('confirmationSubMessage');
  const confirmBtn = document.getElementById('confirmationConfirmBtn');
  
  titleEl.textContent = title;
  messageEl.textContent = message;
  subMessageEl.textContent = subMessage || '';
  confirmBtn.textContent = confirmText;
  
  confirmationCallback = onConfirm;
  
  modal.classList.remove('hidden');
  
  // Focus the confirm button for keyboard navigation
  setTimeout(() => confirmBtn.focus(), 100);
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

  return new Promise(resolve => {
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

    spotifyBtn.onclick = () => { cleanup(); resolve('spotify'); };
    tidalBtn.onclick = () => { cleanup(); resolve('tidal'); };
    cancelBtn.onclick = () => { cleanup(); resolve(null); };
    modal.onclick = (e) => { if (e.target === modal) { cleanup(); resolve(null); } };

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
  if (parts.length === 3 && /^\d{1,2}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1]) && /^\d{4}$/.test(parts[2])) {
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
    availableCountries = text.split('\n')
      .map(c => c.trim())
      .filter((c, index, arr) => {
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
    console.error('Error loading countries:', error);
    showToast('Error loading countries', 'error');
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
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isMobile && navigator.share) {
      try {
        // Create a File object (required for sharing files)
        const file = new File([blob], fileName, { type: 'application/json' });
        
        // Check if the browser can share files
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: listName,
            text: `Album list export: ${listName}`
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
    console.error('Error downloading/sharing list:', error);
    showToast('Error downloading list', 'error');
  }
}

// Initialize import conflict handling
function initializeImportConflictHandling() {
  const conflictModal = document.getElementById('importConflictModal');
  const renameModal = document.getElementById('importRenameModal');
  const conflictListNameSpan = document.getElementById('conflictListName');
  const originalImportNameSpan = document.getElementById('originalImportName');
  const importNewNameInput = document.getElementById('importNewName');
  
  // Overwrite option
  document.getElementById('importOverwriteBtn').onclick = async () => {
    if (!pendingImportData || !pendingImportFilename) return;
    
    conflictModal.classList.add('hidden');
    
    try {
      await saveList(pendingImportFilename, pendingImportData);
      updateListNav();
      selectList(pendingImportFilename);
      showToast(`Overwritten "${pendingImportFilename}" with ${pendingImportData.length} albums`);
    } catch (err) {
      console.error('Import overwrite error:', err);
      showToast('Error overwriting list', 'error');
    }
    
    pendingImportData = null;
    pendingImportFilename = null;
  };
  
  // Rename option
  document.getElementById('importRenameBtn').onclick = () => {
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
  document.getElementById('importMergeBtn').onclick = async () => {
    if (!pendingImportData || !pendingImportFilename) return;
    
    conflictModal.classList.add('hidden');
    
    try {
      // Get existing list
      const existingList = lists[pendingImportFilename] || [];
      
      // Merge the lists (avoiding duplicates based on artist + album)
      const existingKeys = new Set(
        existingList.map(album => `${album.artist}::${album.album}`.toLowerCase())
      );
      
      const newAlbums = pendingImportData.filter(album => {
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
        showToast(`Added ${addedCount} new albums, skipped ${skippedCount} duplicates`);
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
  document.getElementById('importCancelBtn').onclick = () => {
    conflictModal.classList.add('hidden');
    pendingImportData = null;
    pendingImportFilename = null;
    showToast('Import cancelled');
  };
  
  // Rename modal handlers
  document.getElementById('confirmImportRenameBtn').onclick = async () => {
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
      showToast(`Imported as "${newName}" with ${pendingImportData.length} albums`);
    } catch (err) {
      console.error('Import with rename error:', err);
      showToast('Error importing list', 'error');
    }
    
    pendingImportData = null;
    pendingImportFilename = null;
  };
  
  document.getElementById('cancelImportRenameBtn').onclick = () => {
    renameModal.classList.add('hidden');
    // Go back to conflict modal
    document.getElementById('conflictListName').textContent = pendingImportFilename;
    conflictModal.classList.remove('hidden');
  };
  
  // Enter key in rename input
  importNewNameInput.onkeypress = (e) => {
    if (e.key === 'Enter') {
      document.getElementById('confirmImportRenameBtn').click();
    }
  };
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
  input.className = 'w-full bg-gray-800 text-gray-300 text-sm p-1 rounded border border-gray-700 focus:outline-none focus:border-red-600';
  input.value = currentCountry;
  input.placeholder = 'Type to search countries...';
  input.setAttribute('list', `country-list-${currentList}-${albumIndex}`);
  
  // Create datalist
  const datalist = document.createElement('datalist');
  datalist.id = `country-list-${currentList}-${albumIndex}`;
  
  // Add all available countries
  availableCountries.forEach(country => {
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
    
    countryDiv.innerHTML = `<span class="text-sm text-gray-300 truncate cursor-pointer hover:text-gray-100">${valueToDisplay}</span>`;
    
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
    availableGenres = text.split('\n')
      .map(g => g.trim())
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

// Toast notification
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + type;
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// API helper functions
async function apiCall(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      credentials: 'same-origin'
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      throw new Error(`HTTP error! status: ${response.status}`);
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
  fetchLinkPreview(url).then(data => {
    if (!data) { previewEl.remove(); return; }
    const img = data.image ? `<img src="${data.image}" class="w-12 h-12 object-cover rounded flex-shrink-0" alt="">` : '';
    const desc = data.description ? `<div class="text-gray-400 truncate">${data.description}</div>` : '';
    previewEl.innerHTML = `<a href="${url}" target="_blank" class="flex gap-2 p-2 items-center">${img}<div class="min-w-0"><div class="font-semibold text-gray-100 truncate">${data.title || url}</div>${desc}</div></a>`;
  }).catch(() => previewEl.remove());
}

// Load lists from server
async function loadLists() {
  try {
    lists = await apiCall('/api/lists');
    updateListNav();
  } catch (error) {
    showToast('Error loading lists', 'error');
  }
}

// Save list to server
async function saveList(name, data) {
  try {
    // Clean up any stored points/ranks before saving
    const cleanedData = data.map(album => {
      const cleaned = { ...album };
      delete cleaned.points;
      delete cleaned.rank;
      return cleaned;
    });

    
    await apiCall(`/api/lists/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify({ data: cleanedData })
    });
    lists[name] = cleanedData;
  } catch (error) {
    showToast('Error saving list', 'error');
    throw error;
  }
}

function subscribeToList(name) {
  if (listEventSource) {
    listEventSource.close();
    listEventSource = null;
  }
  if (!name) return;

  listEventSource = new EventSource(`/api/lists/subscribe/${encodeURIComponent(name)}`, { withCredentials: true });
  listEventSource.addEventListener('update', (e) => {
    try {
      const data = JSON.parse(e.data);
      lists[name] = data;
      if (currentList === name) {
        displayAlbums(data);
      }
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
  const deleteOption = document.getElementById('deleteListOption');
  
  if (!contextMenu || !deleteOption || !renameOption || !downloadOption) return;
  
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
  
  // Handle delete option click
  deleteOption.onclick = async () => {
    contextMenu.classList.add('hidden');
    
    if (!currentContextList) return;
    
    // Confirm deletion
    if (confirm(`Are you sure you want to delete the list "${currentContextList}"? This cannot be undone.`)) {
      try {
        await apiCall(`/api/lists/${encodeURIComponent(currentContextList)}`, {
          method: 'DELETE'
        });
        
        // Remove from local data
        delete lists[currentContextList];
        
        // If we're currently viewing this list, clear the view
        if (currentList === currentContextList) {
          currentList = null;
          
          // Hide the list name in header
          const headerSeparator = document.getElementById('headerSeparator');
          const headerListName = document.getElementById('headerListName');
          const headerAddAlbumBtn = document.getElementById('headerAddAlbumBtn');
          
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
        console.error('Error deleting list:', error);
        showToast('Error deleting list', 'error');
      }
    }
    
    currentContextList = null;
  };
}

function updateMobileHeader() {
  const headerContainer = document.getElementById('dynamicHeader');
  if (headerContainer && window.currentUser) {
    headerContainer.innerHTML = window.headerComponent(window.currentUser, 'home', currentList || '');
  }
}

// Initialize album context menu
function initializeAlbumContextMenu() {
  const contextMenu = document.getElementById('albumContextMenu');
  const removeOption = document.getElementById('removeAlbumOption');
  const editOption = document.getElementById('editAlbumOption');
  const playOption = document.getElementById('playAlbumOption');

  if (!contextMenu || !removeOption || !editOption || !playOption) return;

  // Handle edit option click
  editOption.onclick = () => {
    contextMenu.classList.add('hidden');

    if (currentContextAlbum === null) return;

    showMobileEditForm(currentContextAlbum);
  };

  // Handle play option click
  playOption.onclick = () => {
    contextMenu.classList.add('hidden');
    if (currentContextAlbum === null) return;
    playAlbum(currentContextAlbum);
  };
  
  // Handle remove option click
  removeOption.onclick = async () => {
    contextMenu.classList.add('hidden');
    
    if (currentContextAlbum === null) return;
    
    // Get album details for the confirmation message
    const album = lists[currentList][currentContextAlbum];
    
    showConfirmation(
      'Remove Album',
      `Remove "${album.album}" by ${album.artist}?`,
      'This will remove the album from this list.',
      'Remove',
      async () => {
        try {
          // Remove from the list
          lists[currentList].splice(currentContextAlbum, 1);
          
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

  const chooseService = () => {
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

  chooseService().then(service => {
    hideConfirmation();
    if (!service) return;

    const query = `artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`;
    const endpoint = service === 'spotify' ? '/api/spotify/album' : '/api/tidal/album';

    fetch(`${endpoint}?${query}`, { credentials: 'include' })
      .then(async r => {
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
      .then(data => {
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
      .catch(err => {
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
      console.error('Error creating list:', error);
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
        method: 'DELETE'
      });
      
      // Update local data
      delete lists[oldName];
      
      // If we're currently viewing this list, update the view
      if (currentList === oldName) {
        currentList = newName;
        selectList(newName);
      }
      
      // Update navigation
      updateListNav();
      
      // Close modal
      closeModal();
      
      showToast(`List renamed from "${oldName}" to "${newName}"`);
    } catch (error) {
      console.error('Error renaming list:', error);
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
    
    Object.keys(lists).forEach(listName => {
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
        button.addEventListener(
          'touchend',
          () => clearTimeout(pressTimer),
          { passive: true }
        );
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
}

// Initialize SortableJS for mobile album sorting
function initializeMobileSorting(container) {
  if (!window.Sortable) {
    console.error('SortableJS not loaded');
    return;
  }
  
  // Clean up any existing sortable instance
  if (container._sortable) {
    container._sortable.destroy();
  }
  
  // Find the container with the album cards
  const sortableContainer = container.querySelector('.mobile-album-list') || container;
  
  // Find the actual scrollable container
  let scrollableParent = sortableContainer.closest('.overflow-y-auto');
  
  if (!scrollableParent) {
    const mobileContainer = document.querySelector('#mobileAlbumContainer');
    if (mobileContainer) {
      scrollableParent = mobileContainer.parentElement;
    }
  }
  
  // Get the bottom nav height
  const getBottomNavHeight = () => {
    const bottomNav = document.querySelector('nav.fixed.bottom-0');
    if (bottomNav && !bottomNav.classList.contains('hidden')) {
      return bottomNav.offsetHeight;
    }
    return 0;
  };
  
  // Force render function to ensure content is visible during scroll
  const forceRenderOnScroll = () => {
    if (scrollableParent) {
      const scrollTop = scrollableParent.scrollTop;
      const scrollHeight = scrollableParent.scrollHeight;
      
      // Force the browser to recalculate and render
      void scrollableParent.offsetHeight;
      
      // If we're near the bottom, ensure bottom content is rendered
      if (scrollTop + scrollableParent.clientHeight >= scrollHeight - 200) {
        sortableContainer.style.minHeight = sortableContainer.scrollHeight + 'px';
        requestAnimationFrame(() => {
          sortableContainer.style.minHeight = '';
        });
      }
    }
  };
  
  // Enhanced auto-scroll implementation
  let autoScrollInterval = null;
  let currentScrollSpeed = 0;
  let lastTouchY = null;
  let scrollAcceleration = 1;
  
  const startAutoScroll = (direction, speed) => {
    if (autoScrollInterval) {
      clearInterval(autoScrollInterval);
    }
    
    currentScrollSpeed = speed;
    scrollAcceleration = 1;
    
    autoScrollInterval = setInterval(() => {
      if (scrollableParent) {
        // Gradually increase speed for smoother acceleration
        if (scrollAcceleration < 2.5) {
          scrollAcceleration += 0.05;
        }
        
        const adjustedSpeed = currentScrollSpeed * scrollAcceleration;
        const currentScroll = scrollableParent.scrollTop;
        const newScroll = currentScroll + (direction * adjustedSpeed);
        
        if (direction > 0) {
          const maxScroll = scrollableParent.scrollHeight - scrollableParent.clientHeight;
          scrollableParent.scrollTop = Math.min(newScroll, maxScroll);
          
          // Stop if we've reached the bottom
          if (scrollableParent.scrollTop >= maxScroll) {
            stopAutoScroll();
          }
        } else {
          scrollableParent.scrollTop = Math.max(newScroll, 0);
          
          // Stop if we've reached the top
          if (scrollableParent.scrollTop <= 0) {
            stopAutoScroll();
          }
        }
        
        forceRenderOnScroll();
      }
    }, 16); // 60fps
  };
  
  const stopAutoScroll = () => {
    if (autoScrollInterval) {
      clearInterval(autoScrollInterval);
      autoScrollInterval = null;
      currentScrollSpeed = 0;
      scrollAcceleration = 1;
    }
  };
  
  // Create sortable with enhanced settings
  const sortable = Sortable.create(sortableContainer, {
    animation: 150,
    handle: '.drag-handle',
    preventOnFilter: true,
    forceFallback: true,
    fallbackClass: 'sortable-drag',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    delay: 0,
    delayOnTouchOnly: false,
    touchStartThreshold: 0,
    
    // Disable built-in auto-scroll
    scroll: false,
    
    onStart: function(evt) {
      evt.item.dataset.originalIndex = evt.oldIndex;
      document.body.style.overflow = 'hidden';
      document.body.classList.add('sorting-active'); // Add this
      lastTouchY = null;
      
      if (scrollableParent) {
        scrollableParent.classList.add('sortable-scrolling');
        scrollableParent.classList.add('sortable-drag-active'); // Add this
        
        // Pre-render all content
        const cards = sortableContainer.querySelectorAll('.album-card');
        cards.forEach(card => {
          void card.offsetHeight;
        });
      }
    },
    
    onMove: function(evt) {
      if (!scrollableParent) return;
      
      // Get current touch/mouse position
      const touch = evt.originalEvent.touches ? evt.originalEvent.touches[0] : evt.originalEvent;
      const clientY = touch.clientY;
      
      // Store for velocity calculation
      lastTouchY = clientY;
      
      // Get viewport dimensions
      const viewportHeight = window.innerHeight;
      const containerRect = scrollableParent.getBoundingClientRect();
      
      // Larger scroll zones for easier triggering (25% of viewport height each)
      const scrollZoneSize = Math.max(100, viewportHeight * 0.25);
      
      // Calculate effective boundaries
      const topBoundary = Math.max(containerRect.top, 0);
      const bottomBoundary = Math.min(containerRect.bottom, viewportHeight);
      
      // Define scroll trigger zones
      const topScrollTrigger = topBoundary + scrollZoneSize;
      const bottomScrollTrigger = bottomBoundary - scrollZoneSize;
      
      // Calculate scroll speed based on position within the zone
      let shouldScroll = false;
      let scrollDirection = 0;
      let scrollSpeed = 0;
      
      if (clientY < topScrollTrigger && clientY >= topBoundary) {
        // In top scroll zone
        shouldScroll = true;
        scrollDirection = -1;
        
        // Calculate speed based on how deep into the zone we are
        const zoneDepth = (topScrollTrigger - clientY) / scrollZoneSize;
        scrollSpeed = Math.max(3, Math.min(25, zoneDepth * 25));
        
        // Extra boost if very close to edge
        if (clientY < topBoundary + 30) {
          scrollSpeed = Math.min(35, scrollSpeed * 1.5);
        }
      } else if (clientY > bottomScrollTrigger && clientY <= bottomBoundary) {
        // In bottom scroll zone
        shouldScroll = true;
        scrollDirection = 1;
        
        // Calculate speed based on how deep into the zone we are
        const zoneDepth = (clientY - bottomScrollTrigger) / scrollZoneSize;
        scrollSpeed = Math.max(3, Math.min(25, zoneDepth * 25));
        
        // Extra boost if very close to edge
        if (clientY > bottomBoundary - 30) {
          scrollSpeed = Math.min(35, scrollSpeed * 1.5);
        }
      }
      
      if (shouldScroll) {
        startAutoScroll(scrollDirection, scrollSpeed);
      } else {
        stopAutoScroll();
      }
      
      // Force render to ensure content is visible
      forceRenderOnScroll();
      
      // REMOVED: return false; - This was preventing the drag operation!
    },
    
    onEnd: function(evt) {
      stopAutoScroll();
      document.body.style.overflow = '';
      document.body.classList.remove('sorting-active'); // Add this
      lastTouchY = null;
      
      if (scrollableParent) {
        scrollableParent.classList.remove('sortable-scrolling');
        scrollableParent.classList.remove('sortable-drag-active'); // Add this
      }
    },
    
    onUpdate: async function(evt) {
      const oldIndex = parseInt(evt.item.dataset.originalIndex);
      const newIndex = evt.newIndex;
      
      if (oldIndex === newIndex) return;
      
      try {
        const list = lists[currentList];
        const [movedItem] = list.splice(oldIndex, 1);
        list.splice(newIndex, 0, movedItem);
        
        await saveList(currentList, list);
        
        // Update position numbers
        const cards = sortableContainer.querySelectorAll('.album-card');
        cards.forEach((card, index) => {
          card.dataset.index = index;
          const positionElement = card.querySelector('.w-12.flex.items-center.justify-center');
          if (positionElement) {
            positionElement.textContent = index + 1;
          }
        });
      } catch (error) {
        console.error('Error saving reorder:', error);
        showToast('Error saving changes', 'error');
        selectList(currentList);
      }
    }
  });
  
  // Store sortable instance
  container._sortable = sortable;
}

// Select and display a list
async function selectList(listName) {
  try {
    currentList = listName;
    subscribeToList(listName);

    // Always fetch the latest data when a list is selected
    if (listName) {
      try {
        const freshData = await apiCall(`/api/lists/${encodeURIComponent(listName)}`);
        lists[listName] = freshData;
      } catch (err) {
        console.warn('Failed to fetch latest list data:', err);
      }
    }

    // Save to localStorage immediately (synchronous)
    if (listName) {
      localStorage.setItem('lastSelectedList', listName);
    }
    
    // Save the last selected list to the server (keep existing code)
    try {
      await apiCall('/api/user/last-list', {
        method: 'POST',
        body: JSON.stringify({ listName })
      });
    } catch (error) {
      // Don't block list selection if saving preference fails
      console.warn('Failed to save list preference:', error);
    }
    
    // Update the header with current list name
    updateMobileHeader();
    
    // Update the active state in the list navigation
    updateListNav();
    
    // Update the header title
    updateHeaderTitle(listName);
    
    // Display the albums
    displayAlbums(lists[listName]);
    
    // Show/hide FAB based on whether a list is selected (mobile only)
    const fab = document.getElementById('addAlbumFAB');
    if (fab) {
      fab.style.display = listName ? 'flex' : 'none';
    }
    
  } catch (error) {
    console.error('Error selecting list:', error);
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
  input.className = 'w-full bg-gray-800 text-gray-300 text-sm p-1 rounded border border-gray-700 focus:outline-none focus:border-red-600';
  input.value = currentGenre;
  input.placeholder = `Type to search ${genreField === 'genre_1' ? 'primary' : 'secondary'} genre...`;
  input.setAttribute('list', `genre-list-${currentList}-${albumIndex}-${genreField}`);
  
  // Create datalist
  const datalist = document.createElement('datalist');
  datalist.id = `genre-list-${currentList}-${albumIndex}-${genreField}`;
  
  // Add all available genres
  availableGenres.forEach(genre => {
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
    
    const colorClass = genreField === 'genre_1' ? 'text-gray-300' : 'text-gray-400';
    let displayGenre = valueToDisplay;
    
    // Handle empty or placeholder values for genre_2
    if (genreField === 'genre_2' && (displayGenre === 'Genre 2' || displayGenre === '-' || displayGenre === '')) {
      displayGenre = '';
    }
    
    genreDiv.innerHTML = `<span class="text-sm ${colorClass} truncate cursor-pointer hover:text-gray-100">${displayGenre}</span>`;
    
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
  const currentComment = lists[currentList][albumIndex].comments || lists[currentList][albumIndex].comment || '';
  
  // Create textarea
  const textarea = document.createElement('textarea');
  textarea.className = 'w-full bg-gray-800 text-gray-300 text-sm p-2 rounded border border-gray-700 focus:outline-none focus:border-red-600 resize-none';
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


// Display albums function with editable genres and comments
// Display albums function with editable genres and comments
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

  if (!isMobile) {
    // Desktop view - table layout
    const table = document.createElement('div');
    table.className = 'w-full relative';
    
    // Header - using album-grid class
    const header = document.createElement('div');
    header.className = 'album-grid gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-800 sticky top-0 bg-black z-10';
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
    `;
    table.appendChild(header);
    
    const rowsContainer = document.createElement('div');
    rowsContainer.className = 'album-rows-container relative';
    
    albums.forEach((album, index) => {
      const row = document.createElement('div');
      row.className = 'album-row album-grid gap-4 px-4 py-2 border-b border-gray-800 cursor-move hover:bg-gray-800/30 transition-colors';
      row.dataset.index = index;
      
      const position = index + 1;
      const albumName = album.album || 'Unknown Album';
      const artist = album.artist || 'Unknown Artist';

      const country = album.country || '';
      const countryDisplay = country || 'Country';
      const countryClass = country ? 'text-gray-300' : 'text-gray-500 italic';

      const genre1 = album.genre_1 || album.genre || '';
      const genre1Display = genre1 || 'Genre 1';
      const genre1Class = genre1 ? 'text-gray-300' : 'text-gray-500 italic';

      let genre2 = album.genre_2 || '';
      if (genre2 === 'Genre 2' || genre2 === '-') {
        genre2 = '';
      }
      const genre2Display = genre2 || 'Genre 2';
      const genre2Class = genre2 ? 'text-gray-400' : 'text-gray-500 italic';
      
      let comment = album.comments || album.comment || '';
      if (comment === 'Comment') {
        comment = '';
      }
      
      const releaseDate = formatReleaseDate(album.release_date || '');
      const coverImage = album.cover_image || '';
      const imageFormat = album.cover_image_format || 'PNG';
      
      row.innerHTML = `
        <div class="flex items-center justify-center text-gray-400 font-medium">${position}</div>
        <div class="flex items-center">
          <div class="album-cover-container">
            ${coverImage ? `
              <img src="data:image/${imageFormat};base64,${coverImage}" 
                  alt="${albumName}" 
                  class="album-cover rounded shadow-lg"
                  loading="lazy"
                  onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'album-cover-placeholder rounded bg-gray-800 shadow-lg\\'><svg width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\' class=\\'text-gray-600\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\' ry=\\'2\\'></rect><circle cx=\\'8.5\\' cy=\\'8.5\\' r=\\'1.5\\'></circle><polyline points=\\'21 15 16 10 5 21\\'></polyline></svg></div>'"
              >
            ` : `
              <div class="album-cover-placeholder rounded bg-gray-800 shadow-lg">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-600">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
              </div>
            `}
          </div>
        </div>
        <div class="flex flex-col justify-center min-w-0">
          <div class="font-medium text-white truncate">${albumName}</div>
          <div class="text-xs text-gray-400">${releaseDate}</div>
        </div>
        <div class="flex items-center text-gray-300 truncate">${artist}</div>
        <div class="flex items-center country-cell">
          <span class="text-sm ${countryClass} truncate cursor-pointer hover:text-gray-100">${countryDisplay}</span>
        </div>
        <div class="flex items-center genre-cell genre-1-cell">
          <span class="text-sm ${genre1Class} truncate cursor-pointer hover:text-gray-100">${genre1Display}</span>
        </div>
        <div class="flex items-center genre-cell genre-2-cell">
          <span class="text-sm ${genre2Class} truncate cursor-pointer hover:text-gray-100">${genre2Display}</span>
        </div>
        <div class="flex items-center comment-cell">
          <span class="text-sm text-gray-300 italic line-clamp-2 cursor-pointer hover:text-gray-100">${comment}</span>
        </div>
      `;
      
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

      attachLinkPreview(commentCell, comment);
      
      // Make row draggable using DragDropManager
      if (window.DragDropManager) {
        window.DragDropManager.makeRowDraggable(row);
      }
      
      // Right-click handler for album rows
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        currentContextAlbum = index;
        
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
      
      rowsContainer.appendChild(row);
    });
    
    table.appendChild(rowsContainer);
    container.appendChild(table);
    
    // Initialize drag and drop
    if (window.DragDropManager) {
      window.DragDropManager.initialize();

      window.DragDropManager.setupDropHandler(async (draggedIndex, dropIndex, needsRebuild) => {
        if (needsRebuild) {
          displayAlbums(lists[currentList]);
          return;
        }

        if (draggedIndex !== null && dropIndex !== null) {
          const list = lists[currentList];
          const [movedItem] = list.splice(draggedIndex, 1);
          list.splice(dropIndex, 0, movedItem);

          await saveList(currentList, list);
        }
      });
    }
  } else {
    // Mobile view - card-based layout with SortableJS
    const mobileContainer = document.createElement('div');
    mobileContainer.className = 'mobile-album-list pb-20'; // Space for bottom nav
    
    albums.forEach((album, index) => {
      const cardWrapper = document.createElement('div');
      cardWrapper.className = 'album-card-wrapper';
      
      const card = document.createElement('div');
      card.className = 'album-card bg-gray-900 border-b border-gray-800 touch-manipulation transition-all cursor-move relative overflow-hidden';
      card.dataset.index = index;
      
      const albumName = album.album || 'Unknown Album';
      const artist = album.artist || 'Unknown Artist';
      const releaseDate = formatReleaseDate(album.release_date || '');
      const country = album.country || '';
      const genre1 = album.genre_1 || album.genre || '';
      let genre2 = album.genre_2 || '';
      if (genre2 === 'Genre 2' || genre2 === '-') genre2 = '';
      let comment = album.comments || album.comment || '';
      if (comment === 'Comment') comment = '';
      
      card.innerHTML = `
        <div class="flex items-center h-full">
          <!-- Position number on the far left -->
          <div class="flex-shrink-0 w-12 flex items-center justify-center text-gray-500 font-medium text-sm">
            ${index + 1}
          </div>
          
          <!-- Album cover -->
          <div class="flex-shrink-0 p-3 pl-0">
            ${album.cover_image ? `
              <img src="data:image/${album.cover_image_format || 'PNG'};base64,${album.cover_image}" 
                  alt="${albumName}" 
                  class="w-16 h-16 rounded-lg object-cover shadow-md"
                  loading="lazy">
            ` : `
              <div class="w-16 h-16 bg-gray-800 rounded-lg shadow-md flex items-center justify-center">
                <i class="fas fa-compact-disc text-xl text-gray-600"></i>
              </div>
            `}
          </div>
          
          <!-- Main content -->
          <div class="flex-1 min-w-0 py-3 pr-3">
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <h3 class="font-semibold text-white text-base leading-tight truncate">${albumName}</h3>
                <p class="text-sm text-gray-400 truncate mt-0.5">${artist}</p>
                
                <!-- Date and Country row -->
                <div class="flex items-center gap-2 mt-1 text-xs text-gray-500">
                  <span class="whitespace-nowrap">${releaseDate}</span>
                  ${country ? `<span>• ${country}</span>` : ''}
                </div>
                
                <!-- Genres row (if any) -->
                ${genre1 || genre2 ? `
                  <div class="text-xs text-gray-500 truncate">
                    ${genre1}${genre2 ? ` / ${genre2}` : ''}
                  </div>
                ` : ''}
                
                ${comment ? `
                  <p class="text-xs text-gray-400 italic mt-1 line-clamp-1">${comment}</p>
                ` : ''}
              </div>
              
              <!-- Actions on the right -->
              <button onclick="event.stopPropagation(); showMobileAlbumMenu(this)"
                      class="flex-shrink-0 p-2 -m-2 text-gray-400 active:text-gray-200">
                <i class="fas fa-ellipsis-v"></i>
              </button>
            </div>
          </div>
          
          <!-- Subtle drag handle on far right edge -->
          <div class="drag-handle flex-shrink-0 w-8 h-full flex items-center justify-center cursor-move select-none text-gray-600 border-l border-gray-800/50" 
              style="touch-action: none; -webkit-user-select: none; -webkit-touch-callout: none;">
            <svg width="16" height="24" viewBox="0 0 16 24" fill="none" class="pointer-events-none opacity-50">
              <circle cx="5" cy="6" r="1.5" fill="currentColor"/>
              <circle cx="5" cy="12" r="1.5" fill="currentColor"/>
              <circle cx="5" cy="18" r="1.5" fill="currentColor"/>
              <circle cx="11" cy="6" r="1.5" fill="currentColor"/>
              <circle cx="11" cy="12" r="1.5" fill="currentColor"/>
              <circle cx="11" cy="18" r="1.5" fill="currentColor"/>
            </svg>
          </div>
        </div>
      `;

      cardWrapper.appendChild(card);
      const contentDiv = card.querySelector('.flex-1.min-w-0');
      if (contentDiv) attachLinkPreview(contentDiv, comment);
      mobileContainer.appendChild(cardWrapper);
    });
    
    container.appendChild(mobileContainer);
    
    // Initialize SortableJS for mobile
    initializeMobileSorting(mobileContainer);
  }
  
}


// Add this function to handle mobile album actions
window.showMobileAlbumMenu = function(indexOrElement) {
  let index = indexOrElement;
  if (typeof indexOrElement !== 'number') {
    const card = indexOrElement.closest('.album-card');
    if (!card) return;
    index = parseInt(card.dataset.index);
  }
  const album = lists[currentList][index];
  
  const actionSheet = document.createElement('div');
  actionSheet.className = 'fixed inset-0 z-50 lg:hidden';
  actionSheet.innerHTML = `
    <div class="absolute inset-0 bg-black bg-opacity-50" onclick="this.parentElement.remove()"></div>
    <div class="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl safe-area-bottom">
      <div class="p-4">
        <div class="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4"></div>
        <h3 class="font-semibold text-white mb-1 truncate">${album.album}</h3>
        <p class="text-sm text-gray-400 mb-4 truncate">${album.artist}</p>
        
        <button onclick="showMobileEditForm(${index}); this.closest('.fixed').remove();"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
          <i class="fas fa-edit mr-3 text-gray-400"></i>Edit Details
        </button>

        <button onclick="this.closest('.fixed').remove(); playAlbum(${index});"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
          <i class="fas fa-play mr-3 text-gray-400"></i>Play Album
        </button>

        <button onclick="this.closest('.fixed').remove(); setTimeout(() => { currentContextAlbum = ${index}; document.getElementById('removeAlbumOption').click(); }, 100);"
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

// Mobile edit form (basic implementation)
window.showMobileEditForm = function(index) {
  const album = lists[currentList][index];
  const originalReleaseDate = album.release_date || '';
  const inputReleaseDate = originalReleaseDate
    ? normalizeDateForInput(originalReleaseDate) || new Date().toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];
  
  // Create the edit modal
  const editModal = document.createElement('div');
  editModal.className = 'fixed inset-0 z-50 bg-gray-900 flex flex-col overflow-hidden lg:max-w-2xl lg:mx-auto lg:my-8 lg:rounded-lg lg:shadow-2xl';
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
        ${album.cover_image ? `
          <div class="flex justify-center mb-4">
            <img src="data:image/${album.cover_image_format || 'PNG'};base64,${album.cover_image}" 
                 alt="${album.album}" 
                 class="w-32 h-32 rounded-lg object-cover shadow-md">
          </div>
        ` : ''}
        
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
              ${availableCountries.map(country => 
                `<option value="${country}" ${country === album.country ? 'selected' : ''}>${country}</option>`
              ).join('')}
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
              ${availableGenres.map(genre => 
                `<option value="${genre}" ${genre === (album.genre_1 || album.genre) ? 'selected' : ''}>${genre}</option>`
              ).join('')}
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
              ${availableGenres.map(genre => {
                const currentGenre2 = album.genre_2 && album.genre_2 !== 'Genre 2' && album.genre_2 !== '-' ? album.genre_2 : '';
                return `<option value="${genre}" ${genre === currentGenre2 ? 'selected' : ''}>${genre}</option>`;
              }).join('')}
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
        
        <!-- Spacer for bottom padding -->
        <div class="h-4"></div>
      </form>
    </div>
  `;
  
  document.body.appendChild(editModal);

  // Initialize date picker
  if (window.flatpickr) {
    window.flatpickr('#editReleaseDate', {
      dateFormat: 'Y-m-d',
      defaultDate: inputReleaseDate
    });
  }

  // Handle save (rest of the code remains the same)
  document.getElementById('mobileEditSaveBtn').onclick = async function() {
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
      comments: document.getElementById('editComments').value.trim(),
      comment: document.getElementById('editComments').value.trim() // Keep both for compatibility
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
      
      // Update the display
      selectList(currentList);
      
      // Close the modal
      editModal.remove();
      
      showToast('Album updated successfully');
    } catch (error) {
      console.error('Error saving album:', error);
      showToast('Error saving changes', 'error');
      
      // Revert changes on error
      lists[currentList][index] = album;
    }
  };
  
  // Focus on first input
  setTimeout(() => {
    document.getElementById('editArtist').focus();
  }, 100);
};

// File import
document.getElementById('importBtn').onclick = () => {
  document.getElementById('fileInput').click();
};

document.getElementById('fileInput').onchange = async (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target.result;
        const data = JSON.parse(content);
        
        if (!Array.isArray(data)) {
          throw new Error('JSON must be an array of albums');
        }
        
        if (data.length > 0) {
          const requiredFields = ['artist', 'album'];
          const missingFields = requiredFields.filter(field => !data[0].hasOwnProperty(field));
          if (missingFields.length > 0) {
            throw new Error('Missing required fields: ' + missingFields.join(', '));
          }
        }
        
        const listName = file.name.replace('.json', '');
        
        // Check if list already exists
        if (lists[listName]) {
          // Store the data and show conflict modal
          pendingImportData = data;
          pendingImportFilename = listName;
          
          document.getElementById('conflictListName').textContent = listName;
          document.getElementById('importConflictModal').classList.remove('hidden');
        } else {
          // No conflict, import directly
          await saveList(listName, data);
          updateListNav();
          selectList(listName);
          showToast(`Successfully imported ${data.length} albums`);
        }
      } catch (err) {
        console.error('Import error:', err);
        showToast('Error importing file: ' + err.message, 'error');
      }
    };
    
    reader.onerror = (err) => {
      console.error('File read error:', err);
      showToast('Error reading file', 'error');
    };
    
    reader.readAsText(file, 'UTF-8');
  }
  e.target.value = '';
};


document.addEventListener('DOMContentLoaded', () => {
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
          if (e.key === 'Escape' && !confirmModal.classList.contains('hidden')) {
            hideConfirmation();
          }
        });
      }
    })
    .catch(err => {
      console.error('Failed to initialize:', err);
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

// Make utility functions globally available
window.showToast = showToast;
window.formatDateForStorage = formatDateForStorage;

