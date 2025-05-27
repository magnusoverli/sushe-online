// MusicBrainz API integration
const MUSICBRAINZ_API = 'https://musicbrainz.org/ws/2';
const COVERART_API = 'https://coverartarchive.org';
const USER_AGENT = 'KVLT Album Manager/1.0 (https://kvlt.example.com)';

// Rate limiting - MusicBrainz requires max 1 request per second
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1100; // 1.1 seconds to be safe

async function rateLimitedFetch(url) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }
  
  lastRequestTime = Date.now();
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  return response.json();
}

// Search for artists
async function searchArtists(query) {
  const url = `${MUSICBRAINZ_API}/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=10`;
  const data = await rateLimitedFetch(url);
  return data.artists || [];
}

// Get release groups - ONLY pure Albums and EPs (no secondary types)
async function getArtistReleaseGroups(artistId) {
  // Get albums and EPs
  const url = `${MUSICBRAINZ_API}/release-group?artist=${artistId}&type=album|ep&fmt=json&limit=100`;
  const data = await rateLimitedFetch(url);
  
  let releaseGroups = data['release-groups'] || [];
  
  // Filter to ONLY include releases with no secondary types
  // This gives us pure "Album" or "EP" releases only
  releaseGroups = releaseGroups.filter(rg => {
    const primaryType = rg['primary-type'];
    const secondaryTypes = rg['secondary-types'] || [];
    
    // Only include if it's an Album or EP with NO secondary types
    return (primaryType === 'Album' || primaryType === 'EP') && secondaryTypes.length === 0;
  });
  
  // Sort by first release date (newest first)
  releaseGroups.sort((a, b) => {
    const dateA = a['first-release-date'] || '0000';
    const dateB = b['first-release-date'] || '0000';
    return dateB.localeCompare(dateA);
  });
  
  return releaseGroups;
}

// Get cover art for a release group
async function getCoverArt(releaseGroupId) {
  try {
    const response = await fetch(`${COVERART_API}/release-group/${releaseGroupId}`, {
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    // Get the front image thumbnail
    if (data.images && data.images.length > 0) {
      const frontImage = data.images.find(img => img.front) || data.images[0];
      return frontImage.thumbnails['250'] || frontImage.thumbnails.small || frontImage.image;
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching cover art:', error);
    return null;
  }
}

// Convert date to year format
function formatReleaseDate(date) {
  if (!date) return '';
  return date.split('-')[0]; // Just return the year
}

// Modal management
let currentArtist = null;
let modal = null;
let modalElements = {};

function initializeAddAlbumFeature() {
  // Get modal elements
  modal = document.getElementById('addAlbumModal');
  modalElements = {
    artistSearchInput: document.getElementById('artistSearchInput'),
    searchArtistBtn: document.getElementById('searchArtistBtn'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    artistResults: document.getElementById('artistResults'),
    albumResults: document.getElementById('albumResults'),
    artistList: document.getElementById('artistList'),
    albumList: document.getElementById('albumList'),
    searchLoading: document.getElementById('searchLoading'),
    searchEmpty: document.getElementById('searchEmpty'),
    backToArtists: document.getElementById('backToArtists')
  };
  
  // Add button click handler
  const addAlbumBtn = document.getElementById('addAlbumBtn');
  if (addAlbumBtn) {
    addAlbumBtn.onclick = openAddAlbumModal;
  }
  
  // Modal close handlers
  modalElements.closeModalBtn.onclick = closeAddAlbumModal;
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeAddAlbumModal();
    }
  };
  
  // Search handlers
  modalElements.searchArtistBtn.onclick = performArtistSearch;
  modalElements.artistSearchInput.onkeypress = (e) => {
    if (e.key === 'Enter') {
      performArtistSearch();
    }
  };
  
  // Back button
  modalElements.backToArtists.onclick = () => {
    showArtistResults();
    modalElements.albumResults.classList.add('hidden');
  };
  
  // ESC key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeAddAlbumModal();
    }
  });
}

function openAddAlbumModal() {
  if (!currentList) {
    showToast('Please select a list first', 'error');
    return;
  }
  
  modal.classList.remove('hidden');
  modalElements.artistSearchInput.value = '';
  modalElements.artistSearchInput.focus();
  resetModalState();
}

function closeAddAlbumModal() {
  modal.classList.add('hidden');
  resetModalState();
}

function resetModalState() {
  modalElements.artistResults.classList.add('hidden');
  modalElements.albumResults.classList.add('hidden');
  modalElements.searchLoading.classList.add('hidden');
  modalElements.searchEmpty.classList.remove('hidden');
  modalElements.artistList.innerHTML = '';
  modalElements.albumList.innerHTML = '';
  currentArtist = null;
}

function showLoading() {
  modalElements.artistResults.classList.add('hidden');
  modalElements.albumResults.classList.add('hidden');
  modalElements.searchEmpty.classList.add('hidden');
  modalElements.searchLoading.classList.remove('hidden');
}

function showArtistResults() {
  modalElements.searchLoading.classList.add('hidden');
  modalElements.searchEmpty.classList.add('hidden');
  modalElements.albumResults.classList.add('hidden');
  modalElements.artistResults.classList.remove('hidden');
}

function showAlbumResults() {
  modalElements.searchLoading.classList.add('hidden');
  modalElements.artistResults.classList.add('hidden');
  modalElements.albumResults.classList.remove('hidden');
}

async function performArtistSearch() {
  const query = modalElements.artistSearchInput.value.trim();
  if (!query) {
    showToast('Please enter an artist name', 'error');
    return;
  }
  
  showLoading();
  
  try {
    const artists = await searchArtists(query);
    
    if (artists.length === 0) {
      modalElements.searchLoading.classList.add('hidden');
      modalElements.searchEmpty.classList.remove('hidden');
      modalElements.searchEmpty.innerHTML = '<p>No artists found. Try a different search.</p>';
      return;
    }
    
    displayArtistResults(artists);
  } catch (error) {
    console.error('Error searching artists:', error);
    showToast('Error searching artists', 'error');
    modalElements.searchLoading.classList.add('hidden');
    modalElements.searchEmpty.classList.remove('hidden');
  }
}

function displayArtistResults(artists) {
  modalElements.artistList.innerHTML = '';
  
  artists.forEach(artist => {
    const artistEl = document.createElement('div');
    artistEl.className = 'p-4 bg-gray-800 rounded hover:bg-gray-700 cursor-pointer transition-colors';
    
    const disambiguation = artist.disambiguation ? ` <span class="text-gray-500 text-sm">(${artist.disambiguation})</span>` : '';
    const country = artist.country ? ` • ${artist.country}` : '';
    const lifeSpan = artist['life-span'];
    const years = lifeSpan ? ` • ${lifeSpan.begin || '?'} - ${lifeSpan.ended ? lifeSpan.end || '?' : 'present'}` : '';
    
    artistEl.innerHTML = `
      <div class="font-medium text-white">${artist.name}${disambiguation}</div>
      <div class="text-sm text-gray-400 mt-1">${artist.type || 'Artist'}${country}${years}</div>
    `;
    
    artistEl.onclick = () => selectArtist(artist);
    modalElements.artistList.appendChild(artistEl);
  });
  
  showArtistResults();
}

async function selectArtist(artist) {
  currentArtist = artist;
  showLoading();
  
  try {
    const releaseGroups = await getArtistReleaseGroups(artist.id);
    
    if (releaseGroups.length === 0) {
      showToast('No pure albums or EPs found for this artist', 'error');
      showAlbumResults();
      modalElements.albumList.innerHTML = '<p class="col-span-full text-center text-gray-500">No standard albums or EPs found. This artist may only have compilations, live albums, or other special releases.</p>';
      return;
    }
    
    // Fetch cover art for each release group
    const releaseGroupsWithArt = await Promise.all(
      releaseGroups.map(async (rg) => {
        const coverArt = await getCoverArt(rg.id);
        return { ...rg, coverArt };
      })
    );
    
    displayAlbumResults(releaseGroupsWithArt);
  } catch (error) {
    console.error('Error fetching albums:', error);
    showToast('Error fetching albums', 'error');
    showArtistResults();
  }
}

function displayAlbumResults(releaseGroups) {
  modalElements.albumList.innerHTML = '';
  
  releaseGroups.forEach(rg => {
    const albumEl = document.createElement('div');
    albumEl.className = 'bg-gray-800 rounded overflow-hidden hover:bg-gray-700 cursor-pointer transition-colors group';
    
    const releaseDate = formatReleaseDate(rg['first-release-date']);
    const albumType = rg['primary-type'];
    
    albumEl.innerHTML = `
      <div class="aspect-square bg-gray-900 flex items-center justify-center overflow-hidden">
        ${rg.coverArt ? 
          `<img src="${rg.coverArt}" alt="${rg.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy">` :
          `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="text-gray-600">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>`
        }
      </div>
      <div class="p-3">
        <div class="font-medium text-white text-sm truncate" title="${rg.title}">${rg.title}</div>
        <div class="text-xs text-gray-400 mt-1">${releaseDate} • ${albumType}</div>
      </div>
    `;
    
    albumEl.onclick = () => addAlbumToList(rg);
    modalElements.albumList.appendChild(albumEl);
  });
  
  showAlbumResults();
}

async function addAlbumToList(releaseGroup) {
  // Create album object matching the expected format
  const album = {
    artist: currentArtist.name,
    album: releaseGroup.title,
    album_id: releaseGroup.id,
    release_date: releaseGroup['first-release-date'] || '',
    country: currentArtist.country || '',
    genre_1: '', // User can add genres later
    genre_2: '',
    rating: '',
    comments: ''
  };
  
  // If we have cover art, download and convert to base64
  if (releaseGroup.coverArt) {
    try {
      const response = await fetch(releaseGroup.coverArt);
      const blob = await response.blob();
      const reader = new FileReader();
      
      reader.onloadend = function() {
        const base64data = reader.result;
        album.cover_image = base64data.split(',')[1]; // Remove data:image/jpeg;base64, prefix
        album.cover_image_format = blob.type.split('/')[1].toUpperCase();
        
        // Add to current list
        addAlbumToCurrentList(album);
      };
      
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('Error fetching cover art:', error);
      // Add without cover art
      addAlbumToCurrentList(album);
    }
  } else {
    // Add without cover art
    addAlbumToCurrentList(album);
  }
}

async function addAlbumToCurrentList(album) {
  try {
    // Add to the end of the current list
    lists[currentList].push(album);
    
    // Save to server
    await saveList(currentList, lists[currentList]);
    
    // Update display
    selectList(currentList);
    
    // Close modal
    closeAddAlbumModal();
    
    showToast(`Added "${album.album}" by ${album.artist} to the list`);
  } catch (error) {
    console.error('Error adding album:', error);
    showToast('Error adding album to list', 'error');
    
    // Remove the album we just added
    lists[currentList].pop();
  }
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
  // Wait a bit for the main app to initialize
  setTimeout(initializeAddAlbumFeature, 100);
});