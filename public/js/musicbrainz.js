// MusicBrainz API integration
const MUSICBRAINZ_API = 'https://musicbrainz.org/ws/2';
const COVERART_API = 'https://coverartarchive.org';
const ITUNES_API = 'https://itunes.apple.com';
const DEEZER_PROXY = '/api/proxy/deezer'; // Using our proxy
const USER_AGENT = 'KVLT Album Manager/1.0 (https://kvlt.example.com)';

// Rate limiting - MusicBrainz requires max 1 request per second
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1100; // 1.1 seconds to be safe


let searchMode = 'artist';

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
  // Request aliases in the inc parameter
  const url = `${MUSICBRAINZ_API}/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=10&inc=aliases`;
  const data = await rateLimitedFetch(url);
  return data.artists || [];
}

// Add this function to sort and prioritize search results
function prioritizeSearchResults(artists, searchQuery) {
  const query = searchQuery.toLowerCase();
  
  return artists.map(artist => {
    let score = 0;
    const displayName = formatArtistDisplayName(artist);
    
    // High priority: Exact name match in Latin
    if (artist.name.toLowerCase() === query) {
      score += 100;
    }
    
    // High priority: Latin script name
    if (!hasNonLatinCharacters(artist.name)) {
      score += 50;
    }
    
    // Medium priority: Has Latin transliteration
    if (displayName.primary !== displayName.original && !displayName.warning) {
      score += 30;
    }
    
    // Medium priority: Name contains search query
    if (artist.name.toLowerCase().includes(query)) {
      score += 20;
    }
    
    // Low priority: Disambiguation contains query
    if (artist.disambiguation && artist.disambiguation.toLowerCase().includes(query)) {
      score += 10;
    }
    
    return { ...artist, _searchScore: score };
  })
  .sort((a, b) => b._searchScore - a._searchScore);
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

// Fetch track list for a release group using server-side proxy
async function getTracksForReleaseGroup(releaseGroupId) {
  try {
    const resp = await fetch(`/api/musicbrainz/tracks/${releaseGroupId}`);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const tracks = data.tracks || [];
    return tracks.sort((a, b) => parseInt(a.number) - parseInt(b.number));
  } catch (err) {
    console.error('Error fetching track list:', err);
    return [];
  }
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
        // Store the cover URL immediately
        releaseGroups[index].coverArt = coverArt;
        
        // Then update the DOM
        const isMobile = window.innerWidth < 1024;
        coverContainer.innerHTML = `
          <img src="${coverArt}" 
              alt="${releaseGroups[index].title}" 
              class="w-16 h-16 object-cover ${isMobile ? 'rounded' : 'rounded-full'}" 
              loading="lazy" 
              crossorigin="anonymous"
              onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'w-16 h-16 bg-gray-700 ${isMobile ? 'rounded' : 'rounded-full'} flex items-center justify-center animate-pulse\\'><svg width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1\\' class=\\'text-gray-600\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\' ry=\\'2\\'></rect><circle cx=\\'8.5\\' cy=\\'8.5\\' r=\\'1.5\\'></circle><polyline points=\\'21 15 16 10 5 21\\'></polyline></svg></div>'; delete window.currentReleaseGroups[${index}].coverArt;">
        `;
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


async function performSearch() {
  const query = modalElements.artistSearchInput.value.trim();
  if (!query) {
    showToast(`Please enter ${searchMode === 'artist' ? 'an artist' : 'an album'} name`, 'error');
    return;
  }
  
  showLoading();
  
  try {
    if (searchMode === 'artist') {
      const artists = await searchArtists(query);
      
      if (artists.length === 0) {
        modalElements.searchLoading.classList.add('hidden');
        modalElements.searchEmpty.classList.remove('hidden');
        modalElements.searchEmpty.innerHTML = '<p>No artists found. Try a different search.</p>';
        return;
      }
      
      // Prioritize results to show Latin-script and better matches first
      const prioritizedArtists = prioritizeSearchResults(artists, query);
      await displayArtistResults(prioritizedArtists);
    } else {
      // Album search mode
      const albums = await searchAlbums(query);
      
      if (albums.length === 0) {
        modalElements.searchLoading.classList.add('hidden');
        modalElements.searchEmpty.classList.remove('hidden');
        modalElements.searchEmpty.innerHTML = '<p>No albums found. Try a different search.</p>';
        return;
      }
      
      await displayDirectAlbumResults(albums);
    }
  } catch (error) {
    console.error(`Error searching ${searchMode}s:`, error);
    showToast(`Error searching ${searchMode}s`, 'error');
    modalElements.searchLoading.classList.add('hidden');
    modalElements.searchEmpty.classList.remove('hidden');
  }
}

async function displayDirectAlbumResults(releaseGroups) {
  showAlbumResults();
  modalElements.albumList.innerHTML = '';
  
  // Hide the back button since we're not coming from artist selection
  if (modalElements.backToArtists) {
    modalElements.backToArtists.style.display = 'none';
  }
  
  // Store releaseGroups globally
  window.currentReleaseGroups = releaseGroups;
  
  modalElements.albumList.className = 'space-y-3';
  
  isBackgroundLoading = false;
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
  
  for (const rg of releaseGroups) {
    const albumEl = document.createElement('div');
    albumEl.dataset.albumIndex = releaseGroups.indexOf(rg);
    albumEl.dataset.albumId = rg.id;
    
    // Get artist credits for this release group
    const artistCredits = rg['artist-credit'] || [];
    const artistNames = artistCredits.map(credit => credit.name || credit.artist?.name || 'Unknown Artist');
    const artistDisplay = artistNames.join(', ');
    
    const releaseDate = formatReleaseDate(rg['first-release-date']);
    const albumType = rg['primary-type'];
    const isNewRelease = rg['first-release-date'] && rg['first-release-date'] >= thirtyDaysAgoStr;
    
    albumEl.className = 'p-4 bg-gray-800 rounded-lg hover:bg-gray-700 cursor-pointer transition-all hover:shadow-lg flex items-center gap-4 relative';
    
    albumEl.innerHTML = `
      ${isNewRelease ? `
        <div class="absolute top-2 right-2 bg-red-600 text-white text-xs px-2 py-1 rounded z-10 font-semibold">
          NEW
        </div>
      ` : ''}
      <div class="album-cover-container flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden flex items-center justify-center shadow-md">
        <div class="w-20 h-20 bg-gray-700 rounded-lg flex items-center justify-center animate-pulse">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="text-gray-600">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
        </div>
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-semibold text-white truncate text-lg" title="${rg.title}">${rg.title}</div>
        <div class="text-sm text-gray-400 mt-1">${releaseDate} • ${albumType}</div>
        <div class="text-xs text-gray-500 mt-1">${artistDisplay}</div>
      </div>
    `;
    
    // Store artist info for album addition
    rg._artistDisplay = artistDisplay;
    rg._artistCredit = artistCredits[0]; // Use first artist for metadata
    
    // Click handler
    albumEl.onclick = async () => {
      const coverContainer = albumEl.querySelector('.album-cover-container');
      coverContainer.innerHTML = `
        <div class="w-20 h-20 bg-gray-700 rounded-lg flex items-center justify-center">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      `;

      const primaryArtist = artistCredits[0];
      const combinedCountries = await getCombinedArtistCountries(artistCredits);

      currentArtist = {
        name: artistDisplay,
        id: primaryArtist?.artist?.id || null,
        country: combinedCountries
      };
      
      // Load cover art if not already loaded
      if (!rg.coverArt) {
        try {
          const coverArt = await getCoverArt(rg.id, currentArtist.name, rg.title);
          if (coverArt) {
            rg.coverArt = coverArt;
          }
        } catch (error) {
          console.error('Error loading cover before add:', error);
        }
      }
      
      addAlbumToList(rg);
    };
    
    modalElements.albumList.appendChild(albumEl);
    
    // Start lazy loading covers
    requestAnimationFrame(() => {
      getCoverArt(rg.id, artistDisplay, rg.title).then(coverArt => {
        if (coverArt && !currentLoadingController?.signal.aborted) {
          rg.coverArt = coverArt;
          const coverContainer = albumEl.querySelector('.album-cover-container');
          if (coverContainer) {
            coverContainer.innerHTML = `
              <img src="${coverArt}" 
                  alt="${rg.title}" 
                  class="w-20 h-20 object-cover rounded-lg" 
                  loading="lazy" 
                  crossorigin="anonymous"
                  onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'w-20 h-20 bg-gray-700 rounded-lg flex items-center justify-center\\'>\\
                    <svg width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1\\' class=\\'text-gray-600\\'>\\
                      <rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\' ry=\\'2\\'></rect>\\
                      <circle cx=\\'8.5\\' cy=\\'8.5\\' r=\\'1.5\\'></circle>\\
                      <polyline points=\\'21 15 16 10 5 21\\'></polyline>\\
                    </svg>\\
                  </div>';">
            `;
          }
        }
      });
    });
  }
}

// Initialize modal
function initializeAddAlbumFeature() {
  modal = document.getElementById('addAlbumModal');
  
  if (!modal) {
    console.error('Add album modal not found');
    return;
  }
  
  // Single set of modal elements - no more mobile/desktop separation
  modalElements = {
    artistSearchInput: document.getElementById('artistSearchInput'),
    searchArtistBtn: document.getElementById('searchArtistBtn'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    closeModalBtnDesktop: document.getElementById('closeModalBtnDesktop'),
    artistResults: document.getElementById('artistResults'),
    albumResults: document.getElementById('albumResults'),
    artistList: document.getElementById('artistList'),
    albumList: document.getElementById('albumList'),
    searchLoading: document.getElementById('searchLoading'),
    searchEmpty: document.getElementById('searchEmpty'),
    backToArtists: document.getElementById('backToArtists'),
    searchSection: document.getElementById('searchSection'),
    manualEntryBtn: document.getElementById('manualEntryBtn'),
    manualEntryForm: document.getElementById('manualEntryForm'),
    backToSearch: document.getElementById('backToSearch'),
    form: document.getElementById('manualAlbumForm'),
    coverArtInput: document.getElementById('manualCoverArt'),
    coverPreview: document.getElementById('coverPreview'),
    countrySelect: document.getElementById('manualCountry'),
    cancelBtn: document.getElementById('cancelManualEntry')
  };
  
  // Check if all essential elements exist
  const essentialElements = ['closeModalBtn', 'searchArtistBtn', 'artistSearchInput'];
  const missingElements = essentialElements.filter(el => !modalElements[el] && el !== 'closeModalBtnDesktop');
  
  if (missingElements.length > 0) {
    console.error('Missing essential modal elements:', missingElements);
    return;
  }
  
  // Unified close button handler (works for both mobile back arrow and desktop X)
  const setupCloseHandlers = () => {
    if (modalElements.closeModalBtn) {
      modalElements.closeModalBtn.onclick = closeAddAlbumModal;
    }
    if (modalElements.closeModalBtnDesktop) {
      modalElements.closeModalBtnDesktop.onclick = closeAddAlbumModal;
    }
  };
  setupCloseHandlers();
  
  // Modal backdrop click handler - only on desktop
  modal.onclick = (e) => {
    if (e.target === modal && window.innerWidth >= 1024) {
      closeAddAlbumModal();
    }
  };
  
  // Search functionality - same for both mobile and desktop
  modalElements.searchArtistBtn.onclick = performSearch;
  modalElements.artistSearchInput.onkeypress = (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  };
  
  // Back to artists button
  if (modalElements.backToArtists) {
    modalElements.backToArtists.onclick = () => {
      if (currentLoadingController) {
        currentLoadingController.abort();
        currentLoadingController = null;
      }
      showArtistResults();
      modalElements.albumResults.classList.add('hidden');
    };
  }
  
  // Manual entry handlers - unified
  if (modalElements.manualEntryBtn) {
    modalElements.manualEntryBtn.onclick = showManualEntryForm;
  }
  
  if (modalElements.backToSearch) {
    modalElements.backToSearch.onclick = hideManualEntryForm;
  }
  
  if (modalElements.cancelBtn) {
    modalElements.cancelBtn.onclick = hideManualEntryForm;
  }
  
  if (modalElements.form) {
    modalElements.form.onsubmit = handleManualSubmit;
  }
  
  if (modalElements.coverArtInput) {
    modalElements.coverArtInput.onchange = handleCoverArtUpload;
  }
  
  // Initialize search mode toggle - unified buttons
  const searchModeButtons = document.querySelectorAll('.search-mode-btn');
  searchModeButtons.forEach(btn => {
    btn.onclick = () => updateSearchMode(btn.dataset.mode);
  });
  
  // Populate country dropdown
  populateCountryDropdown();
  
  // ESC key to close (desktop only)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden') && window.innerWidth >= 1024) {
      closeAddAlbumModal();
    }
  });
  
  // Handle window resize to ensure proper modal behavior
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      // Re-setup handlers if needed after resize
      if (!modal.classList.contains('hidden')) {
        // Ensure proper modal styling based on new viewport
        const isMobile = window.innerWidth < 1024;
        modal.style.overflow = isMobile ? 'hidden' : '';
      }
    }, 250);
  });
}

// Update the search mode function to be unified
function updateSearchMode(mode) {
  searchMode = mode;
  
  // Update all search mode buttons (both mobile and desktop use same class)
  document.querySelectorAll('.search-mode-btn').forEach(btn => {
    const isActive = btn.dataset.mode === mode;
    btn.classList.toggle('active', isActive);
    btn.classList.toggle('bg-gray-700', isActive);
    btn.classList.toggle('text-white', isActive);
    btn.classList.toggle('text-gray-400', !isActive);
  });
  
  // Update search placeholder
  const placeholder = mode === 'artist' 
    ? 'Search for an artist...' 
    : 'Search for an album...';
  
  if (modalElements.artistSearchInput) {
    modalElements.artistSearchInput.placeholder = placeholder;
  }
  
  // Update search button text - responsive based on viewport
  const buttonText = mode === 'artist' ? 'Search Artists' : 'Search Albums';
  const isMobile = window.innerWidth < 1024;
  
  if (modalElements.searchArtistBtn) {
    modalElements.searchArtistBtn.innerHTML = isMobile 
      ? `<i class="fas fa-search mr-2"></i>Search`
      : `<i class="fas fa-search mr-2"></i>${buttonText}`;
  }
  
  // Clear previous results
  clearSearchResults();
}

// Unified function to clear search results
function clearSearchResults() {
  modalElements.artistResults.classList.add('hidden');
  modalElements.albumResults.classList.add('hidden');
  modalElements.searchLoading.classList.add('hidden');
  modalElements.searchEmpty.classList.remove('hidden');
  modalElements.artistList.innerHTML = '';
  modalElements.albumList.innerHTML = '';
}

// Unified manual entry form functions

// Unified open modal function
window.openAddAlbumModal = function() {
  if (!currentList) {
    showToast('Please select a list first', 'error');
    return;
  }
  
  // Warm up connections
  warmupConnections();
  
  modal.classList.remove('hidden');
  
  // Reset search mode to artist when opening the modal
  searchMode = 'artist';
  updateSearchMode('artist');
  
  // Focus the search input
  if (modalElements.artistSearchInput) {
    modalElements.artistSearchInput.value = '';
    setTimeout(() => modalElements.artistSearchInput.focus(), 100);
  }
  
  resetModalState();
  
  // Populate country dropdown when modal opens
  populateCountryDropdown();
  
  // Handle body scroll for mobile
  if (window.innerWidth < 1024) {
    document.body.style.overflow = 'hidden';
  }
};

// Unified close modal function

// Unified display functions that handle both mobile and desktop layouts


// New functions for manual entry
function showManualEntryForm() {
  // Hide all other views
  modalElements.artistResults.classList.add('hidden');
  modalElements.albumResults.classList.add('hidden');
  modalElements.searchLoading.classList.add('hidden');
  modalElements.searchEmpty.classList.add('hidden');
  
  // Hide the search section
  const searchSection = document.getElementById('searchSection');
  if (searchSection) {
    searchSection.classList.add('hidden');
  }
  
  // Show manual entry form
  modalElements.manualEntryForm.classList.remove('hidden');
  
  // Reset form
  modalElements.form.reset();
  resetCoverPreview();
  
  // Populate country dropdown (in case it wasn't populated yet)
  populateCountryDropdown();
}

function hideManualEntryForm() {
  modalElements.manualEntryForm.classList.add('hidden');
  modalElements.searchEmpty.classList.remove('hidden');
  
  // Show the search section again
  const searchSection = document.getElementById('searchSection');
  if (searchSection) {
    searchSection.classList.remove('hidden');
  }
  
  // Reset form
  modalElements.form.reset();
  resetCoverPreview();
}

function populateCountryDropdown() {
  const select = modalElements.countrySelect;
  
  if (!select) return;
  
  // Clear existing options except the first one
  while (select.options.length > 1) {
    select.remove(1);
  }
  
  // Add countries from the global availableCountries array
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
  const defaultContent = window.innerWidth < 1024 
    ? '<i class="fas fa-image text-2xl text-gray-600"></i>'
    : `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="text-gray-600">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <circle cx="8.5" cy="8.5" r="1.5"></circle>
        <polyline points="21 15 16 10 5 21"></polyline>
      </svg>`;
  
  modalElements.coverPreview.innerHTML = defaultContent;
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
    modalElements.coverPreview.innerHTML = `
      <img src="${event.target.result}" alt="Cover preview" class="w-full h-full object-cover rounded">
    `;
  };
  reader.readAsDataURL(file);
}

async function handleManualSubmit(e) {
  e.preventDefault();
  
  const formData = new FormData(modalElements.form);
  
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
  
  // Restore body scroll on mobile
  if (window.innerWidth < 1024) {
    document.body.style.overflow = '';
  }
}

function resetModalState() {
  modalElements.artistResults.classList.add('hidden');
  modalElements.albumResults.classList.add('hidden');
  modalElements.searchLoading.classList.add('hidden');
  modalElements.searchEmpty.classList.remove('hidden');
  modalElements.artistList.innerHTML = '';
  modalElements.albumList.innerHTML = '';
  
  // Don't reset search mode here - it should maintain its current state
  // Only reset to artist when opening the modal fresh
  
  // Update button states to match current search mode
  document.querySelectorAll('.search-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === searchMode);
    btn.classList.toggle('bg-gray-700', btn.dataset.mode === searchMode);
    btn.classList.toggle('text-white', btn.dataset.mode === searchMode);
    btn.classList.toggle('text-gray-400', btn.dataset.mode !== searchMode);
  });
  
  // Update placeholder to match current mode
  const placeholder = searchMode === 'artist' 
    ? 'Search for an artist...' 
    : 'Search for an album...';
  
  if (modalElements.artistSearchInput) {
    modalElements.artistSearchInput.placeholder = placeholder;
  }
  
  // Show the search section
  const searchSection = document.getElementById('searchSection');
  if (searchSection) {
    searchSection.classList.remove('hidden');
  }
  
  // Reset manual entry
  if (modalElements.manualEntryForm) {
    modalElements.manualEntryForm.classList.add('hidden');
    if (modalElements.form) {
      modalElements.form.reset();
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
  
  // Desktop now uses the same list-style layout as mobile
  modalElements.artistList.className = 'space-y-3';
  
  for (const artist of artists) {
    const artistEl = document.createElement('div');
    artistEl.className = 'p-4 bg-gray-800 rounded-lg hover:bg-gray-700 cursor-pointer transition-colors flex items-center gap-4';
    
    // Format the artist name intelligently
    const displayName = formatArtistDisplayName(artist);
    
    // Build disambiguation/secondary text
    let secondaryText = '';
    if (displayName.secondary) {
      secondaryText = displayName.secondary;
    }
    
    // Add any additional disambiguation that's not already shown
    if (artist.disambiguation && 
        artist.disambiguation !== displayName.secondary && 
        artist.disambiguation !== displayName.primary) {
      secondaryText += secondaryText ? ` • ${artist.disambiguation}` : artist.disambiguation;
    }
    
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
        <div class="font-medium text-white">
          ${displayName.primary}
          ${displayName.warning ? '<i class="fas fa-exclamation-triangle text-yellow-500 text-xs ml-2" title="Non-Latin script - no Latin version found"></i>' : ''}
        </div>
        ${secondaryText ? `<div class="text-sm text-gray-400 mt-1">${secondaryText}</div>` : ''}
        <div class="text-sm text-gray-400 mt-1">${artist.type || 'Artist'}${countryDisplay}</div>
      </div>
      <div class="flex-shrink-0">
        <i class="fas fa-chevron-right text-gray-500"></i>
      </div>
    `;
    
    // Store the original artist data with enhanced display info
    const enhancedArtist = {
      ...artist,
      _displayName: displayName
    };
    
    // Fetch artist image asynchronously (using the Latin name if available for better results)
    const searchName = displayName.original && !displayName.warning ? displayName.primary : artist.name;
    searchArtistImage(searchName).then(imageUrl => {
      if (imageUrl) {
        const imageContainer = artistEl.querySelector('.artist-image-container');
        imageContainer.innerHTML = `
          <img 
            src="${imageUrl}" 
            alt="${displayName.primary}" 
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
      }, 300);
    });
    
    artistEl.addEventListener('mouseleave', () => {
      clearTimeout(preloadTimeout);
    });
    
    artistEl.onclick = () => selectArtist(enhancedArtist);
    modalElements.artistList.appendChild(artistEl);
  }
  
  showArtistResults();
}

async function selectArtist(artist) {
  // Use the enhanced artist with display name
  currentArtist = artist._displayName ? {
    ...artist,
    name: artist._displayName.primary, // Use the Latin name for album displays
    originalName: artist.name // Keep the original for API calls
  } : artist;
  
  showLoading();
  
  currentLoadingController = new AbortController();
  
  try {
    // Use original ID for API calls
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

// Get combined country names for multiple artists
async function getCombinedArtistCountries(artistCredits) {
  const countries = [];

  for (const credit of artistCredits) {
    const id = credit.artist?.id;
    if (!id) continue;

    try {
      const artistData = await rateLimitedFetch(`${MUSICBRAINZ_API}/artist/${id}?fmt=json`);
      if (artistData && artistData.country) {
        const name = await resolveCountryCode(artistData.country);
        if (name && !countries.includes(name)) {
          countries.push(name);
        }
      }
    } catch (err) {
      console.error('Error fetching artist country:', err);
    }
  }

  return countries.join(' / ');
}

async function searchAlbums(query) {
  const url = `${MUSICBRAINZ_API}/release-group/?query=${encodeURIComponent(query)}&type=album|ep&fmt=json&limit=20`;
  const data = await rateLimitedFetch(url);
  
  let releaseGroups = data['release-groups'] || [];
  
  // Filter and sort similar to getArtistReleaseGroups
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  
  releaseGroups = releaseGroups.filter(rg => {
    const primaryType = rg['primary-type'];
    const secondaryTypes = rg['secondary-types'] || [];
    const releaseDate = rg['first-release-date'];
    
    const isValidType = (primaryType === 'Album' || primaryType === 'EP') && secondaryTypes.length === 0;
    
    if (!releaseDate) return false;
    
    let comparableDate = releaseDate;
    if (releaseDate.length === 4) {
      comparableDate = `${releaseDate}-12-31`;
    } else if (releaseDate.length === 7) {
      const [year, month] = releaseDate.split('-');
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      comparableDate = `${releaseDate}-${lastDay.toString().padStart(2, '0')}`;
    }
    
    return isValidType && comparableDate <= todayStr;
  });
  
  // Sort by relevance (MusicBrainz already does this) and then by date
  releaseGroups.sort((a, b) => {
    const dateA = a['first-release-date'] || '0000';
    const dateB = b['first-release-date'] || '0000';
    return dateB.localeCompare(dateA);
  });
  
  return releaseGroups;
}

function displayAlbumResultsWithLazyLoading(releaseGroups) {
  showAlbumResults();
  modalElements.albumList.innerHTML = '';
  
  // Store releaseGroups globally for access in addAlbumToList
  window.currentReleaseGroups = releaseGroups;
  
  // Desktop now uses the same list-style layout as mobile
  modalElements.albumList.className = 'space-y-3'; // Changed from grid to vertical list
  
  // Reset background loading state
  isBackgroundLoading = false;
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
  
  // Set up intersection observer
  const observer = setupIntersectionObserver(releaseGroups, currentArtist.name);
  
  releaseGroups.forEach((rg, index) => {
    const albumEl = document.createElement('div');
    albumEl.dataset.albumIndex = index;
    albumEl.dataset.albumId = rg.id;
    
    const releaseDate = formatReleaseDate(rg['first-release-date']);
    const albumType = rg['primary-type'];
    const isNewRelease = rg['first-release-date'] && rg['first-release-date'] >= thirtyDaysAgoStr;
    
    // Use horizontal card layout like mobile
    albumEl.className = 'p-4 bg-gray-800 rounded-lg hover:bg-gray-700 cursor-pointer transition-all hover:shadow-lg flex items-center gap-4 relative';
    
    albumEl.innerHTML = `
      ${isNewRelease ? `
        <div class="absolute top-2 right-2 bg-red-600 text-white text-xs px-2 py-1 rounded z-10 font-semibold">
          NEW
        </div>
      ` : ''}
      <div class="album-cover-container flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden flex items-center justify-center shadow-md">
        <div class="w-20 h-20 bg-gray-700 rounded-lg flex items-center justify-center animate-pulse">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="text-gray-600">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
        </div>
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-semibold text-white truncate text-lg" title="${rg.title}">${rg.title}</div>
        <div class="text-sm text-gray-400 mt-1">${releaseDate} • ${albumType}</div>
        <div class="text-xs text-gray-500 mt-1">${currentArtist.name}</div>
      </div>
    `;
    
    // Click handler
    albumEl.onclick = async () => {
      // Show loading state
      const coverContainer = albumEl.querySelector('.album-cover-container');
      coverContainer.innerHTML = `
        <div class="w-20 h-20 bg-gray-700 rounded-lg flex items-center justify-center">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      `;
      
      // Check if cover is already loaded in DOM but not in data
      const imgEl = albumEl.querySelector('.album-cover-container img');
      if (imgEl && imgEl.src && !imgEl.src.includes('data:image/svg') && !rg.coverArt) {
        rg.coverArt = imgEl.src;
      }
      
      // If still no cover, try to load it before adding
      if (!rg.coverArt) {
        try {
          const coverArt = await getCoverArt(rg.id, currentArtist.name, rg.title);
          if (coverArt) {
            rg.coverArt = coverArt;
          }
        } catch (error) {
          console.error('Error loading cover before add:', error);
        }
      }
      
      addAlbumToList(rg);
    };
    
    modalElements.albumList.appendChild(albumEl);
    
    // Start observing this element for lazy loading
    observer.observe(albumEl);
  });
  
  // Store reference to current release groups
  window.currentReleaseGroups = releaseGroups;
  
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
  
  let resolvedCountry = '';
  if (currentArtist.country) {
    if (currentArtist.country.length === 2) {
      resolvedCountry = await resolveCountryCode(currentArtist.country);
    } else {
      resolvedCountry = currentArtist.country;
    }
  }

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

  // Fetch track list
  album.tracks = await getTracksForReleaseGroup(releaseGroup.id);
  album.play_track = null;
  
  // Enhanced cover art retrieval
  let coverArtUrl = releaseGroup.coverArt;
  
  // If not in the data structure, check if it's already loaded in the DOM
  if (!coverArtUrl) {
    // Find the album element in the list
    const albumElements = document.querySelectorAll('[data-album-index]');
    for (let el of albumElements) {
      if (parseInt(el.dataset.albumIndex) === releaseGroups.indexOf(releaseGroup)) {
        const imgEl = el.querySelector('.album-cover-container img');
        if (imgEl && imgEl.src && !imgEl.src.includes('data:image/svg')) {
          coverArtUrl = imgEl.src;
          // Store it back in the releaseGroup for consistency
          releaseGroup.coverArt = coverArtUrl;
          break;
        }
      }
    }
  }
  
  // If still no cover, try fetching it directly
  if (!coverArtUrl) {
    showToast('Fetching album cover...', 'info');
    try {
      coverArtUrl = await getCoverArt(releaseGroup.id, currentArtist.name, releaseGroup.title);
      if (coverArtUrl) {
        // Store it for future use
        releaseGroup.coverArt = coverArtUrl;
      }
    } catch (error) {
      console.error('Error fetching cover art:', error);
    }
  }
  
  // Process cover art if found
  if (coverArtUrl) {
    try {
      const response = await fetch(coverArtUrl);
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
    // No cover art available
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

function hasNonLatinCharacters(str) {
  if (!str) return false;
  // Check if more than 50% of alphabetic characters are non-Latin
  const alphaChars = str.match(/\p{L}/gu) || [];
  const nonLatinChars = str.match(/[^\u0000-\u024F\u1E00-\u1EFF]/gu) || [];
  return alphaChars.length > 0 && (nonLatinChars.length / alphaChars.length) > 0.5;
}

// Helper to extract Latin name from various sources
function extractLatinName(artist) {
  let latinName = null;
  
  // Strategy 1: Check if sort-name is different and contains Latin characters
  if (artist['sort-name'] && artist['sort-name'] !== artist.name) {
    if (!hasNonLatinCharacters(artist['sort-name'])) {
      // sort-name might be "Lastname, Firstname" format, so clean it up
      const sortName = artist['sort-name'];
      if (sortName.includes(',')) {
        // Reverse "Lastname, Firstname" to "Firstname Lastname"
        const parts = sortName.split(',').map(p => p.trim());
        if (parts.length === 2) {
          latinName = `${parts[1]} ${parts[0]}`;
        } else {
          latinName = sortName;
        }
      } else {
        latinName = sortName;
      }
    }
  }
  
  // Strategy 2: Check name for parentheses pattern (e.g., "מזמור (Mizmor)")
  if (!latinName && artist.name) {
    const nameParenMatch = artist.name.match(/\(([^)]+)\)/);
    if (nameParenMatch) {
      const extracted = nameParenMatch[1].trim();
      if (!hasNonLatinCharacters(extracted)) {
        latinName = extracted;
      }
    }
  }
  
  // Strategy 3: Check disambiguation for Latin version
  if (!latinName && artist.disambiguation) {
    // Sometimes the entire disambiguation is the Latin name
    if (!hasNonLatinCharacters(artist.disambiguation)) {
      // But only if it looks like a name, not a description
      const looksLikeName = !artist.disambiguation.includes(' ') || 
                           artist.disambiguation.split(' ').length <= 3;
      if (looksLikeName && !artist.disambiguation.toLowerCase().includes('group') && 
          !artist.disambiguation.toLowerCase().includes('band')) {
        latinName = artist.disambiguation;
      }
    }
  }
  
  // Strategy 4: Check aliases if available
  if (!latinName && artist.aliases && Array.isArray(artist.aliases)) {
    for (const alias of artist.aliases) {
      if (alias.name && !hasNonLatinCharacters(alias.name)) {
        // Prefer primary aliases or those marked as artist name
        if (alias.primary || alias.type === 'Artist name') {
          latinName = alias.name;
          break;
        }
      }
    }
    // If no primary alias found, use any Latin alias
    if (!latinName) {
      const latinAlias = artist.aliases.find(a => a.name && !hasNonLatinCharacters(a.name));
      if (latinAlias) {
        latinName = latinAlias.name;
      }
    }
  }
  
  return latinName;
}

// Helper to format artist display name
function formatArtistDisplayName(artist) {
  const hasNonLatin = hasNonLatinCharacters(artist.name);
  
  if (!hasNonLatin) {
    // Name is already in Latin script
    return {
      primary: artist.name,
      secondary: artist.disambiguation || null,
      original: artist.name
    };
  }
  
  // Try to extract Latin version using multiple strategies
  const latinName = extractLatinName(artist);
  
  if (latinName) {
    // Show Latin name as primary, original as secondary
    return {
      primary: latinName,
      secondary: artist.name,
      original: artist.name
    };
  } else {
    // No Latin version found, show as-is with warning
    return {
      primary: artist.name,
      secondary: 'Non-Latin script',
      original: artist.name,
      warning: true
    };
  }
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
  initializeAddAlbumFeature();
});