
const MUSICBRAINZ_PROXY = '/api/proxy/musicbrainz'; 
const WIKIDATA_PROXY = '/api/proxy/wikidata'; 
const DEEZER_PROXY = '/api/proxy/deezer'; 


let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 100; 

let searchMode = 'artist';


const deezerCache = new Map();


const artistImageCache = new Map();


const DEEZER_BATCH_SIZE = 15;


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

const deezerQueue = new RequestQueue(DEEZER_BATCH_SIZE);


let currentArtist = null;
let modal = null;
let modalElements = {};
let currentLoadingController = null;


const preloadCache = new Map();
let currentPreloadController = null;


function warmupConnections() {
  const cdns = [
    'https://e-cdns-images.dzcdn.net', 
  ];

  cdns.forEach((origin) => {
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



async function rateLimitedFetch(endpoint, priority = 'normal') {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
    );
  }

  lastRequestTime = Date.now();

  const url = `${MUSICBRAINZ_PROXY}?endpoint=${encodeURIComponent(endpoint)}&priority=${priority}`;
  const response = await fetch(url, {
    credentials: 'same-origin', 
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}


async function searchArtists(query) {
  
  const endpoint = `artist/?query=${encodeURIComponent(query)}&fmt=json&limit=20&inc=aliases+tags`;
  
  const data = await rateLimitedFetch(endpoint, 'high');
  return data.artists || [];
}


function prioritizeSearchResults(artists, searchQuery) {
  const query = searchQuery.toLowerCase();

  return artists
    .map((artist) => {
      let score = 0;
      const displayName = formatArtistDisplayName(artist);

      
      
      if (artist.score) {
        score += artist.score * 10;
      }

      
      if (artist.tags && Array.isArray(artist.tags)) {
        const tagBonus = Math.min(artist.tags.length * 5, 50);
        score += tagBonus;
      }

      
      

      
      if (artist.name.toLowerCase() === query) {
        score += 100;
      }

      
      if (!hasNonLatinCharacters(artist.name)) {
        score += 50;
      }

      
      if (
        displayName.primary !== displayName.original &&
        !displayName.warning
      ) {
        score += 30;
      }

      
      if (artist.name.toLowerCase().includes(query)) {
        score += 20;
      }

      
      if (
        artist.disambiguation &&
        artist.disambiguation.toLowerCase().includes(query)
      ) {
        score += 10;
      }

      const result = { ...artist, _searchScore: score };

      console.debug(
        `Artist: "${artist.name}"${artist.disambiguation ? ` (${artist.disambiguation})` : ''} - Score: ${score.toFixed(0)} (MB: ${artist.score || 0}, Tags: ${artist.tags?.length || 0})`
      );

      return result;
    })
    .sort((a, b) => b._searchScore - a._searchScore);
}


async function getArtistReleaseGroups(artistId) {
  const endpoint = `release-group?artist=${artistId}&type=album|ep&fmt=json&limit=100`;
  
  const data = await rateLimitedFetch(endpoint, 'high');

  let releaseGroups = data['release-groups'] || [];

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  releaseGroups = releaseGroups.filter((rg) => {
    const primaryType = rg['primary-type'];
    const secondaryTypes = rg['secondary-types'] || [];
    const releaseDate = rg['first-release-date'];

    const isValidType =
      (primaryType === 'Album' || primaryType === 'EP') &&
      secondaryTypes.length === 0;

    
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


async function searchDeezerArtwork(artistName, albumName) {
  const cacheKey = `${artistName}::${albumName}`.toLowerCase();

  if (deezerCache.has(cacheKey)) {
    return deezerCache.get(cacheKey);
  }

  return deezerQueue.add(async () => {
    try {
      const searchQuery = `${artistName} ${albumName}`
        .replace(/[^\w\s]/g, ' ')
        .trim();
      const url = `${DEEZER_PROXY}?q=${encodeURIComponent(searchQuery)}`;

      const response = await fetch(url, {
        credentials: 'same-origin', 
      });

      if (!response.ok) {
        throw new Error('Deezer proxy request failed');
      }

      const data = await response.json();

      if (data.data && data.data.length > 0) {
        const normalizedAlbumName = albumName
          .toLowerCase()
          .replace(/[^\w\s]/g, '');
        const normalizedArtistName = artistName
          .toLowerCase()
          .replace(/[^\w\s]/g, '');

        let bestMatch = data.data.find((album) => {
          const albumTitle = (album.title || '')
            .toLowerCase()
            .replace(/[^\w\s]/g, '');
          const albumArtist = (album.artist?.name || '')
            .toLowerCase()
            .replace(/[^\w\s]/g, '');
          return (
            albumTitle === normalizedAlbumName &&
            albumArtist === normalizedArtistName
          );
        });

        if (!bestMatch) {
          bestMatch = data.data.find((album) => {
            const albumTitle = (album.title || '')
              .toLowerCase()
              .replace(/[^\w\s]/g, '');
            return (
              albumTitle.includes(normalizedAlbumName) ||
              normalizedAlbumName.includes(albumTitle)
            );
          });
        }

        if (!bestMatch) {
          bestMatch = data.data[0];
        }

        if (bestMatch && bestMatch.cover_xl) {
          deezerCache.set(cacheKey, bestMatch.cover_xl);
          return bestMatch.cover_xl;
        }
      }

      deezerCache.set(cacheKey, null);
      return null;
    } catch (_error) {
      deezerCache.set(cacheKey, null);
      return null;
    }
  });
}


async function getCoverArt(releaseGroupId, artistName, albumTitle) {
  if (!artistName || !albumTitle) {
    console.warn(
      `Missing artist or album name for "${releaseGroupId}" - cannot fetch cover art`
    );
    return null;
  }

  try {
    const coverUrl = await searchDeezerArtwork(artistName, albumTitle);
    if (!coverUrl) {
      console.warn(
        `No cover art found for "${albumTitle}" by ${artistName} - album will use placeholder`
      );
    }
    return coverUrl;
  } catch (error) {
    console.error(`Error fetching cover art for "${albumTitle}":`, error);
    return null;
  }
}


function formatReleaseDate(date) {
  if (!date) return '';
  return date.split('-')[0];
}


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

      
      releaseGroups.slice(0, 6).forEach(async (rg) => {
        const coverArt = await getCoverArt(rg.id, artist.name, rg.title);
        if (coverArt) {
          const img = new Image();
          img.src = coverArt;
        }
      });
    }

    return releaseGroups;
  } catch (_error) {
    
    return null;
  }
}


let imageObserver = null;
let isBackgroundLoading = false;

function setupIntersectionObserver(releaseGroups, artistName) {
  
  if (imageObserver) {
    imageObserver.disconnect();
  }

  
  const loadedAlbums = new Set();
  const loadingAlbums = new Set();

  
  const loadAlbumCover = async (index) => {
    if (loadedAlbums.has(index) || loadingAlbums.has(index)) {
      return;
    }

    loadingAlbums.add(index);

    const albumEl = modalElements.albumList.querySelector(
      `[data-album-index="${index}"]`
    );
    if (!albumEl) return;

    const coverContainer = albumEl.querySelector('.album-cover-container');
    if (!coverContainer || coverContainer.dataset.loaded === 'true') return;

    try {
      const coverArt = await getCoverArt(
        releaseGroups[index].id,
        artistName,
        releaseGroups[index].title
      );

      if (coverArt && !currentLoadingController?.signal.aborted) {
        
        releaseGroups[index].coverArt = coverArt;

        
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
    } catch (_error) {
      
      loadedAlbums.add(index);
      loadingAlbums.delete(index);
    }
  };

  
  const startBackgroundLoading = async () => {
    if (isBackgroundLoading || currentLoadingController?.signal.aborted) return;

    isBackgroundLoading = true;

    
    const unloadedIndexes = [];
    for (let i = 0; i < releaseGroups.length; i++) {
      if (!loadedAlbums.has(i) && !loadingAlbums.has(i)) {
        unloadedIndexes.push(i);
      }
    }

    
    
    if (unloadedIndexes.length > 0) {
      const allPromises = unloadedIndexes.map((index) => loadAlbumCover(index));

      
      await Promise.allSettled(allPromises);
    }

    isBackgroundLoading = false;
  };

  
  let visibleImagesLoaded = 0;
  let totalVisibleImages = 0;

  
  const pendingLoads = new Set();
  let loadTimer = null;

  imageObserver = new IntersectionObserver(
    (entries, observer) => {
      
      const newlyVisible = [];

      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const albumEl = entry.target;
          const index = parseInt(albumEl.dataset.albumIndex);

          if (!loadedAlbums.has(index) && !loadingAlbums.has(index)) {
            newlyVisible.push(index);
            pendingLoads.add(index);
            totalVisibleImages++;
          }

          
          observer.unobserve(albumEl);
        }
      });

      
      if (loadTimer) clearTimeout(loadTimer);

      
      loadTimer = setTimeout(() => {
        if (pendingLoads.size > 0) {
          
          const toLoad = Array.from(pendingLoads);
          pendingLoads.clear();

          Promise.all(toLoad.map((index) => loadAlbumCover(index))).then(() => {
            visibleImagesLoaded += toLoad.length;

            
            if (
              visibleImagesLoaded >= totalVisibleImages &&
              visibleImagesLoaded > 0
            ) {
              
              startBackgroundLoading();
            }
          });
        }
      }, 50); 
    },
    {
      rootMargin: '100px', 
      threshold: 0.01,
    }
  );

  
  setTimeout(() => {
    
    const visibleAlbums = Array.from(
      modalElements.albumList.querySelectorAll('[data-album-index]')
    ).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight + 100 && rect.bottom > -100; 
    });

    
    const albumIndexes = visibleAlbums
      .map((el) => parseInt(el.dataset.albumIndex))
      .filter((index) => !loadedAlbums.has(index) && !loadingAlbums.has(index));

    if (albumIndexes.length > 0) {
      
      Promise.all(albumIndexes.map((index) => loadAlbumCover(index))).then(
        () => {
          
          startBackgroundLoading();
        }
      );
    } else if (visibleImagesLoaded > 0) {
      
      startBackgroundLoading();
    }
  }, 100); 

  return imageObserver;
}

async function performSearch() {
  const query = modalElements.artistSearchInput.value.trim();
  if (!query) {
    showToast(
      `Please enter ${searchMode === 'artist' ? 'an artist' : 'an album'} name`,
      'error'
    );
    return;
  }

  showLoading();

  try {
    if (searchMode === 'artist') {
      const artists = await searchArtists(query);

      if (artists.length === 0) {
        modalElements.searchLoading.classList.add('hidden');
        modalElements.searchEmpty.classList.remove('hidden');
        modalElements.searchEmpty.innerHTML =
          '<p>No artists found. Try a different search.</p>';
        return;
      }

      
      const prioritizedArtists = prioritizeSearchResults(artists, query);
      await displayArtistResults(prioritizedArtists);
    } else {
      
      const albums = await searchAlbums(query);

      if (albums.length === 0) {
        modalElements.searchLoading.classList.add('hidden');
        modalElements.searchEmpty.classList.remove('hidden');
        modalElements.searchEmpty.innerHTML =
          '<p>No albums found. Try a different search.</p>';
        return;
      }

      await displayDirectAlbumResults(albums);
    }
  } catch (_error) {
    showToast(`Error searching ${searchMode}s`, 'error');
    modalElements.searchLoading.classList.add('hidden');
    modalElements.searchEmpty.classList.remove('hidden');
  }
}

async function displayDirectAlbumResults(releaseGroups) {
  showAlbumResults();
  modalElements.albumList.innerHTML = '';

  
  if (modalElements.backToArtists) {
    modalElements.backToArtists.style.display = 'none';
  }

  
  window.currentReleaseGroups = releaseGroups;

  modalElements.albumList.className = 'space-y-3';

  isBackgroundLoading = false;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
  const currentYear = new Date().getFullYear().toString();

  for (const rg of releaseGroups) {
    const albumEl = document.createElement('div');
    albumEl.dataset.albumIndex = releaseGroups.indexOf(rg);
    albumEl.dataset.albumId = rg.id;

    
    const artistCredits = rg['artist-credit'] || [];
    const artistNames = artistCredits.map(
      (credit) => credit.name || credit.artist?.name || 'Unknown Artist'
    );
    const artistDisplay = artistNames.join(', ');

    const releaseDate = formatReleaseDate(rg['first-release-date']);
    const albumType = rg['primary-type'];
    const isFreshRelease =
      rg['first-release-date'] && rg['first-release-date'] >= thirtyDaysAgoStr;
    const isNewRelease =
      rg['first-release-date'] &&
      rg['first-release-date'].startsWith(currentYear);

    albumEl.className =
      'p-4 bg-gray-800 rounded-lg hover:bg-gray-700 cursor-pointer transition-all hover:shadow-lg flex items-center gap-4 relative';

    albumEl.innerHTML = `
      ${
        isFreshRelease || isNewRelease
          ? `
        <div class="absolute top-2 right-2 flex gap-1 z-10">
          ${
            isFreshRelease
              ? `<span class="bg-red-600 text-white text-xs px-2 py-1 rounded font-semibold">FRESH</span>`
              : ''
          }
          ${
            isNewRelease
              ? `<span class="bg-red-600 text-white text-xs px-2 py-1 rounded font-semibold">NEW</span>`
              : ''
          }
        </div>
      `
          : ''
      }
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

    
    rg._artistDisplay = artistDisplay;
    rg._artistCredit = artistCredits[0]; 

    
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
        country: combinedCountries,
      };

      
      if (!rg.coverArt) {
        try {
          const coverArt = await getCoverArt(
            rg.id,
            currentArtist.name,
            rg.title
          );
          if (coverArt) {
            rg.coverArt = coverArt;
          }
        } catch (_error) {
          
        }
      }

      addAlbumToList(rg);
    };

    modalElements.albumList.appendChild(albumEl);

    
    requestAnimationFrame(() => {
      getCoverArt(rg.id, artistDisplay, rg.title).then((coverArt) => {
        if (coverArt && !currentLoadingController?.signal.aborted) {
          rg.coverArt = coverArt;
          const coverContainer = albumEl.querySelector(
            '.album-cover-container'
          );
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


function initializeAddAlbumFeature() {
  modal = document.getElementById('addAlbumModal');

  if (!modal) {
    console.error('Add album modal not found');
    return;
  }

  
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
    cancelBtn: document.getElementById('cancelManualEntry'),
  };

  
  const essentialElements = [
    'closeModalBtn',
    'searchArtistBtn',
    'artistSearchInput',
  ];
  const missingElements = essentialElements.filter(
    (el) => !modalElements[el] && el !== 'closeModalBtnDesktop'
  );

  if (missingElements.length > 0) {
    console.error('Missing essential modal elements:', missingElements);
    return;
  }

  
  const setupCloseHandlers = () => {
    if (modalElements.closeModalBtn) {
      modalElements.closeModalBtn.onclick = closeAddAlbumModal;
    }
    if (modalElements.closeModalBtnDesktop) {
      modalElements.closeModalBtnDesktop.onclick = closeAddAlbumModal;
    }
  };
  setupCloseHandlers();

  
  modal.onclick = (e) => {
    if (e.target === modal && window.innerWidth >= 1024) {
      closeAddAlbumModal();
    }
  };

  
  modalElements.searchArtistBtn.onclick = performSearch;
  modalElements.artistSearchInput.onkeypress = (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  };

  
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

  
  const searchModeButtons = document.querySelectorAll('.search-mode-btn');
  searchModeButtons.forEach((btn) => {
    btn.onclick = () => updateSearchMode(btn.dataset.mode);
  });

  
  populateCountryDropdown();

  
  document.addEventListener('keydown', (e) => {
    if (
      e.key === 'Escape' &&
      !modal.classList.contains('hidden') &&
      window.innerWidth >= 1024
    ) {
      closeAddAlbumModal();
    }
  });

  
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      
      if (!modal.classList.contains('hidden')) {
        
        const isMobile = window.innerWidth < 1024;
        modal.style.overflow = isMobile ? 'hidden' : '';
      }
    }, 250);
  });
}


function updateSearchMode(mode) {
  searchMode = mode;

  
  document.querySelectorAll('.search-mode-btn').forEach((btn) => {
    const isActive = btn.dataset.mode === mode;
    btn.classList.toggle('active', isActive);
    btn.classList.toggle('bg-gray-700', isActive);
    btn.classList.toggle('text-white', isActive);
    btn.classList.toggle('text-gray-400', !isActive);
  });

  
  const placeholder =
    mode === 'artist' ? 'Search for an artist...' : 'Search for an album...';

  if (modalElements.artistSearchInput) {
    modalElements.artistSearchInput.placeholder = placeholder;
  }

  
  const buttonText = mode === 'artist' ? 'Search Artists' : 'Search Albums';
  const isMobile = window.innerWidth < 1024;

  if (modalElements.searchArtistBtn) {
    modalElements.searchArtistBtn.innerHTML = isMobile
      ? `<i class="fas fa-search mr-2"></i>Search`
      : `<i class="fas fa-search mr-2"></i>${buttonText}`;
  }

  
  clearSearchResults();
}


function clearSearchResults() {
  modalElements.artistResults.classList.add('hidden');
  modalElements.albumResults.classList.add('hidden');
  modalElements.searchLoading.classList.add('hidden');
  modalElements.searchEmpty.classList.remove('hidden');
  modalElements.artistList.innerHTML = '';
  modalElements.albumList.innerHTML = '';
}




window.openAddAlbumModal = function () {
  console.log(
    'openAddAlbumModal called, currentList:',
    window.currentList,
    'modal:',
    modal
  );

  if (!window.currentList) {
    console.log('No list selected, showing toast');
    showToast('Please select a list first', 'error');
    return;
  }

  if (!modal) {
    console.error('Modal element not found!');
    showToast('Error: Modal not initialized', 'error');
    return;
  }

  
  warmupConnections();

  console.log('Opening modal...');
  modal.classList.remove('hidden');

  
  searchMode = 'artist';
  updateSearchMode('artist');

  
  if (modalElements.artistSearchInput) {
    modalElements.artistSearchInput.value = '';
    setTimeout(() => modalElements.artistSearchInput.focus(), 100);
  }

  resetModalState();

  
  populateCountryDropdown();

  
  if (window.innerWidth < 1024) {
    document.body.style.overflow = 'hidden';
  }
};






function showManualEntryForm() {
  
  modalElements.artistResults.classList.add('hidden');
  modalElements.albumResults.classList.add('hidden');
  modalElements.searchLoading.classList.add('hidden');
  modalElements.searchEmpty.classList.add('hidden');

  
  const searchSection = document.getElementById('searchSection');
  if (searchSection) {
    searchSection.classList.add('hidden');
  }

  
  modalElements.manualEntryForm.classList.remove('hidden');

  
  modalElements.form.reset();
  resetCoverPreview();

  
  populateCountryDropdown();
}

function hideManualEntryForm() {
  modalElements.manualEntryForm.classList.add('hidden');
  modalElements.searchEmpty.classList.remove('hidden');

  
  const searchSection = document.getElementById('searchSection');
  if (searchSection) {
    searchSection.classList.remove('hidden');
  }

  
  modalElements.form.reset();
  resetCoverPreview();
}

function populateCountryDropdown() {
  const select = modalElements.countrySelect;

  if (!select) return;

  
  while (select.options.length > 1) {
    select.remove(1);
  }

  
  if (window.availableCountries && Array.isArray(window.availableCountries)) {
    window.availableCountries.forEach((country) => {
      const option = document.createElement('option');
      option.value = country;
      option.textContent = country;
      select.appendChild(option);
    });
  }
}

function resetCoverPreview() {
  const defaultContent =
    window.innerWidth < 1024
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

  
  if (file.size > 5 * 1024 * 1024) {
    showToast('Image file size must be less than 5MB', 'error');
    e.target.value = '';
    return;
  }

  
  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file', 'error');
    e.target.value = '';
    return;
  }

  
  const reader = new FileReader();
  reader.onload = function (event) {
    modalElements.coverPreview.innerHTML = `
      <img src="${event.target.result}" alt="Cover preview" class="w-full h-full object-cover rounded">
    `;
  };
  reader.readAsDataURL(file);
}

async function handleManualSubmit(e) {
  e.preventDefault();

  const formData = new FormData(modalElements.form);

  
  const artist = formData.get('artist').trim();
  const albumTitle = formData.get('album').trim();

  if (!artist || !albumTitle) {
    showToast('Artist and Album title are required', 'error');
    return;
  }

  
  const album = {
    artist: artist,
    album: albumTitle,
    album_id: 'manual-' + Date.now(), 
    release_date: formData.get('release_date') || '',
    country: formData.get('country') || '',
    genre_1: '',
    genre_2: '',
    comments: '',
  };

  
  const coverArtFile = formData.get('cover_art');
  if (coverArtFile && coverArtFile.size > 0) {
    showToast('Processing cover art...', 'info');

    try {
      
      const reader = new FileReader();

      reader.onloadend = async function () {
        const base64data = reader.result;
        album.cover_image = base64data.split(',')[1];
        album.cover_image_format = coverArtFile.type
          .split('/')[1]
          .toUpperCase();

        
        await finishManualAdd(album);
      };

      reader.onerror = function () {
        
        showToast('Error processing cover art', 'error');
      };

      reader.readAsDataURL(coverArtFile);
    } catch (_error) {
      showToast('Error processing cover art', 'error');
    }
  } else {
    
    await finishManualAdd(album);
  }
}

async function finishManualAdd(album) {
  try {
    
    window.lists[window.currentList].push(album);

    if (!Array.isArray(album.tracks) || album.tracks.length === 0) {
      try {
        await window.fetchTracksForAlbum(album);
      } catch (_err) {
        
      }
    }

    
    await window.saveList(window.currentList, window.lists[window.currentList]);

    
    window.selectList(window.currentList);

    
    closeAddAlbumModal();

    showToast(`Added "${album.album}" by ${album.artist} to the list`);
  } catch (_error) {
    showToast('Error adding album to list', 'error');

    
    window.lists[window.currentList].pop();
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

  
  isBackgroundLoading = false;

  
  if (imageObserver) {
    imageObserver.disconnect();
    imageObserver = null;
  }

  modal.classList.add('hidden');
  resetModalState();

  
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

  
  

  
  document.querySelectorAll('.search-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === searchMode);
    btn.classList.toggle('bg-gray-700', btn.dataset.mode === searchMode);
    btn.classList.toggle('text-white', btn.dataset.mode === searchMode);
    btn.classList.toggle('text-gray-400', btn.dataset.mode !== searchMode);
  });

  
  const placeholder =
    searchMode === 'artist'
      ? 'Search for an artist...'
      : 'Search for an album...';

  if (modalElements.artistSearchInput) {
    modalElements.artistSearchInput.placeholder = placeholder;
  }

  
  const searchSection = document.getElementById('searchSection');
  if (searchSection) {
    searchSection.classList.remove('hidden');
  }

  
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

function calculateLevenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[len1][len2];
}

function calculateSimilarity(str1, str2) {
  const distance = calculateLevenshteinDistance(
    str1.toLowerCase(),
    str2.toLowerCase()
  );
  const maxLength = Math.max(str1.length, str2.length);
  return maxLength === 0 ? 1 : 1 - distance / maxLength;
}

async function getWikidataImageFromMusicBrainz(artistId, artistName) {
  try {
    const endpoint = `artist/${artistId}?inc=url-rels&fmt=json`;
    
    const data = await rateLimitedFetch(endpoint, 'low');

    if (!data.relations) {
      return null;
    }

    const wikidataRel = data.relations.find(
      (rel) => rel.type === 'wikidata' && rel.url && rel.url.resource
    );

    if (!wikidataRel) {
      console.debug(`No Wikidata link found for "${artistName}" (${artistId})`);
      return null;
    }

    const wikidataId = wikidataRel.url.resource.split('/').pop();
    console.debug(`Found Wikidata ID for "${artistName}": ${wikidataId}`);

    
    const wikidataUrl = `${WIKIDATA_PROXY}?entity=${encodeURIComponent(wikidataId)}&property=P18`;
    const wikidataResponse = await fetch(wikidataUrl, {
      credentials: 'same-origin',
    });

    if (!wikidataResponse.ok) {
      return null;
    }

    const wikidataData = await wikidataResponse.json();

    if (
      wikidataData.claims &&
      wikidataData.claims.P18 &&
      wikidataData.claims.P18[0]
    ) {
      const imageFilename = wikidataData.claims.P18[0].mainsnak.datavalue.value;
      const encodedFilename = encodeURIComponent(
        imageFilename.replace(/ /g, '_')
      );
      const imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodedFilename}?width=500`;

      console.debug(
        `Found Wikidata image for "${artistName}": ${imageFilename}`
      );
      return imageUrl;
    }

    return null;
  } catch (error) {
    console.error(`Error fetching Wikidata image for "${artistName}":`, error);
    return null;
  }
}

async function searchDeezerArtistImage(artistName, disambiguation = null) {
  try {
    const searchQuery = artistName.replace(/[^\w\s]/g, ' ').trim();
    const url = `/api/proxy/deezer/artist?q=${encodeURIComponent(searchQuery)}`;

    const response = await fetch(url, {
      credentials: 'same-origin',
    });

    if (!response.ok) {
      console.warn(
        `Deezer artist image fetch failed for "${artistName}": ${response.status}`
      );
      return null;
    }

    const data = await response.json();

    if (data.data && data.data.length > 0) {
      const searchNameLower = artistName.toLowerCase();
      const SIMILARITY_THRESHOLD = 0.7;

      const bestMatch = data.data.find(
        (artist) => artist.name.toLowerCase() === searchNameLower
      );

      if (bestMatch) {
        console.debug(
          `Exact Deezer match found for "${artistName}"${disambiguation ? ` (${disambiguation})` : ''}: ${bestMatch.name}`
        );

        const imageUrl =
          bestMatch.picture_xl ||
          bestMatch.picture_big ||
          bestMatch.picture_medium;
        return imageUrl || null;
      }

      const candidates = data.data.map((deezerArtist) => ({
        artist: deezerArtist,
        similarity: calculateSimilarity(artistName, deezerArtist.name),
      }));

      candidates.sort((a, b) => b.similarity - a.similarity);

      const topCandidate = candidates[0];

      if (topCandidate.similarity >= SIMILARITY_THRESHOLD) {
        console.debug(
          `Similar Deezer match found for "${artistName}"${disambiguation ? ` (${disambiguation})` : ''}: ${topCandidate.artist.name} (similarity: ${topCandidate.similarity.toFixed(2)})`
        );

        const imageUrl =
          topCandidate.artist.picture_xl ||
          topCandidate.artist.picture_big ||
          topCandidate.artist.picture_medium;
        return imageUrl || null;
      } else {
        console.warn(
          `No good Deezer match found for "${artistName}"${disambiguation ? ` (${disambiguation})` : ''}. Best candidate: ${topCandidate.artist.name} (similarity: ${topCandidate.similarity.toFixed(2)}, threshold: ${SIMILARITY_THRESHOLD})`
        );
      }
    }

    return null;
  } catch (error) {
    console.error(
      `Error fetching Deezer artist image for "${artistName}":`,
      error
    );
    return null;
  }
}

async function searchArtistImage(
  artistName,
  disambiguation = null,
  artistId = null
) {
  try {
    if (artistId && artistImageCache.has(artistId)) {
      const cached = artistImageCache.get(artistId);
      console.debug(`Using cached image for "${artistName}" (${artistId})`);
      return cached;
    }

    let imageUrl = null;

    
    console.debug(`Trying Deezer for "${artistName}"`);
    imageUrl = await searchDeezerArtistImage(artistName, disambiguation);

    if (imageUrl) {
      console.debug(`✓ Using Deezer image for "${artistName}"`);
      if (artistId) {
        artistImageCache.set(artistId, imageUrl);
      }
      return imageUrl;
    }

    
    if (artistId) {
      console.debug(
        `Deezer failed, trying MusicBrainz/Wikidata for "${artistName}" (${artistId})`
      );
      imageUrl = await getWikidataImageFromMusicBrainz(artistId, artistName);

      if (imageUrl) {
        console.debug(`✓ Using Wikidata image for "${artistName}"`);
        artistImageCache.set(artistId, imageUrl);
        return imageUrl;
      }
    }

    if (artistId) {
      artistImageCache.set(artistId, null);
    }
    return null;
  } catch (error) {
    console.error('Error fetching artist image:', error);
    if (artistId) {
      artistImageCache.set(artistId, null);
    }
    return null;
  }
}


async function displayArtistResults(artists) {
  modalElements.artistList.innerHTML = '';

  
  modalElements.artistList.className = 'space-y-3';

  
  for (const artist of artists) {
    const displayName = formatArtistDisplayName(artist);
    const artistEl = document.createElement('div');
    artistEl.className =
      'p-4 bg-gray-800 rounded-lg hover:bg-gray-700 cursor-pointer transition-colors flex items-center gap-4';

    
    let secondaryText = '';
    if (displayName.secondary) {
      secondaryText = displayName.secondary;
    }

    
    if (
      artist.disambiguation &&
      artist.disambiguation !== displayName.secondary &&
      artist.disambiguation !== displayName.primary
    ) {
      secondaryText += secondaryText
        ? ` • ${artist.disambiguation}`
        : artist.disambiguation;
    }

    
    let countryDisplay = '';
    resolveCountryCode(artist.country).then((fullCountryName) => {
      if (fullCountryName) {
        countryDisplay = ` • ${fullCountryName}`;
        const countryEl = artistEl.querySelector('.artist-country');
        if (countryEl) {
          countryEl.textContent = `${artist.type || 'Artist'}${countryDisplay}`;
        }
      }
    });

    
    artistEl.innerHTML = `
      <div class="artist-image-container flex-shrink-0">
        <div class="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center animate-pulse">
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
        <div class="text-sm text-gray-400 mt-1 artist-country">${artist.type || 'Artist'}${artist.country ? ` • ${artist.country}` : ''}</div>
      </div>
      <div class="flex-shrink-0">
        <i class="fas fa-chevron-right text-gray-500"></i>
      </div>
    `;

    
    const enhancedArtist = {
      ...artist,
      _displayName: displayName,
    };

    
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

    
    const searchName =
      displayName.original && !displayName.warning
        ? displayName.primary
        : artist.name;
    searchArtistImage(searchName, artist.disambiguation, artist.id)
      .then((imageUrl) => {
        if (imageUrl) {
          const imageContainer = artistEl.querySelector(
            '.artist-image-container'
          );
          if (imageContainer) {
            imageContainer.innerHTML = `
              <img 
                src="${imageUrl}" 
                alt="${displayName.primary}" 
                class="w-16 h-16 rounded-full object-cover"
                onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center\\'><svg width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\' class=\\'text-gray-600\\'><path d=\\'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2\\'></path><circle cx=\\'12\\' cy=\\'7\\' r=\\'4\\'></circle></svg></div>'"
              >
            `;
          }
        } else {
          
          const imageContainer = artistEl.querySelector(
            '.artist-image-container div'
          );
          if (imageContainer) {
            imageContainer.classList.remove('animate-pulse');
          }
        }
      })
      .catch(() => {
        
        const imageContainer = artistEl.querySelector(
          '.artist-image-container div'
        );
        if (imageContainer) {
          imageContainer.classList.remove('animate-pulse');
        }
      });
  }

  showArtistResults();
}

async function selectArtist(artist) {
  
  currentArtist = artist._displayName
    ? {
        ...artist,
        name: artist._displayName.primary, 
        originalName: artist.name, 
      }
    : artist;

  showLoading();

  currentLoadingController = new AbortController();

  try {
    
    let releaseGroups = preloadCache.get(artist.id);

    if (!releaseGroups) {
      releaseGroups = await getArtistReleaseGroups(artist.id);
    }

    if (releaseGroups.length === 0) {
      showToast('No pure albums or EPs found for this artist', 'error');
      showAlbumResults();
      modalElements.albumList.innerHTML =
        '<p class="col-span-full text-center text-gray-500">No standard albums or EPs found.</p>';
      return;
    }

    displayAlbumResultsWithLazyLoading(releaseGroups);
  } catch (error) {
    if (error.name === 'AbortError') {
      
      return;
    }
    showToast('Error fetching albums', 'error');
    showArtistResults();
  }
}

async function resolveCountryCode(countryCode) {
  if (!countryCode || countryCode.length !== 2) {
    console.debug(`Invalid country code: ${countryCode}`);
    return '';
  }

  try {
    
    const response = await fetch(
      `https://restcountries.com/v3.1/alpha/${countryCode}`
    );

    if (!response.ok) {
      console.warn(
        `Country code ${countryCode} not found in RestCountries API`
      );
      return '';
    }

    const data = await response.json();
    if (!data || !data[0]) {
      console.warn(`Empty data from RestCountries API for ${countryCode}`);
      return '';
    }

    const countryData = data[0];

    
    const namesToTry = [
      countryData.name.common,
      countryData.name.official,
      
      ...(countryData.altSpellings || []),
    ];

    
    if (countryCode === 'US') {
      namesToTry.push('United States');
    } else if (countryCode === 'GB') {
      namesToTry.push('United Kingdom');
    } else if (countryCode === 'KR') {
      namesToTry.push('Korea, South');
    } else if (countryCode === 'KP') {
      namesToTry.push('Korea, North');
    }

    
    if (
      !window.availableCountries ||
      !Array.isArray(window.availableCountries)
    ) {
      console.warn('availableCountries not loaded yet, returning country code');
      return countryData.name.common;
    }

    
    for (const name of namesToTry) {
      if (name && window.availableCountries.includes(name)) {
        console.debug(`Resolved ${countryCode} to ${name}`);
        return name;
      }
    }

    
    const commonName = countryData.name.common.toLowerCase();
    const closeMatch = window.availableCountries.find((country) => {
      const countryLower = country.toLowerCase();
      return (
        countryLower === commonName ||
        countryLower.includes(commonName) ||
        commonName.includes(countryLower)
      );
    });

    if (closeMatch) {
      console.debug(`Resolved ${countryCode} to ${closeMatch} (partial match)`);
      return closeMatch;
    }

    console.warn(
      `Country "${countryData.name.common}" (${countryCode}) not found in allowed countries list. Names tried: ${namesToTry.join(', ')}`
    );
    return '';
  } catch (error) {
    console.error(`Error resolving country code ${countryCode}:`, error);
    return '';
  }
}


async function getCombinedArtistCountries(artistCredits) {
  const countries = [];

  for (const credit of artistCredits) {
    const id = credit.artist?.id;
    if (!id) continue;

    try {
      const endpoint = `artist/${id}?fmt=json`;
      
      const artistData = await rateLimitedFetch(endpoint, 'normal');
      if (artistData && artistData.country) {
        const name = await resolveCountryCode(artistData.country);
        if (name && !countries.includes(name)) {
          countries.push(name);
        }
      }
    } catch (_err) {
      
    }
  }

  return countries.join(' / ');
}

async function searchAlbums(query) {
  const endpoint = `release-group/?query=${encodeURIComponent(query)}&type=album|ep&fmt=json&limit=20`;
  
  const data = await rateLimitedFetch(endpoint, 'high');

  let releaseGroups = data['release-groups'] || [];

  
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  releaseGroups = releaseGroups.filter((rg) => {
    const primaryType = rg['primary-type'];
    const secondaryTypes = rg['secondary-types'] || [];
    const releaseDate = rg['first-release-date'];

    const isValidType =
      (primaryType === 'Album' || primaryType === 'EP') &&
      secondaryTypes.length === 0;

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

  
  window.currentReleaseGroups = releaseGroups;

  
  modalElements.albumList.className = 'space-y-3'; 

  
  isBackgroundLoading = false;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
  const currentYear = new Date().getFullYear().toString();

  
  const observer = setupIntersectionObserver(releaseGroups, currentArtist.name);

  releaseGroups.forEach((rg, index) => {
    const albumEl = document.createElement('div');
    albumEl.dataset.albumIndex = index;
    albumEl.dataset.albumId = rg.id;

    const releaseDate = formatReleaseDate(rg['first-release-date']);
    const albumType = rg['primary-type'];
    const isFreshRelease =
      rg['first-release-date'] && rg['first-release-date'] >= thirtyDaysAgoStr;
    const isNewRelease =
      rg['first-release-date'] &&
      rg['first-release-date'].startsWith(currentYear);

    
    albumEl.className =
      'p-4 bg-gray-800 rounded-lg hover:bg-gray-700 cursor-pointer transition-all hover:shadow-lg flex items-center gap-4 relative';

    albumEl.innerHTML = `
      ${
        isFreshRelease || isNewRelease
          ? `
        <div class="absolute top-2 right-2 flex gap-1 z-10">
          ${
            isFreshRelease
              ? `<span class="bg-red-600 text-white text-xs px-2 py-1 rounded font-semibold">FRESH</span>`
              : ''
          }
          ${
            isNewRelease
              ? `<span class="bg-red-600 text-white text-xs px-2 py-1 rounded font-semibold">NEW</span>`
              : ''
          }
        </div>
      `
          : ''
      }
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

    
    albumEl.onclick = async () => {
      
      const coverContainer = albumEl.querySelector('.album-cover-container');
      coverContainer.innerHTML = `
        <div class="w-20 h-20 bg-gray-700 rounded-lg flex items-center justify-center">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      `;

      
      const imgEl = albumEl.querySelector('.album-cover-container img');
      if (
        imgEl &&
        imgEl.src &&
        !imgEl.src.includes('data:image/svg') &&
        !rg.coverArt
      ) {
        rg.coverArt = imgEl.src;
      }

      
      if (!rg.coverArt) {
        try {
          const coverArt = await getCoverArt(
            rg.id,
            currentArtist.name,
            rg.title
          );
          if (coverArt) {
            rg.coverArt = coverArt;
          }
        } catch (_error) {
          
        }
      }

      addAlbumToList(rg);
    };

    modalElements.albumList.appendChild(albumEl);

    
    observer.observe(albumEl);
  });

  
  window.currentReleaseGroups = releaseGroups;

  
  requestAnimationFrame(() => {
    const visibleAlbums = Array.from(
      modalElements.albumList.querySelectorAll('[data-album-index]')
    ).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    });

    
    visibleAlbums.forEach((el) => {
      if (observer) {
        observer.unobserve(el);
        observer.observe(el);
      }
    });
  });
}

async function addAlbumToList(releaseGroup) {
  
  showToast('Adding album...', 'info');

  console.debug('Adding album for artist:', currentArtist);
  console.debug('Artist country field:', currentArtist.country);

  let resolvedCountry = '';
  if (currentArtist.country) {
    if (currentArtist.country.length === 2) {
      resolvedCountry = await resolveCountryCode(currentArtist.country);
      console.debug(
        `Resolved country code ${currentArtist.country} to: ${resolvedCountry}`
      );
    } else {
      resolvedCountry = currentArtist.country;
      console.debug('Using full country name:', resolvedCountry);
    }
  } else {
    console.warn('No country field found for artist:', currentArtist.name);
  }

  const album = {
    artist: currentArtist.name,
    album: releaseGroup.title,
    album_id: releaseGroup.id,
    release_date: releaseGroup['first-release-date'] || '',
    country: resolvedCountry,
    genre_1: '',
    genre_2: '',
    comments: '',
  };

  console.debug('Album object being saved:', album);

  
  let coverArtUrl = releaseGroup.coverArt;

  
  if (!coverArtUrl) {
    
    const albumElements = document.querySelectorAll('[data-album-index]');
    for (const el of albumElements) {
      if (
        parseInt(el.dataset.albumIndex) === releaseGroups.indexOf(releaseGroup)
      ) {
        const imgEl = el.querySelector('.album-cover-container img');
        if (imgEl && imgEl.src && !imgEl.src.includes('data:image/svg')) {
          coverArtUrl = imgEl.src;
          
          releaseGroup.coverArt = coverArtUrl;
          break;
        }
      }
    }
  }

  
  if (!coverArtUrl) {
    showToast('Fetching album cover...', 'info');
    try {
      coverArtUrl = await getCoverArt(
        releaseGroup.id,
        currentArtist.name,
        releaseGroup.title
      );
      if (coverArtUrl) {
        
        releaseGroup.coverArt = coverArtUrl;
      }
    } catch (_error) {
      
    }
  }

  
  if (coverArtUrl) {
    try {
      
      const proxyUrl = `/api/proxy/image?url=${encodeURIComponent(coverArtUrl)}`;
      const response = await fetch(proxyUrl, {
        credentials: 'same-origin',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch image through proxy');
      }

      const data = await response.json();

      if (data.data && data.contentType) {
        album.cover_image = data.data;
        album.cover_image_format = data.contentType.split('/')[1].toUpperCase();
      }

      addAlbumToCurrentList(album);
    } catch (error) {
      console.warn('Error fetching cover art:', error);
      
      addAlbumToCurrentList(album);
    }
  } else {
    
    addAlbumToCurrentList(album);
  }
}

async function addAlbumToCurrentList(album) {
  try {
    window.lists[window.currentList].push(album);

    if (!Array.isArray(album.tracks) || album.tracks.length === 0) {
      try {
        await window.fetchTracksForAlbum(album);
      } catch (_err) {
        
      }
    }

    await window.saveList(window.currentList, window.lists[window.currentList]);

    window.selectList(window.currentList);

    closeAddAlbumModal();

    showToast(`Added "${album.album}" by ${album.artist} to the list`);
  } catch (_error) {
    showToast('Error adding album to list', 'error');

    window.lists[window.currentList].pop();
  }
}

function hasNonLatinCharacters(str) {
  if (!str) return false;
  
  const alphaChars = str.match(/\p{L}/gu) || [];
  const nonLatinChars = str.match(/[^\u0020-\u024F\u1E00-\u1EFF]/gu) || [];
  return (
    alphaChars.length > 0 && nonLatinChars.length / alphaChars.length > 0.5
  );
}


function extractLatinName(artist) {
  let latinName = null;

  
  if (artist['sort-name'] && artist['sort-name'] !== artist.name) {
    if (!hasNonLatinCharacters(artist['sort-name'])) {
      
      const sortName = artist['sort-name'];
      if (sortName.includes(',')) {
        
        const parts = sortName.split(',').map((p) => p.trim());
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

  
  if (!latinName && artist.name) {
    const nameParenMatch = artist.name.match(/\(([^)]+)\)/);
    if (nameParenMatch) {
      const extracted = nameParenMatch[1].trim();
      if (!hasNonLatinCharacters(extracted)) {
        latinName = extracted;
      }
    }
  }

  
  if (!latinName && artist.disambiguation) {
    
    if (!hasNonLatinCharacters(artist.disambiguation)) {
      
      const looksLikeName =
        !artist.disambiguation.includes(' ') ||
        artist.disambiguation.split(' ').length <= 3;
      if (
        looksLikeName &&
        !artist.disambiguation.toLowerCase().includes('group') &&
        !artist.disambiguation.toLowerCase().includes('band')
      ) {
        latinName = artist.disambiguation;
      }
    }
  }

  
  if (!latinName && artist.aliases && Array.isArray(artist.aliases)) {
    for (const alias of artist.aliases) {
      if (alias.name && !hasNonLatinCharacters(alias.name)) {
        
        if (alias.primary || alias.type === 'Artist name') {
          latinName = alias.name;
          break;
        }
      }
    }
    
    if (!latinName) {
      const latinAlias = artist.aliases.find(
        (a) => a.name && !hasNonLatinCharacters(a.name)
      );
      if (latinAlias) {
        latinName = latinAlias.name;
      }
    }
  }

  return latinName;
}


function formatArtistDisplayName(artist) {
  const hasNonLatin = hasNonLatinCharacters(artist.name);

  if (!hasNonLatin) {
    
    return {
      primary: artist.name,
      secondary: artist.disambiguation || null,
      original: artist.name,
    };
  }

  
  const latinName = extractLatinName(artist);

  if (latinName) {
    
    return {
      primary: latinName,
      secondary: artist.name,
      original: artist.name,
    };
  } else {
    
    return {
      primary: artist.name,
      secondary: 'Non-Latin script',
      original: artist.name,
      warning: true,
    };
  }
}


document.addEventListener('DOMContentLoaded', () => {
  
  const isAuthPage = window.location.pathname.match(
    /\/(login|register|forgot)/
  );
  if (!isAuthPage) {
    initializeAddAlbumFeature();
  }
});
