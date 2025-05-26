// Global variables
let currentList = null;
let lists = {};

// Drag and drop variables (same as before)
let draggedElement = null;
let draggedIndex = null;
let placeholder = null;
let lastValidDropIndex = null;

// Toast notification (same as before)
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
    await apiCall(`/api/lists/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify({ data })
    });
    lists[name] = data;
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

// Update sidebar navigation (same as before)
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
    li.querySelector('button').onclick = () => selectList(listName);
    nav.appendChild(li);
  });
}

// Select and display a list (same as before)
function selectList(listName) {
  currentList = listName;
  const list = lists[listName];
  
  document.getElementById('listTitle').textContent = listName;
  document.getElementById('listInfo').textContent = `${list.length} albums`;
  
  displayAlbums(list);
  updateListNav();
}

// Initialize drag and drop for container (same as before)
function initializeDragAndDrop() {
  const container = document.getElementById('albumContainer');
  
  container.addEventListener('dragover', handleContainerDragOver);
  container.addEventListener('drop', handleContainerDrop);
  container.addEventListener('dragleave', handleContainerDragLeave);
}

// All drag handlers remain the same...
function handleDragStart(e) {
  draggedElement = this;
  draggedIndex = parseInt(this.dataset.index);
  
  placeholder = document.createElement('div');
  placeholder.className = 'album-row drag-placeholder grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-800';
  placeholder.style.height = this.offsetHeight + 'px';
  placeholder.innerHTML = '<div class="col-span-12 text-center text-gray-500">Drop here</div>';
  
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
  
  if (!draggedElement || lastValidDropIndex === null) return;
  
  const rowsContainer = this.querySelector('.album-rows-container') || this;
  const allRows = Array.from(rowsContainer.querySelectorAll('.album-row:not(.drag-placeholder)'));
  
  let dropIndex = lastValidDropIndex;
  if (draggedIndex < dropIndex) {
    dropIndex--;
  }
  
  if (dropIndex !== draggedIndex) {
    try {
      const list = lists[currentList];
      
      const [movedItem] = list.splice(draggedIndex, 1);
      list.splice(dropIndex, 0, movedItem);
      
      list.forEach((album, index) => {
        album.rank = index + 1;
      });
      
      await saveList(currentList, list);
      displayAlbums(list);
      showToast('Reordered successfully');
    } catch (error) {
      console.error('Error saving reorder:', error);
      showToast('Error saving changes', 'error');
    }
  }
}

// Display albums function remains the same...
function displayAlbums(albums) {
  const container = document.getElementById('albumContainer');
  container.innerHTML = '';
  
  if (!albums || albums.length === 0) {
    container.innerHTML = '<p class="text-center text-gray-500 mt-20">No albums in this list</p>';
    return;
  }
  
  const table = document.createElement('div');
  table.className = 'w-full relative';
  
  const header = document.createElement('div');
  header.className = 'grid grid-cols-12 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-800 sticky top-0 bg-black z-10';
  header.innerHTML = `
    <div class="col-span-1">#</div>
    <div class="col-span-1"></div>
    <div class="col-span-4">Album</div>
    <div class="col-span-2">Artist</div>
    <div class="col-span-2">Genre</div>
    <div class="col-span-1">Rating</div>
    <div class="col-span-1">Points</div>
  `;
  table.appendChild(header);
  
  const rowsContainer = document.createElement('div');
  rowsContainer.className = 'album-rows-container relative';
  
  albums.forEach((album, index) => {
    const row = document.createElement('div');
    row.className = 'album-row grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-800 cursor-move';
    row.draggable = true;
    row.dataset.index = index;
    
    const rank = album.rank || index + 1;
    const albumName = album.album || 'Unknown Album';
    const artist = album.artist || 'Unknown Artist';
    const genre = album.genre_1 || album.genre || 'Unknown';
    const rating = album.rating || '-';
    const points = album.points || '-';
    const releaseDate = album.release_date || '';
    const coverImage = album.cover_image || '';
    const imageFormat = album.cover_image_format || 'PNG';
    
    row.innerHTML = `
      <div class="col-span-1 text-gray-400">${rank}</div>
      <div class="col-span-1">
        ${coverImage ? `
          <img src="data:image/${imageFormat};base64,${coverImage}" 
               alt="${albumName}" 
               class="w-10 h-10 rounded"
               loading="lazy"
               onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjMUYyOTM3Ii8+CjxwYXRoIGQ9Ik0yMCAxMEMyMCAxMCAyNSAxNSAyNSAyMEMyNSAyNSAyMCAzMCAyMCAzMEMyMCAzMCAxNSAyNSAxNSAyMEMxNSAxNSAyMCAxMCAyMCAxMFoiIGZpbGw9IiM5Q0EzQUYiLz4KPC9zdmc+'"
          >
        ` : `
          <div class="w-10 h-10 rounded bg-gray-800 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-600">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          </div>
        `}
      </div>
      <div class="col-span-4">
        <div class="font-medium">${albumName}</div>
        <div class="text-xs text-gray-400">${releaseDate}</div>
      </div>
      <div class="col-span-2 text-gray-300">${artist}</div>
      <div class="col-span-2 text-sm text-gray-400">${genre}</div>
      <div class="col-span-1 text-red-500 font-semibold">${rating}</div>
      <div class="col-span-1 text-gray-300">${points}</div>
    `;
    
    row.addEventListener('dragstart', handleDragStart);
    row.addEventListener('dragend', handleDragEnd);
    
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
          <p class="text-sm">Import a JSON file to get started</p>
        </div>
      `;
      showToast('All lists cleared');
    } catch (error) {
      console.error('Error clearing lists:', error);
      showToast('Error clearing lists', 'error');
    }
  }
};

// Initialize on load
loadLists().catch(err => {
  console.error('Failed to load lists:', err);
  showToast('Failed to load lists', 'error');
});