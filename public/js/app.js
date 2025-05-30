// Global variables
let currentList = null;
let lists = {};
let availableGenres = [];
let availableCountries = [];
let pendingImportData = null;
let pendingImportFilename = null;

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
          document.getElementById('listTitle').textContent = 'Select a list to begin';
          document.getElementById('listInfo').textContent = '';
          document.getElementById('albumContainer').innerHTML = `
            <div class="text-center text-gray-500 mt-20">
              <p class="text-xl mb-2">No list selected</p>
              <p class="text-sm">Create or import a list to get started</p>
            </div>
          `;
          
          // Hide the add album button
          const addAlbumBtn = document.getElementById('addAlbumBtn');
          if (addAlbumBtn) {
            addAlbumBtn.classList.add('hidden');
          }
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

// Initialize album context menu
function initializeAlbumContextMenu() {
  const contextMenu = document.getElementById('albumContextMenu');
  const removeOption = document.getElementById('removeAlbumOption');
  
  if (!contextMenu || !removeOption) return;
  
  // Handle remove option click
  removeOption.onclick = async () => {
    contextMenu.classList.add('hidden');
    
    if (currentContextAlbum === null) return;
    
    // Confirm deletion
    const album = lists[currentList][currentContextAlbum];
    if (confirm(`Are you sure you want to remove "${album.album}" by ${album.artist} from this list?`)) {
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
    }
    
    currentContextAlbum = null;
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
  nav.innerHTML = '';
  
  Object.keys(lists).forEach(listName => {
    const li = document.createElement('li');
    li.innerHTML = `
      <button class="w-full text-left px-3 py-2 rounded text-sm hover:bg-gray-800 transition duration-200 ${currentList === listName ? 'bg-gray-800 text-red-500' : 'text-gray-300'}">
        ${listName}
      </button>
    `;
    
    const button = li.querySelector('button');
    
    // Left click - select list
    button.onclick = () => selectList(listName);
    
    // Right click - show context menu
    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      currentContextList = listName;
      
      const contextMenu = document.getElementById('contextMenu');
      if (!contextMenu) return;
      
      // Position the context menu at cursor
      contextMenu.style.left = `${e.clientX}px`;
      contextMenu.style.top = `${e.clientY}px`;
      contextMenu.classList.remove('hidden');
      
      // Adjust position if menu goes off-screen
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
    
    nav.appendChild(li);
  });
}

// Select and display a list
function selectList(listName) {
  currentList = listName;
  const list = lists[listName];
  
  document.getElementById('listTitle').textContent = listName;
  
  // Remove this line since we're no longer showing stats:
  // document.getElementById('listInfo').textContent = `${list.length} albums • ${totalPoints} total points`;
  
  displayAlbums(list);
  updateListNav();
  
  // Show the add album button when a list is selected
  const addAlbumBtn = document.getElementById('addAlbumBtn');
  if (addAlbumBtn) {
    addAlbumBtn.classList.remove('hidden');
  }
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
function displayAlbums(albums) {
  const container = document.getElementById('albumContainer');
  container.innerHTML = '';
  
  if (!albums || albums.length === 0) {
    container.innerHTML = `
      <div class="text-center text-gray-500 mt-20">
        <p class="text-xl mb-2">This list is empty</p>
        <p class="text-sm">Click the + button above to add albums from MusicBrainz</p>
      </div>
    `;
    return;
  }

  const table = document.createElement('div');
  table.className = 'w-full relative';
  
  // Header - now using album-grid class
  const header = document.createElement('div');
  header.className = 'album-grid gap-4 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-800 sticky top-0 bg-black z-10';
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
    row.className = 'album-row album-grid gap-4 px-4 py-3 border-b border-gray-800 cursor-move hover:bg-gray-800/30 transition-colors';
    row.dataset.index = index;
    
    const position = index + 1;
    const albumName = album.album || 'Unknown Album';
    const artist = album.artist || 'Unknown Artist';
    const country = album.country || '';
    const genre1 = album.genre_1 || album.genre || '';
    
    // Handle genre_2: show empty if it's missing, "Genre 2", or "-"
    let genre2 = album.genre_2 || '';
    if (genre2 === 'Genre 2' || genre2 === '-') {
      genre2 = '';
    }
    
    // Handle comment: show empty if it's "Comment" or missing
    let comment = album.comments || album.comment || '';
    if (comment === 'Comment') {
      comment = '';
    }
    
    const releaseDate = album.release_date || '';
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
      
      // Position the context menu at cursor
      contextMenu.style.left = `${e.clientX}px`;
      contextMenu.style.top = `${e.clientY}px`;
      contextMenu.classList.remove('hidden');
      
      // Adjust position if menu goes off-screen
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
    
    // Set up the drop handler callback
    window.DragDropManager.setupDropHandler(async (draggedIndex, dropIndex, needsRebuild) => {
      if (needsRebuild) {
        // Rebuild the display on error
        displayAlbums(lists[currentList]);
        return;
      }
      
      if (draggedIndex !== null && dropIndex !== null) {
        // Update the data to match the new DOM order
        const list = lists[currentList];
        const [movedItem] = list.splice(draggedIndex, 1);
        list.splice(dropIndex, 0, movedItem);
        
        // Save to server
        await saveList(currentList, list);
      }
    });
  }
}

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
      document.getElementById('listTitle').textContent = 'Select a list to begin';
      document.getElementById('listInfo').textContent = '';
      document.getElementById('albumContainer').innerHTML = `
        <div class="text-center text-gray-500 mt-20">
          <p class="text-xl mb-2">No list selected</p>
          <p class="text-sm">Create or import a list to get started</p>
        </div>
      `;
      
      // Hide the add album button
      const addAlbumBtn = document.getElementById('addAlbumBtn');
      if (addAlbumBtn) {
        addAlbumBtn.classList.add('hidden');
      }
      
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
      initializeImportConflictHandling(); // Add this line
    })
    .catch(err => {
      console.error('Failed to initialize:', err);
      showToast('Failed to initialize', 'error');
    });
});

// Make showToast globally available
window.showToast = showToast;