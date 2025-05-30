// Global variables
let currentList = null;
let lists = {};
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

// Standardize date formats for release dates
function formatReleaseDate(dateStr) {
  if (!dateStr) return '';
  
  // Handle various date formats
  let date;
  
  // Try to parse the date string
  try {
    // Check if it's just a year (e.g., "2023")
    if (/^\d{4}$/.test(dateStr)) {
      return dateStr; // Just return the year as-is
    }
    
    // Check if it's year-month (e.g., "2023-12")
    if (/^\d{4}-\d{2}$/.test(dateStr)) {
      const [year, month] = dateStr.split('-');
      return `${month}-${year}`;
    }
    
    // Check various full date formats
    // ISO format: "2023-12-25"
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [year, month, day] = dateStr.split('-');
      return `${day}-${month}-${year}`;
    }
    
    // US format: "12/25/2023" or "12-25-2023"
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(dateStr)) {
      const parts = dateStr.split(/[/-]/);
      const month = parts[0].padStart(2, '0');
      const day = parts[1].padStart(2, '0');
      const year = parts[2];
      return `${day}-${month}-${year}`;
    }
    
    // European format: "25/12/2023" or "25-12-2023"
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(dateStr)) {
      const parts = dateStr.split(/[/-]/);
      // Try to detect if it's DD/MM or MM/DD by checking if first part > 12
      const firstPart = parseInt(parts[0]);
      const secondPart = parseInt(parts[1]);
      
      if (firstPart > 12) {
        // Likely DD/MM/YYYY
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2];
        return `${day}-${month}-${year}`;
      } else if (secondPart > 12) {
        // Likely MM/DD/YYYY
        const month = parts[0].padStart(2, '0');
        const day = parts[1].padStart(2, '0');
        const year = parts[2];
        return `${day}-${month}-${year}`;
      } else {
        // Ambiguous, assume DD/MM/YYYY for European format
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2];
        return `${day}-${month}-${year}`;
      }
    }
    
    // Try to parse as a general date
    date = new Date(dateStr);
    
    // Check if the date is valid
    if (!isNaN(date.getTime())) {
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    }
    
    // If all parsing fails, return the original string
    return dateStr;
    
  } catch (e) {
    // If any error occurs, return the original string
    return dateStr;
  }
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

// Delete all lists from server
async function clearAllLists() {
  try {
    await apiCall('/api/lists', {
      method: 'DELETE'
    });
    lists = {};
  } catch (error) {
    showToast('Error clearing lists', 'error');
    throw error;
  }
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
    
    try {
      // Get the list data
      const listData = lists[currentContextList];
      
      // Create a copy with rank added based on position
      const exportData = listData.map((album, index) => {
        const exported = { ...album };
        // Add rank based on position (1-indexed)
        exported.rank = index + 1;
        // Add points for this position
        exported.points = getPointsForPosition(index + 1);
        return exported;
      });
      
      // Convert to JSON with pretty formatting
      const jsonStr = JSON.stringify(exportData, null, 2);
      
      // Create blob and download link
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      // Create temporary download link
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentContextList}.json`;
      
      // Trigger download
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showToast(`Downloaded "${currentContextList}"`);
    } catch (error) {
      console.error('Error downloading list:', error);
      showToast('Error downloading list', 'error');
    }
    
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
  
  if (!contextMenu || !removeOption) return;
  
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
        <button class="w-full text-left px-3 py-${isMobile ? '3' : '2'} rounded text-sm hover:bg-gray-800 transition duration-200 ${currentList === listName ? 'bg-gray-800 text-red-500' : 'text-gray-300'}">
          ${listName}
        </button>
      `;
      
      const button = li.querySelector('button');
      
      if (!isMobile) {
        // Desktop: keep right-click
        button.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          // ... existing context menu code ...
        });
      } else {
        // Mobile: long press
        let pressTimer;
        button.addEventListener('touchstart', (e) => {
          pressTimer = setTimeout(() => {
            showMobileListMenu(listName);
          }, 500);
        });
        button.addEventListener('touchend', () => clearTimeout(pressTimer));
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
  
  // Custom auto-scroll implementation
  let autoScrollInterval = null;
  let scrollSpeed = 0;
  
  const startAutoScroll = (direction, speed) => {
    if (autoScrollInterval) return;
    
    autoScrollInterval = setInterval(() => {
      if (scrollableParent) {
        const currentScroll = scrollableParent.scrollTop;
        const newScroll = currentScroll + (direction * speed);
        
        if (direction > 0) {
          const maxScroll = scrollableParent.scrollHeight - scrollableParent.clientHeight;
          scrollableParent.scrollTop = Math.min(newScroll, maxScroll);
        } else {
          scrollableParent.scrollTop = Math.max(newScroll, 0);
        }
        
        forceRenderOnScroll();
      }
    }, 16);
  };
  
  const stopAutoScroll = () => {
    if (autoScrollInterval) {
      clearInterval(autoScrollInterval);
      autoScrollInterval = null;
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
      
      if (scrollableParent) {
        scrollableParent.classList.add('sortable-scrolling');
        
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
      
      // Get the ACTUAL visible area (accounting for bottom nav)
      const containerRect = scrollableParent.getBoundingClientRect();
      const bottomNavHeight = getBottomNavHeight();
      
      // Adjust the effective bottom of the container
      const effectiveBottom = containerRect.bottom - bottomNavHeight;
      
      // Define scroll zones
      const scrollZoneSize = 60; // Slightly smaller for mobile
      const topScrollZone = containerRect.top + scrollZoneSize;
      const bottomScrollZone = effectiveBottom - scrollZoneSize;
      
      // Check if we're in a scroll zone based on touch position
      if (clientY < topScrollZone && clientY > containerRect.top) {
        // In top scroll zone - scroll up
        const intensity = (topScrollZone - clientY) / scrollZoneSize;
        scrollSpeed = Math.max(5, Math.min(20, intensity * 20));
        startAutoScroll(-1, scrollSpeed);
      } else if (clientY > bottomScrollZone && clientY < effectiveBottom) {
        // In bottom scroll zone - scroll down
        const intensity = (clientY - bottomScrollZone) / scrollZoneSize;
        scrollSpeed = Math.max(5, Math.min(20, intensity * 20));
        startAutoScroll(1, scrollSpeed);
      } else {
        // Not in scroll zone or beyond bounds
        stopAutoScroll();
      }
      
      // Force render to ensure content is visible
      forceRenderOnScroll();
    },
    
    onEnd: function(evt) {
      stopAutoScroll();
      document.body.style.overflow = '';
      
      if (scrollableParent) {
        scrollableParent.classList.remove('sortable-scrolling');
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
        
        showToast('List reordered');
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
    console.log('Selecting list:', listName);
    currentList = listName;
    
    // Save the last selected list to the server
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
    
  } catch (error) {
    console.error('Error selecting list:', error);
    showToast('Error loading list', 'error');
  }
}


function showMobileAlbumMenu(index) {
  const album = lists[currentList][index];
  
  const actionSheet = document.createElement('div');
  actionSheet.className = 'fixed inset-0 z-50 lg:hidden';
  actionSheet.innerHTML = `
    <div class="absolute inset-0 bg-black bg-opacity-50" onclick="this.parentElement.remove()"></div>
    <div class="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl">
      <div class="p-4">
        <div class="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4"></div>
        <h3 class="font-semibold text-white mb-1">${album.album}</h3>
        <p class="text-sm text-gray-400 mb-4">${album.artist}</p>
        
        <button onclick="editMobileAlbum(${index}); this.closest('.fixed').remove();" 
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
          <i class="fas fa-edit mr-3 text-gray-400"></i>Edit Details
        </button>
        
        <button onclick="if(confirm('Remove this album?')) { removeAlbum(${index}); this.closest('.fixed').remove(); }" 
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

function ensureAlbumsVisible() {
  const container = document.getElementById('albumContainer');
  if (container && container.children.length === 0 && currentList && lists[currentList]) {
    console.log('Force re-rendering albums...');
    displayAlbums(lists[currentList]);
  }
}

// Display albums function with editable genres and comments
function displayAlbums(albums) {
  console.log('displayAlbums called, mobile:', window.innerWidth < 1024, 'albums:', albums?.length);
  
  const isMobile = window.innerWidth < 1024; // Tailwind's lg breakpoint
  
  // Get the correct container based on viewport
  const container = isMobile 
    ? document.getElementById('mobileAlbumContainer') 
    : document.getElementById('albumContainer');
    
  console.log('Container found:', !!container, 'Container ID:', container?.id);
  
  if (!container) {
    console.error('Album container not found!');
    return;
  }
  
  container.innerHTML = '';
  console.log('Container cleared, about to add albums...');
  
  if (!albums || albums.length === 0) {
    container.innerHTML = `
      <div class="text-center text-gray-500 mt-20 px-4">
        <p class="text-xl mb-2">This list is empty</p>
        <p class="text-sm">Click the + button to add albums${isMobile ? ' from the bottom menu' : ''}</p>
      </div>
    `;
    return;
  }

  if (!isMobile) {
    // Desktop view - your existing code
    const table = document.createElement('div');
    table.className = 'w-full relative';
    
    // Header - now using album-grid class with button column
    const header = document.createElement('div');
    header.className = 'album-grid gap-4 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-800 sticky top-0 bg-black z-10';
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
      <div class="flex justify-center">
        <button id="addAlbumBtn" class="bg-red-600 hover:bg-red-700 text-white p-1.5 rounded-full transition duration-200 transform hover:scale-105" title="Add Album">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      </div>
    `;
    table.appendChild(header);
    
    const rowsContainer = document.createElement('div');
    rowsContainer.className = 'album-rows-container relative';
    
    albums.forEach((album, index) => {
      const row = document.createElement('div');
      row.className = 'album-row album-grid gap-4 px-4 py-3 border-b border-gray-800 cursor-move hover:bg-gray-800/30 transition-colors';
      row.dataset.index = index;
      
      const position = index + 1;
      const albumName = album.album || 'Unknown Album';
      const artist = album.artist || 'Unknown Artist';
      const country = album.country || '';
      const genre1 = album.genre_1 || album.genre || '';
      
      let genre2 = album.genre_2 || '';
      if (genre2 === 'Genre 2' || genre2 === '-') {
        genre2 = '';
      }
      
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
          <span class="text-sm text-gray-300 truncate cursor-pointer hover:text-gray-100">${country}</span>
        </div>
        <div class="flex items-center genre-cell genre-1-cell">
          <span class="text-sm text-gray-300 truncate cursor-pointer hover:text-gray-100">${genre1}</span>
        </div>
        <div class="flex items-center genre-cell genre-2-cell">
          <span class="text-sm text-gray-400 truncate cursor-pointer hover:text-gray-100">${genre2}</span>
        </div>
        <div class="flex items-center comment-cell">
          <span class="text-sm text-gray-300 italic line-clamp-2 cursor-pointer hover:text-gray-100">${comment}</span>
        </div>
        <div></div> <!-- Empty cell for button column -->
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
    
    // Re-initialize the add album button
    const addAlbumBtn = document.getElementById('addAlbumBtn');
    if (addAlbumBtn && window.openAddAlbumModal) {
      addAlbumBtn.onclick = window.openAddAlbumModal;
    }
    
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
    console.log('Building mobile view for', albums.length, 'albums');
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
              <button onclick="event.stopPropagation(); showMobileAlbumMenu(${index})" 
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
      mobileContainer.appendChild(cardWrapper);
    });
    
    container.appendChild(mobileContainer);
    console.log('Mobile container appended with', albums.length, 'albums');
    
    // Initialize SortableJS for mobile
    initializeMobileSorting(mobileContainer);
  }
  
  console.log('displayAlbums completed');
}

// Add this function to handle mobile album actions
window.showMobileAlbumMenu = function(index) {
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
  // This would show a mobile-friendly edit form
  // For now, we'll just show a toast
  showToast('Edit functionality coming soon for mobile', 'info');
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

// Clear all lists
document.getElementById('clearBtn').onclick = async () => {
  if (confirm('Are you sure you want to delete all lists? This cannot be undone.')) {
    try {
      await clearAllLists();
      currentList = null;
      updateListNav();
      
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
      
      showToast('All lists cleared');
    } catch (error) {
      console.error('Error clearing lists:', error);
      showToast('Error clearing lists', 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Promise.all([loadGenres(), loadCountries(), loadLists()])
    .then(() => {
      initializeContextMenu();
      initializeAlbumContextMenu();
      initializeCreateList();
      initializeRenameList();
      initializeImportConflictHandling();
      
      // Auto-load last selected list if available
      if (window.lastSelectedList && lists[window.lastSelectedList]) {
        console.log('Auto-loading last selected list:', window.lastSelectedList);
        selectList(window.lastSelectedList);
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

// Make showToast globally available
window.showToast = showToast;