// Global variables
let currentList = null;
let lists = {};
let availableGenres = [];
let availableCountries = [];

// Drag and drop variables
let draggedElement = null;
let draggedIndex = null;
let placeholder = null;
let lastValidDropIndex = null;

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

// Make country editable with dropdown
function makeCountryEditable(countryDiv, albumIndex) {
  // Check if we're already editing
  if (countryDiv.querySelector('select')) {
    return;
  }
  
  // Get current country from the live data
  const currentCountry = lists[currentList][albumIndex].country || '';
  
  // Create select element
  const select = document.createElement('select');
  select.className = 'w-full bg-gray-800 text-gray-300 text-sm p-1 rounded border border-gray-700 focus:outline-none focus:border-red-600';
  
  // Always add the "- Select Country -" option first
  const instructionOption = document.createElement('option');
  instructionOption.value = '##SELECT##';
  instructionOption.textContent = '- Select Country -';
  instructionOption.disabled = true;
  if (!currentCountry) {
    instructionOption.selected = true;
  }
  select.appendChild(instructionOption);
  
  // Add all available countries
  availableCountries.forEach(country => {
    const option = document.createElement('option');
    option.value = country;
    option.textContent = country;
    if (country === currentCountry) {
      option.selected = true;
    }
    select.appendChild(option);
  });
  
  // Store the original onclick handler
  const originalOnClick = countryDiv.onclick;
  countryDiv.onclick = null; // Temporarily remove click handler
  
  // Replace content with select
  countryDiv.innerHTML = '';
  countryDiv.appendChild(select);
  select.focus();
  
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
    // Ignore instruction option
    if (newCountry === '##SELECT##') {
      return;
    }
    
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
  
  // Handle selection change
  select.addEventListener('change', (e) => {
    saveCountry(e.target.value);
  });
  
  // Handle keyboard
  select.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      restoreDisplay(currentCountry);
    }
  });
  
  // Define handleClickOutside
  handleClickOutside = (e) => {
    if (!countryDiv.contains(e.target)) {
      restoreDisplay(lists[currentList][albumIndex].country || '');
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
  const renameOption = document.getElementById('renameListOption');
  const deleteOption = document.getElementById('deleteListOption');
  
  if (!contextMenu || !deleteOption || !renameOption) return;
  
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
          
          // Hide the export button
          const exportBtn = document.getElementById('exportBtn');
          if (exportBtn) {
            exportBtn.classList.add('hidden');
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

// Export functionality
function initializeExport() {
  const exportBtn = document.getElementById('exportBtn');
  if (!exportBtn) return;
  
  exportBtn.onclick = () => {
    if (!currentList || !lists[currentList]) {
      showToast('No list selected to export', 'error');
      return;
    }
    
    try {
      // Get the current list data
      const listData = lists[currentList];
      
      // Create a copy with rank added based on position
      const exportData = listData.map((album, index) => {
        const exported = { ...album };
        // Add rank based on position (1-indexed)
        exported.rank = index + 1;
        // Add points for this position
        exported.points = getPointsForPosition(index + 1);
        // Remove any internal properties that shouldn't be exported
        // (but keep rank and points since they're useful)
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
      a.download = `${currentList}.json`;
      
      // Trigger download
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showToast(`Exported "${currentList}" successfully`);
    } catch (error) {
      console.error('Error exporting list:', error);
      showToast('Error exporting list', 'error');
    }
  };
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
  
  // Calculate total points for the list
  const totalPoints = list.reduce((sum, _, index) => {
    return sum + getPointsForPosition(index + 1);
  }, 0);
  
  document.getElementById('listInfo').textContent = `${list.length} albums • ${totalPoints} total points`;
  
  displayAlbums(list);
  updateListNav();
  
  // Show the add album button when a list is selected
  const addAlbumBtn = document.getElementById('addAlbumBtn');
  if (addAlbumBtn) {
    addAlbumBtn.classList.remove('hidden');
  }
  
  // Show the export button when a list is selected
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    exportBtn.classList.remove('hidden');
  }
}

// Initialize drag and drop for container
function initializeDragAndDrop() {
  const container = document.getElementById('albumContainer');
  
  container.addEventListener('dragover', handleContainerDragOver);
  container.addEventListener('drop', handleContainerDrop);
  container.addEventListener('dragleave', handleContainerDragLeave);
}

// Drag handlers
function handleDragStart(e) {
  // Don't start drag if we're editing a comment or selecting genre/country
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
    e.preventDefault();
    return;
  }
  
  draggedElement = this;
  draggedIndex = parseInt(this.dataset.index);
  
  placeholder = document.createElement('div');
  placeholder.className = 'album-row drag-placeholder grid grid-cols-[50px_60px_1fr_0.8fr_0.5fr_0.6fr_0.6fr_1.2fr] gap-4 px-4 py-3 border-b border-gray-800';
  placeholder.style.height = this.offsetHeight + 'px';
  placeholder.innerHTML = '<div class="col-span-full text-center text-gray-500">Drop album here</div>';
  
  this.classList.add('dragging');
  
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', this.innerHTML);
  
  requestAnimationFrame(() => {
    this.style.display = 'none';
    this.parentNode.insertBefore(placeholder, this.nextSibling);
  });
}

function handleContainerDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  
  const rowsContainer = this.querySelector('.album-rows-container') || this;
  const afterElement = getDragAfterElement(rowsContainer, e.clientY);
  
  if (!placeholder || !placeholder.parentNode) return;
  
  if (afterElement == null) {
    rowsContainer.appendChild(placeholder);
    lastValidDropIndex = rowsContainer.children.length - 1;
  } else {
    rowsContainer.insertBefore(placeholder, afterElement);
    const allElements = Array.from(rowsContainer.children);
    lastValidDropIndex = allElements.indexOf(placeholder);
  }
  
  this.classList.add('drag-active');
}

function handleContainerDragLeave(e) {
  const rect = this.getBoundingClientRect();
  if (e.clientX < rect.left || e.clientX > rect.right || 
      e.clientY < rect.top || e.clientY > rect.bottom) {
    this.classList.remove('drag-active');
  }
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.album-row:not(.dragging):not(.drag-placeholder)')];
  
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function handleDragEnd(e) {
  if (draggedElement) {
    draggedElement.style.display = '';
    draggedElement.classList.remove('dragging');
  }
  
  // Only remove placeholder if it still exists (wasn't removed by drop handler)
  if (placeholder && placeholder.parentNode) {
    placeholder.parentNode.removeChild(placeholder);
  }
  
  document.getElementById('albumContainer').classList.remove('drag-active');
  
  draggedElement = null;
  draggedIndex = null;
  placeholder = null;
  lastValidDropIndex = null;
}

async function handleContainerDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  
  this.classList.remove('drag-active');
  
  if (!draggedElement || lastValidDropIndex === null || !placeholder) return;
  
  const rowsContainer = this.querySelector('.album-rows-container') || this;
  
  let dropIndex = lastValidDropIndex;
  if (draggedIndex < dropIndex) {
    dropIndex--;
  }
  
  if (dropIndex !== draggedIndex) {
    try {
      // First, immediately update the DOM by moving the dragged element
      if (placeholder && placeholder.parentNode) {
        // Insert the dragged element where the placeholder is
        placeholder.parentNode.insertBefore(draggedElement, placeholder);
        // Remove the placeholder
        placeholder.parentNode.removeChild(placeholder);
        placeholder = null;
      }
      
      // Show the dragged element in its new position
      draggedElement.style.display = '';
      draggedElement.classList.remove('dragging');
      
      // Update all position numbers and data-index attributes
      const allRows = Array.from(rowsContainer.querySelectorAll('.album-row'));
      allRows.forEach((row, index) => {
        // Update position number
        const positionEl = row.querySelector('.flex.items-center.justify-center');
        if (positionEl) {
          positionEl.textContent = index + 1;
        }
        // Update data-index
        row.dataset.index = index;
      });
      
      // Now update the data to match the new DOM order
      const list = lists[currentList];
      const [movedItem] = list.splice(draggedIndex, 1);
      list.splice(dropIndex, 0, movedItem);
      
      // Save to server
      await saveList(currentList, list);
      showToast('Reordered successfully');
      
    } catch (error) {
      console.error('Error saving reorder:', error);
      showToast('Error saving changes', 'error');
      // On error, rebuild to ensure consistency
      displayAlbums(lists[currentList]);
    }
  }
  
  // Clean up drag state
  draggedElement = null;
  draggedIndex = null;
  lastValidDropIndex = null;
}

// Update positions without rebuilding
function updateAlbumPositions(container) {
  const rows = Array.from(container.querySelectorAll('.album-row:not(.drag-placeholder)'));
  
  rows.forEach((row, index) => {
    // Update the position number
    const positionEl = row.querySelector('.flex.items-center.justify-center');
    if (positionEl) {
      positionEl.textContent = index + 1;
    }
    
    // Update the data-index attribute
    row.dataset.index = index;
  });
}

// Make genre editable with dropdown
function makeGenreEditable(genreDiv, albumIndex, genreField) {
  // Check if we're already editing
  if (genreDiv.querySelector('select')) {
    return;
  }
  
  // Get current genre from the live data
  const currentGenre = lists[currentList][albumIndex][genreField] || '';
  
  // Create select element
  const select = document.createElement('select');
  select.className = 'w-full bg-gray-800 text-gray-300 text-sm p-1 rounded border border-gray-700 focus:outline-none focus:border-red-600';
  
  // Always add the "- Select Genre -" option first
  const instructionOption = document.createElement('option');
  instructionOption.value = '##SELECT##';
  instructionOption.textContent = '- Select Genre -';
  instructionOption.disabled = true;
  if (!currentGenre) {
    instructionOption.selected = true;
  }
  select.appendChild(instructionOption);
  
  // Add all available genres
  availableGenres.forEach(genre => {
    const option = document.createElement('option');
    option.value = genre;
    option.textContent = genre;
    if (genre === currentGenre) {
      option.selected = true;
    }
    select.appendChild(option);
  });
  
  // Store the original onclick handler
  const originalOnClick = genreDiv.onclick;
  genreDiv.onclick = null; // Temporarily remove click handler
  
  // Replace content with select
  genreDiv.innerHTML = '';
  genreDiv.appendChild(select);
  select.focus();
  
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
    // Ignore instruction option
    if (newGenre === '##SELECT##') {
      return;
    }
    
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
  
  // Handle selection change
  select.addEventListener('change', (e) => {
    saveGenre(e.target.value);
  });
  
  // Handle keyboard
  select.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      restoreDisplay(currentGenre);
    }
  });
  
  // Define handleClickOutside
  handleClickOutside = (e) => {
    if (!genreDiv.contains(e.target)) {
      restoreDisplay(lists[currentList][albumIndex][genreField] || '');
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
  
  // Header with country column - updated grid
  const header = document.createElement('div');
  header.className = 'grid grid-cols-[50px_60px_1fr_0.8fr_0.5fr_0.6fr_0.6fr_1.2fr] gap-4 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-800 sticky top-0 bg-black z-10';
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
    row.className = 'album-row grid grid-cols-[50px_60px_1fr_0.8fr_0.5fr_0.6fr_0.6fr_1.2fr] gap-4 px-4 py-3 border-b border-gray-800 cursor-move hover:bg-gray-800/30 transition-colors';
    row.draggable = true;
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
        ${coverImage ? `
          <img src="data:image/${imageFormat};base64,${coverImage}" 
               alt="${albumName}" 
               class="w-12 h-12 rounded shadow-lg"
               loading="lazy"
               onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiBmaWxsPSIjMUYyOTM3Ii8+CjxwYXRoIGQ9Ik0yNCAxMkMyNCAxMiAzMCAxOCAzMCAyNEMzMCAzMCAyNCAzNiAyNCAzNkMyNCAzNiAxOCAzMCAxOCAyNEMxOCAxOCAyNCAxMiAyNCAxMloiIGZpbGw9IiM0QjU1NjMiLz4KPC9zdmc+'"
          >
        ` : `
          <div class="w-12 h-12 rounded bg-gray-800 flex items-center justify-center shadow-lg">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-600">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          </div>
        `}
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
    
    row.addEventListener('dragstart', handleDragStart);
    row.addEventListener('dragend', handleDragEnd);
    
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
  
  initializeDragAndDrop();
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
        
        // Save to server
        await saveList(listName, data);
        
        updateListNav();
        selectList(listName);
        
        showToast(`Successfully imported ${data.length} albums`);
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
      
      // Hide the export button
      const exportBtn = document.getElementById('exportBtn');
      if (exportBtn) {
        exportBtn.classList.add('hidden');
      }
      
      showToast('All lists cleared');
    } catch (error) {
      console.error('Error clearing lists:', error);
      showToast('Error clearing lists', 'error');
    }
  }
};

// Initialize on load
Promise.all([loadGenres(), loadCountries(), loadLists()])
  .then(() => {
    initializeContextMenu();
    initializeAlbumContextMenu();
    initializeCreateList();
    initializeRenameList();
    initializeExport();
  })
  .catch(err => {
    console.error('Failed to initialize:', err);
    showToast('Failed to initialize', 'error');
  });