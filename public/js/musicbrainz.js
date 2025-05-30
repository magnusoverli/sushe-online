// MusicBrainz API integration
const MUSICBRAINZ_API = 'https://musicbrainz.org/ws/2';
const COVERART_API = 'https://coverartarchive.org';
const ITUNES_API = 'https://itunes.apple.com';
const DEEZER_PROXY = '/api/proxy/deezer'; // Using our proxy
const USER_AGENT = 'KVLT Album Manager/1.0 (https://kvlt.example.com)';

// Rate limiting - MusicBrainz requires max 1 request per second
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1100; // 1.1 seconds to be safe

// Manual entry elements
let manualEntryElements = {};

// Cache for searches to avoid duplicate requests
const itunesCache = new Map();
const deezerCache = new Map();

// Concurrent request limits
const ITUNES_BATCH_SIZE = 5;
const COVERART_BATCH_SIZE = 3;
const DEEZER_BATCH_SIZE = 5;

// Queue for managing concurrent requests
class RequestQueue {
  constructor(batchSize) {
    this.batchSize = batchSize;
    this.running = 0;
    this.queue = [];
  }

  async add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  async process() {
    while (this.running < this.batchSize && this.queue.length > 0) {
      const { fn, resolve, reject } = this.queue.shift();
      this.running++;
      
      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          this.running--;
          this.process();
        });
    }
  }
}

const itunesQueue = new RequestQueue(ITUNES_BATCH_SIZE);
const coverArtQueue = new RequestQueue(COVERART_BATCH_SIZE);
const deezerQueue = new RequestQueue(DEEZER_BATCH_SIZE);

// Modal management
let currentArtist = null;
let modal = null;
let modalElements = {};
let currentLoadingController = null;

// Optimization 4: Smart Source Priority
const sourceStats = {
  itunes: { attempts: 0, successes: 0 },
  deezer: { attempts: 0, successes: 0 },
  coverart: { attempts: 0, successes: 0 }
};

// Optimization 1: Preload cache for hovering
const preloadCache = new Map();
let currentPreloadController = null;

// Optimization 3: Browser Connection Optimization
function warmupConnections() {
  const cdns = [
    'https://is1-ssl.mzstatic.com', // iTunes CDN
    'https://is2-ssl.mzstatic.com', // iTunes CDN alternate
    'https://is3-ssl.mzstatic.com', // iTunes CDN alternate
    'https://is4-ssl.mzstatic.com', // iTunes CDN alternate
    'https://is5-ssl.mzstatic.com', // iTunes CDN alternate
    'https://e-cdns-images.dzcdn.net', // Deezer CDN
    'https://coverartarchive.org'
  ];
  
  cdns.forEach(origin => {
    const existingLink = document.querySelector(`link[href="${origin}"]`);
    if (!existingLink) {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = origin;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }
  });
}

// Rate limited fetch ONLY for MusicBrainz
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
  const url = `${MUSICBRAINZ_API}/release-group?artist=${artistId}&type=album|ep&fmt=json&limit=100`;
  const data = await rateLimitedFetch(url);
  
  let releaseGroups = data['release-groups'] || [];
  
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  
  releaseGroups = releaseGroups.filter(rg => {
    const primaryType = rg['primary-type'];
    const secondaryTypes = rg['secondary-types'] || [];
    const releaseDate = rg['first-release-date'];
    
    const isValidType = (primaryType === 'Album' || primaryType === 'EP') && secondaryTypes.length === 0;
    
    // Exclude releases without a release date
    if (!releaseDate) {
      return false;
    }
    
    let hasBeenReleased = true;
    let comparableDate = releaseDate;
    
    if (releaseDate.length === 4) {
      comparableDate = `${releaseDate}-12-31`;
    } else if (releaseDate.length === 7) {
      const [year, month] = releaseDate.split('-');
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      comparableDate = `${releaseDate}-${lastDay.toString().padStart(2, '0')}`;
    }
    
    hasBeenReleased = comparableDate <= todayStr;
    
    return isValidType && hasBeenReleased;
  });
  
  releaseGroups.sort((a, b) => {
    const dateA = a['first-release-date'] || '0000';
    const dateB = b['first-release-date'] || '0000';
    return dateB.localeCompare(dateA);
  });
  
  return releaseGroups;
}

// Search iTunes for album artwork
async function searchITunesArtwork(artistName, albumName) {
  const cacheKey = `${artistName}::${albumName}`.toLowerCase();
  
  if (itunesCache.has(cacheKey)) {
    return itunesCache.get(cacheKey);
  }
  
  sourceStats.itunes.attempts++;
  
  return itunesQueue.add(async () => {
    try {
      const searchTerm = `${artistName} ${albumName}`.replace(/[^\w\s]/g, ' ').trim();
      const url = `${ITUNES_API}/search?term=${encodeURIComponent(searchTerm)}&entity=album&limit=5`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('iTunes API request failed');
      }
      
      const data = await response.json();
      
      if (data.results && data.results.length > 0) {
        const normalizedAlbumName = albumName.toLowerCase().replace(/[^\w\s]/g, '');
        const normalizedArtistName = artistName.toLowerCase().replace(/[^\w\s]/g, '');
        
        let bestMatch = data.results.find(result => {
          const resultAlbum = (result.collectionName || '').toLowerCase().replace(/[^\w\s]/g, '');
          const resultArtist = (result.artistName || '').toLowerCase().replace(/[^\w\s]/g, '');
          return resultAlbum === normalizedAlbumName && resultArtist === normalizedArtistName;
        });
        
        if (!bestMatch) {
          bestMatch = data.results.find(result => {
            const resultAlbum = (result.collectionName || '').toLowerCase().replace(/[^\w\s]/g, '');
            return resultAlbum.includes(normalizedAlbumName) || normalizedAlbumName.includes(resultAlbum);
          });
        }
        
        if (!bestMatch) {
          bestMatch = data.results[0];
        }
        
        if (bestMatch && bestMatch.artworkUrl100) {
          const highResArtwork = bestMatch.artworkUrl100.replace('100x100', '600x600');
          itunesCache.set(cacheKey, highResArtwork);
          sourceStats.itunes.successes++;
          return highResArtwork;
        }
      }
      
      itunesCache.set(cacheKey, null);
      return null;
    } catch (error) {
      console.error('iTunes search error:', error);
      itunesCache.set(cacheKey, null);
      return null;
    }
  });
}

// Search Deezer for album artwork (via proxy)
async function searchDeezerArtwork(artistName, albumName) {
  const cacheKey = `${artistName}::${albumName}`.toLowerCase();
  
  if (deezerCache.has(cacheKey)) {
    return deezerCache.get(cacheKey);
  }
  
  sourceStats.deezer.attempts++;
  
  return deezerQueue.add(async () => {
    try {
      const searchQuery = `${artistName} ${albumName}`.replace(/[^\w\s]/g, ' ').trim();
      const url = `${DEEZER_PROXY}?q=${encodeURIComponent(searchQuery)}`;
      
      const response = await fetch(url, {
        credentials: 'same-origin' // Include cookies for authentication
      });
      
      if (!response.ok) {
        throw new Error('Deezer proxy request failed');
      }
      
      const data = await response.json();
      
      if (data.data && data.data.length > 0) {
        const normalizedAlbumName = albumName.toLowerCase().replace(/[^\w\s]/g, '');
        const normalizedArtistName = artistName.toLowerCase().replace(/[^\w\s]/g, '');
        
        let bestMatch = data.data.find(album => {
          const albumTitle = (album.title || '').toLowerCase().replace(/[^\w\s]/g, '');
          const albumArtist = (album.artist?.name || '').toLowerCase().replace(/[^\w\s]/g, '');
          return albumTitle === normalizedAlbumName && albumArtist === normalizedArtistName;
        });
        
        if (!bestMatch) {
          bestMatch = data.data.find(album => {
            const albumTitle = (album.title || '').toLowerCase().replace(/[^\w\s]/g, '');
            return albumTitle.includes(normalizedAlbumName) || normalizedAlbumName.includes(albumTitle);
          });
        }
        
        if (!bestMatch) {
          bestMatch = data.data[0];
        }
        
        if (bestMatch && bestMatch.cover_xl) {
          deezerCache.set(cacheKey, bestMatch.cover_xl);
          sourceStats.deezer.successes++;
          return bestMatch.cover_xl;
        }
      }
      
      deezerCache.set(cacheKey, null);
      return null;
    } catch (error) {
      console.error('Deezer search error:', error);
      deezerCache.set(cacheKey, null);
      return null;
    }
  });
}

// Get cover art from Cover Art Archive
async function getCoverArtFromArchive(releaseGroupId) {
  sourceStats.coverart.attempts++;
  
  return coverArtQueue.add(async () => {
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
      
      if (data.images && data.images.length > 0) {
        const frontImage = data.images.find(img => img.front) || data.images[0];
        const imageUrl = frontImage.thumbnails['250'] || frontImage.thumbnails.small || frontImage.image;
        sourceStats.coverart.successes++;
        return imageUrl;
      }
      
      return null;
    } catch (error) {
      console.error('Error fetching cover art from archive:', error);
      return null;
    }
  });
}

// Optimization 4: Smart Source Priority
async function getCoverArt(releaseGroupId, artistName, albumTitle) {
  // Calculate success rates
  const getSuccessRate = (source) => {
    const stats = sourceStats[source];
    return stats.attempts > 0 ? stats.successes / stats.attempts : 0.5;
  };
  
  // Sort sources by success rate
  const sources = [
    { name: 'itunes', fn: () => searchITunesArtwork(artistName, albumTitle), enabled: artistName && albumTitle },
    { name: 'deezer', fn: () => searchDeezerArtwork(artistName, albumTitle), enabled: artistName && albumTitle },
    { name: 'coverart', fn: () => getCoverArtFromArchive(releaseGroupId), enabled: true }
  ]
  .filter(s => s.enabled)
  .sort((a, b) => getSuccessRate(b.name) - getSuccessRate(a.name));
  
  // Try sources in order of success rate
  for (const source of sources) {
    try {
      const result = await source.fn();
      if (result) {
        return result;
      }
    } catch (error) {
      console.error(`${source.name} error:`, error);
    }
  }
  
  return null;
}

// Convert date to year format
function formatReleaseDate(date) {
  if (!date) return '';
  return date.split('-')[0];
}

// Optimization 1: Preload on hover
async function preloadArtistAlbums(artist) {
  if (preloadCache.has(artist.id)) {
    return preloadCache.get(artist.id);
  }
  
  if (currentPreloadController) {
    currentPreloadController.abort();
  }
  
  currentPreloadController = new AbortController();
  
  try {
    const releaseGroups = await getArtistReleaseGroups(artist.id);
    
    if (!currentPreloadController.signal.aborted) {
      preloadCache.set(artist.id, releaseGroups);
      
      // Preload first 6 album covers
      releaseGroups.slice(0, 6).forEach(async (rg) => {
        const coverArt = await getCoverArt(rg.id, artist.name, rg.title);
        if (coverArt) {
          const img = new Image();
          img.src = coverArt;
        }
      });
    }
    
    return releaseGroups;
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Preload error:', error);
    }
    return null;
  }
}

// Optimization 2: Intersection Observer with background loading
let imageObserver = null;
let isBackgroundLoading = false;

function setupIntersectionObserver(releaseGroups, artistName) {
  // Clean up existing observer
  if (imageObserver) {
    imageObserver.disconnect();
  }
  
  // Track which albums have been loaded
  const loadedAlbums = new Set();
  const loadingAlbums = new Set();
  
  // Function to load a specific album's cover
  const loadAlbumCover = async (index) => {
    if (loadedAlbums.has(index) || loadingAlbums.has(index)) {
      return;
    }
    
    loadingAlbums.add(index);
    
    const albumEl = modalElements.albumList.querySelector(`[data-album-index="${index}"]`);
    if (!albumEl) return;
    
    const coverContainer = albumEl.querySelector('.album-cover-container');
    if (!coverContainer || coverContainer.dataset.loaded === 'true') return;
    
    try {
      const coverArt = await getCoverArt(releaseGroups[index].id, artistName, releaseGroups[index].title);
      
      if (coverArt && !currentLoadingController?.signal.aborted) {
        coverContainer.innerHTML = `
          <img src="${coverArt}" 
              alt="${releaseGroups[index].title}" 
              class="w-16 h-16 object-cover rounded-full" 
              loading="lazy" 
              crossorigin="anonymous"
              onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center animate-pulse\\'><svg width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1\\' class=\\'text-gray-600\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\' ry=\\'2\\'></rect><circle cx=\\'8.5\\' cy=\\'8.5\\' r=\\'1.5\\'></circle><polyline points=\\'21 15 16 10 5 21\\'></polyline></svg></div>'">
        `;
        releaseGroups[index].coverArt = coverArt;
        coverContainer.dataset.loaded = 'true';
      }
      
      loadedAlbums.add(index);
      loadingAlbums.delete(index);
      
    } catch (error) {
      console.error(`Error loading cover for ${releaseGroups[index].title}:`, error);
      loadedAlbums.add(index); // Mark as loaded to avoid retry
      loadingAlbums.delete(index);
    }
  };
  
  // Function to start background loading of remaining images
  const startBackgroundLoading = async () => {
    if (isBackgroundLoading || currentLoadingController?.signal.aborted) return;
    
    isBackgroundLoading = true;
    
    // Get all unloaded albums
    const unloadedIndexes = [];
    for (let i = 0; i < releaseGroups.length; i++) {
      if (!loadedAlbums.has(i) && !loadingAlbums.has(i)) {
        unloadedIndexes.push(i);
      }
    }
    
    // Load remaining albums in batches
    const BATCH_SIZE = 3;
    
    for (let i = 0; i < unloadedIndexes.length; i += BATCH_SIZE) {
      if (currentLoadingController?.signal.aborted) break;
      
      const batch = unloadedIndexes.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(index => loadAlbumCover(index));
      
      await Promise.allSettled(batchPromises);
      
      // Small delay between batches to avoid overwhelming the browser
      if (i + BATCH_SIZE < unloadedIndexes.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    isBackgroundLoading = false;
  };
  
  // Track visible images loaded
  let visibleImagesLoaded = 0;
  let totalVisibleImages = 0;
  
  imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const albumEl = entry.target;
        const index = parseInt(albumEl.dataset.albumIndex);
        
        totalVisibleImages++;
        
        // Load this album's cover
        loadAlbumCover(index).then(() => {
          visibleImagesLoaded++;
          
          // Check if all initially visible images are loaded
          if (visibleImagesLoaded >= totalVisibleImages && visibleImagesLoaded > 0) {
            // Start loading remaining images in background after a short delay
            setTimeout(() => {
              startBackgroundLoading();
            }, 500);
          }
        });
        
        // Stop observing this element
        observer.unobserve(albumEl);
      }
    });
  }, {
    rootMargin: '100px', // Start loading 100px before entering viewport
    threshold: 0.01
  });
  
  // Also start background loading after a timeout if no scrolling happens
  setTimeout(() => {
    if (visibleImagesLoaded === 0) {
      // No visible images detected yet, force check for visible albums
      const visibleAlbums = Array.from(modalElements.albumList.querySelectorAll('[data-album-index]'))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.top < window.innerHeight && rect.bottom > 0;
        });
      
      // Load visible albums first
      Promise.all(visibleAlbums.map(el => 
        loadAlbumCover(parseInt(el.dataset.albumIndex))
      )).then(() => {
        // Then start background loading
        startBackgroundLoading();
      });
    }
  }, 2000); // 2 seconds timeout
  
  return imageObserver;
}

// Initialize modal
function initializeAddAlbumFeature() {
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
  
  // Manual entry elements
  manualEntryElements = {
    manualEntryBtn: document.getElementById('manualEntryBtn'),
    manualEntryForm: document.getElementById('manualEntryForm'),
    backToSearch: document.getElementById('backToSearch'),
    form: document.getElementById('manualAlbumForm'),
    coverArtInput: document.getElementById('manualCoverArt'),
    coverPreview: document.getElementById('coverPreview'),
    countrySelect: document.getElementById('manualCountry'),
    cancelBtn: document.getElementById('cancelManualEntry')
  };
  
  const addAlbumBtn = document.getElementById('addAlbumBtn');
  if (addAlbumBtn) {
    addAlbumBtn.onclick = openAddAlbumModal;
  }
  
  modalElements.closeModalBtn.onclick = closeAddAlbumModal;
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeAddAlbumModal();
    }
  };
  
  modalElements.searchArtistBtn.onclick = performArtistSearch;
  modalElements.artistSearchInput.onkeypress = (e) => {
    if (e.key === 'Enter') {
      performArtistSearch();
    }
  };
  
  modalElements.backToArtists.onclick = () => {
    if (currentLoadingController) {
      currentLoadingController.abort();
      currentLoadingController = null;
    }
    showArtistResults();
    modalElements.albumResults.classList.add('hidden');
  };
  
  // Manual entry handlers
  manualEntryElements.manualEntryBtn.onclick = showManualEntryForm;
  manualEntryElements.backToSearch.onclick = hideManualEntryForm;
  manualEntryElements.cancelBtn.onclick = hideManualEntryForm;
  manualEntryElements.form.onsubmit = handleManualSubmit;
  manualEntryElements.coverArtInput.onchange = handleCoverArtUpload;
  
  // Populate country dropdown
  populateCountryDropdown();
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeAddAlbumModal();
    }
  });
}

// New functions for manual entry
function showManualEntryForm() {
  // Hide all other views
  modalElements.artistResults.classList.add('hidden');
  modalElements.albumResults.classList.add('hidden');
  modalElements.searchLoading.classList.add('hidden');
  modalElements.searchEmpty.classList.add('hidden');
  
  // Show manual entry form
  manualEntryElements.manualEntryForm.classList.remove('hidden');
  
  // Reset form
  manualEntryElements.form.reset();
  resetCoverPreview();
}

function hideManualEntryForm() {
  manualEntryElements.manualEntryForm.classList.add('hidden');
  modalElements.searchEmpty.classList.remove('hidden');
  
  // Reset form
  manualEntryElements.form.reset();
  resetCoverPreview();
}

function populateCountryDropdown() {
  const select = manualEntryElements.countrySelect;
  
  // Clear existing options except the first one
  while (select.options.length > 1) {
    select.remove(1);
  }
  
  // Add countries from the global availableCountries array
  // Remove 'window.' prefix since availableCountries is available in the global scope
  if (typeof availableCountries !== 'undefined' && availableCountries) {
    availableCountries.forEach(country => {
      const option = document.createElement('option');
      option.value = country;
      option.textContent = country;
      select.appendChild(option);
    });
  }
}

function resetCoverPreview() {
  manualEntryElements.coverPreview.innerHTML = `
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="text-gray-600">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
      <circle cx="8.5" cy="8.5" r="1.5"></circle>
      <polyline points="21 15 16 10 5 21"></polyline>
    </svg>
  `;
}

async function handleCoverArtUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  // Validate file size (5MB max)
  if (file.size > 5 * 1024 * 1024) {
    showToast('Image file size must be less than 5MB', 'error');
    e.target.value = '';
    return;
  }
  
  // Validate file type
  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file', 'error');
    e.target.value = '';
    return;
  }
  
  // Show preview
  const reader = new FileReader();
  reader.onload = function(event) {
    manualEntryElements.coverPreview.innerHTML = `
      <img src="${event.target.result}" alt="Cover preview" class="w-full h-full object-cover rounded">
    `;
  };
  reader.readAsDataURL(file);
}

async function handleManualSubmit(e) {
  e.preventDefault();
  
  const formData = new FormData(manualEntryElements.form);
  
  // Validate required fields
  const artist = formData.get('artist').trim();
  const albumTitle = formData.get('album').trim();
  
  if (!artist || !albumTitle) {
    showToast('Artist and Album title are required', 'error');
    return;
  }
  
  // Create album object
  const album = {
    artist: artist,
    album: albumTitle,
    album_id: 'manual-' + Date.now(), // Generate a unique ID for manual entries
    release_date: formData.get('release_date') || '',
    country: formData.get('country') || '',
    genre_1: '',
    genre_2: '',
    comments: ''
  };
  
  // Handle cover art if uploaded
  const coverArtFile = formData.get('cover_art');
  if (coverArtFile && coverArtFile.size > 0) {
    showToast('Processing cover art...', 'info');
    
    try {
      // Convert to base64
      const reader = new FileReader();
      
      reader.onloadend = async function() {
        const base64data = reader.result;
        album.cover_image = base64data.split(',')[1];
        album.cover_image_format = coverArtFile.type.split('/')[1].toUpperCase();
        
        // Add to list
        await finishManualAdd(album);
      };
      
      reader.onerror = function() {
        console.error('Error reading cover art');
        showToast('Error processing cover art', 'error');
      };
      
      reader.readAsDataURL(coverArtFile);
    } catch (error) {
      console.error('Error processing cover art:', error);
      showToast('Error processing cover art', 'error');
    }
  } else {
    // No cover art, add directly
    await finishManualAdd(album);
  }
}

async function finishManualAdd(album) {
  try {
    // Add to current list
    lists[currentList].push(album);
    
    // Save to server
    await saveList(currentList, lists[currentList]);
    
    // Refresh the list view
    selectList(currentList);
    
    // Close modal
    closeAddAlbumModal();
    
    showToast(`Added "${album.album}" by ${album.artist} to the list`);
  } catch (error) {
    console.error('Error adding manual album:', error);
    showToast('Error adding album to list', 'error');
    
    // Remove from list on error
    lists[currentList].pop();
  }
}

function openAddAlbumModal() {
  if (!currentList) {
    showToast('Please select a list first', 'error');
    return;
  }
  
  // Optimization 3: Warm up connections when modal opens
  warmupConnections();
  
  modal.classList.remove('hidden');
  modalElements.artistSearchInput.value = '';
  modalElements.artistSearchInput.focus();
  resetModalState();
  
  // Populate country dropdown when modal opens (countries should be loaded by now)
  populateCountryDropdown();
}

function closeAddAlbumModal() {
  if (currentLoadingController) {
    currentLoadingController.abort();
    currentLoadingController = null;
  }
  if (currentPreloadController) {
    currentPreloadController.abort();
    currentPreloadController = null;
  }
  
  // Stop background loading
  isBackgroundLoading = false;
  
  // Disconnect observer
  if (imageObserver) {
    imageObserver.disconnect();
    imageObserver = null;
  }
  
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
  
  // Reset manual entry
  if (manualEntryElements.manualEntryForm) {
    manualEntryElements.manualEntryForm.classList.add('hidden');
    if (manualEntryElements.form) {
      manualEntryElements.form.reset();
    }
    resetCoverPreview();
  }
  
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
    
    await displayArtistResults(artists);  // Add await here
  } catch (error) {
    console.error('Error searching artists:', error);
    showToast('Error searching artists', 'error');
    modalElements.searchLoading.classList.add('hidden');
    modalElements.searchEmpty.classList.remove('hidden');
  }
}

// Search Deezer for artist image
async function searchArtistImage(artistName) {
  try {
    const searchQuery = artistName.replace(/[^\w\s]/g, ' ').trim();
    const url = `${DEEZER_PROXY}?q=${encodeURIComponent(searchQuery)}`;
    
    const response = await fetch(url, {
      credentials: 'same-origin'
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    if (data.data && data.data.length > 0) {
      // Try to find the best matching artist from album results
      const artistImages = new Map();
      
      data.data.forEach(album => {
        if (album.artist && album.artist.picture_medium) {
          const artistNameLower = album.artist.name.toLowerCase();
          const searchNameLower = artistName.toLowerCase();
          
          // Prioritize exact matches
          if (artistNameLower === searchNameLower) {
            artistImages.set(album.artist.name, album.artist.picture_medium);
          } else if (artistNameLower.includes(searchNameLower) || searchNameLower.includes(artistNameLower)) {
            // Also consider partial matches
            if (!artistImages.has(album.artist.name)) {
              artistImages.set(album.artist.name, album.artist.picture_medium);
            }
          }
        }
      });
      
      // Return the first (best) match
      if (artistImages.size > 0) {
        return artistImages.values().next().value;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching artist image:', error);
    return null;
  }
}

// Display artist results with hover preloading
async function displayArtistResults(artists) {
  modalElements.artistList.innerHTML = '';
  
  for (const artist of artists) {
    const artistEl = document.createElement('div');
    artistEl.className = 'p-4 bg-gray-800 rounded hover:bg-gray-700 cursor-pointer transition-colors flex items-center gap-4';
    
    const disambiguation = artist.disambiguation ? ` <span class="text-gray-500 text-sm">(${artist.disambiguation})</span>` : '';
    
    // Resolve country code to full name
    let countryDisplay = '';
    if (artist.country) {
      const fullCountryName = await resolveCountryCode(artist.country);
      countryDisplay = ` • ${fullCountryName || artist.country}`;
    }
    
    // Create initial structure with placeholder
    artistEl.innerHTML = `
      <div class="artist-image-container flex-shrink-0">
        <div class="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-600">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
        </div>
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-medium text-white">${artist.name}${disambiguation}</div>
        <div class="text-sm text-gray-400 mt-1">${artist.type || 'Artist'}${countryDisplay}</div>
      </div>
    `;
    
    // Fetch artist image asynchronously
    searchArtistImage(artist.name).then(imageUrl => {
      if (imageUrl) {
        const imageContainer = artistEl.querySelector('.artist-image-container');
        imageContainer.innerHTML = `
          <img 
            src="${imageUrl}" 
            alt="${artist.name}" 
            class="w-16 h-16 rounded-full object-cover"
            onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center\\'><svg width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\' class=\\'text-gray-600\\'><path d=\\'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2\\'></path><circle cx=\\'12\\' cy=\\'7\\' r=\\'4\\'></circle></svg></div>'"
          >
        `;
      }
    });
    
    // Optimization 1: Preload on hover
    let preloadTimeout;
    artistEl.addEventListener('mouseenter', () => {
      preloadTimeout = setTimeout(() => {
        preloadArtistAlbums(artist);
      }, 300); // 300ms delay to avoid loading on quick mouse movements
    });
    
    artistEl.addEventListener('mouseleave', () => {
      clearTimeout(preloadTimeout);
    });
    
    artistEl.onclick = () => selectArtist(artist);
    modalElements.artistList.appendChild(artistEl);
  }
  
  showArtistResults();
}

async function selectArtist(artist) {
  currentArtist = artist;
  showLoading();
  
  currentLoadingController = new AbortController();
  
  try {
    // Check if we have preloaded data
    let releaseGroups = preloadCache.get(artist.id);
    
    if (!releaseGroups) {
      releaseGroups = await getArtistReleaseGroups(artist.id);
    }
    
    if (releaseGroups.length === 0) {
      showToast('No pure albums or EPs found for this artist', 'error');
      showAlbumResults();
      modalElements.albumList.innerHTML = '<p class="col-span-full text-center text-gray-500">No standard albums or EPs found.</p>';
      return;
    }
    
    displayAlbumResultsWithLazyLoading(releaseGroups);
    
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('Album loading cancelled');
      return;
    }
    console.error('Error fetching albums:', error);
    showToast('Error fetching albums', 'error');
    showArtistResults();
  }
}
async function resolveCountryCode(countryCode) {
  if (!countryCode || countryCode.length !== 2) {
    return '';
  }
  
  try {
    // Use RestCountries API to get country info
    const response = await fetch(`https://restcountries.com/v3.1/alpha/${countryCode}`);
    
    if (!response.ok) {
      console.warn(`Country code ${countryCode} not found`);
      return '';
    }
    
    const data = await response.json();
    if (!data || !data[0]) {
      return '';
    }
    
    const countryData = data[0];
    
    // Try different name variations to match against our countries list
    const namesToTry = [
      countryData.name.common,
      countryData.name.official,
      // Also check alternative names
      ...(countryData.altSpellings || [])
    ];
    
    // Special cases for common variations
    if (countryCode === 'US') {
      namesToTry.push('United States');
    } else if (countryCode === 'GB') {
      namesToTry.push('United Kingdom');
    } else if (countryCode === 'KR') {
      namesToTry.push('Korea, South');
    } else if (countryCode === 'KP') {
      namesToTry.push('Korea, North');
    }
    
    // Find the first name that matches our countries list
    for (const name of namesToTry) {
      if (name && availableCountries.includes(name)) {
        return name;
      }
    }
    
    // If no exact match, try case-insensitive partial matching
    const commonName = countryData.name.common.toLowerCase();
    const closeMatch = availableCountries.find(country => {
      const countryLower = country.toLowerCase();
      return countryLower === commonName || 
             countryLower.includes(commonName) || 
             commonName.includes(countryLower);
    });
    
    if (closeMatch) {
      return closeMatch;
    }
    
    console.warn(`Country "${countryData.name.common}" (${countryCode}) not found in allowed countries list`);
    return '';
    
  } catch (error) {
    console.error('Error resolving country code:', error);
    return '';
  }
}

function displayAlbumResultsWithLazyLoading(releaseGroups) {
  showAlbumResults();
  modalElements.albumList.innerHTML = '';
  
  // Change the albumList class from grid to vertical list
  modalElements.albumList.className = 'space-y-2';
  
  // Reset background loading state
  isBackgroundLoading = false;
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
  
  // Set up intersection observer
  const observer = setupIntersectionObserver(releaseGroups, currentArtist.name);
  
  releaseGroups.forEach((rg, index) => {
    const albumEl = document.createElement('div');
    albumEl.className = 'p-4 bg-gray-800 rounded hover:bg-gray-700 cursor-pointer transition-colors flex items-center gap-4 relative';
    albumEl.dataset.albumIndex = index;
    
    const releaseDate = formatReleaseDate(rg['first-release-date']);
    const albumType = rg['primary-type'];
    const isNewRelease = rg['first-release-date'] && rg['first-release-date'] >= thirtyDaysAgoStr;
    
    albumEl.innerHTML = `
      ${isNewRelease ? `
        <div class="absolute top-2 right-2 bg-red-600 text-white text-xs px-2 py-1 rounded z-10 font-semibold">
          NEW
        </div>
      ` : ''}
      <div class="album-cover-container flex-shrink-0 w-16 h-16 rounded-full overflow-hidden flex items-center justify-center">
        <div class="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center animate-pulse">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="text-gray-600">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
        </div>
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-medium text-white truncate" title="${rg.title}">${rg.title}</div>
        <div class="text-sm text-gray-400 mt-1">${releaseDate} • ${albumType}</div>
      </div>
    `;
    
    albumEl.onclick = () => addAlbumToList(rg);
    modalElements.albumList.appendChild(albumEl);
    
    // Start observing this element for lazy loading
    observer.observe(albumEl);
  });
  
  // Also immediately check for visible albums
  requestAnimationFrame(() => {
    const visibleAlbums = Array.from(modalElements.albumList.querySelectorAll('[data-album-index]'))
      .filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0;
      });
    
    // Trigger intersection observer for visible albums
    visibleAlbums.forEach(el => {
      if (observer) {
        observer.unobserve(el);
        observer.observe(el);
      }
    });
  });
}

async function addAlbumToList(releaseGroup) {
  // Show initial loading message
  showToast('Adding album...', 'info');
  
  // Resolve the country code to full name
  const resolvedCountry = await resolveCountryCode(currentArtist.country);
  
  const album = {
      artist: currentArtist.name,
      album: releaseGroup.title,
      album_id: releaseGroup.id,
      release_date: releaseGroup['first-release-date'] || '',
      country: resolvedCountry,
      genre_1: '',
      genre_2: '',
      comments: ''
  };
  
  // Continue with cover art fetching...
  if (releaseGroup.coverArt) {
    try {
      const response = await fetch(releaseGroup.coverArt);
      const blob = await response.blob();
      
      if (!blob.type.startsWith('image/')) {
        throw new Error('Invalid image type');
      }
      
      const reader = new FileReader();
      
      reader.onloadend = function() {
        const base64data = reader.result;
        album.cover_image = base64data.split(',')[1];
        album.cover_image_format = blob.type.split('/')[1].toUpperCase();
        
        addAlbumToCurrentList(album);
      };
      
      reader.onerror = function() {
        console.error('Error reading cover art');
        addAlbumToCurrentList(album);
      };
      
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('Error fetching cover art:', error);
      addAlbumToCurrentList(album);
    }
  } else {
    addAlbumToCurrentList(album);
  }
}

async function addAlbumToCurrentList(album) {
  try {
    lists[currentList].push(album);
    
    await saveList(currentList, lists[currentList]);
    
    selectList(currentList);
    
    closeAddAlbumModal();
    
    showToast(`Added "${album.album}" by ${album.artist} to the list`);
  } catch (error) {
    console.error('Error adding album:', error);
    showToast('Error adding album to list', 'error');
    
    lists[currentList].pop();
  }
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initializeAddAlbumFeature, 100);
});