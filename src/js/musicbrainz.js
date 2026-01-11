// MusicBrainz API integration
import { isAlbumInList } from './modules/utils.js';
import { checkAndPromptSimilar } from './modules/similar-album-modal.js';

const MUSICBRAINZ_PROXY = '/api/proxy/musicbrainz'; // Using our proxy
const WIKIDATA_PROXY = '/api/proxy/wikidata'; // Using our proxy

// Rate limiting is now handled on the backend, but we'll keep a small delay for the UI
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 100; // Small delay for UI responsiveness

let searchMode = 'artist';

// Cache for artist images to avoid duplicate requests (keyed by artist ID)
const artistImageCache = new Map();

// Global abort controller for artist image searches - aborted when user selects an artist
let artistImageAbortController = null;

// =============================================================================
// ARTIST IMAGE PROVIDER SYSTEM
// Same architecture as album covers - parallel racing with verified loads
// =============================================================================

const artistImageProviders = [
  // Deezer - fast, good commercial coverage
  {
    name: 'Deezer',
    search: async (artistName, _artistId, signal) => {
      const searchQuery = artistName.replace(/[^\w\s]/g, ' ').trim();
      const url = `/api/proxy/deezer/artist?q=${encodeURIComponent(searchQuery)}`;

      const response = await fetch(url, { signal, credentials: 'same-origin' });
      if (!response.ok) return null;

      const data = await response.json();
      if (!data.data || data.data.length === 0) return null;

      // Find best match
      const searchNameLower = artistName.toLowerCase();
      let bestMatch = data.data.find(
        (a) => a.name.toLowerCase() === searchNameLower
      );

      if (!bestMatch) {
        // Fuzzy match using stringSimilarity
        const candidates = data.data.map((a) => ({
          artist: a,
          score: stringSimilarity(artistName, a.name),
        }));
        candidates.sort((a, b) => b.score - a.score);
        if (candidates[0]?.score >= 0.7) {
          bestMatch = candidates[0].artist;
        }
      }

      if (!bestMatch) return null;

      const imageUrl =
        bestMatch.picture_xl ||
        bestMatch.picture_big ||
        bestMatch.picture_medium;
      if (!imageUrl) return null;

      // Verify image loads
      await verifyImageLoads(imageUrl, signal);
      return imageUrl;
    },
  },

  // iTunes/Apple Music - good coverage, high quality images
  {
    name: 'iTunes',
    search: async (artistName, _artistId, signal) => {
      const searchTerm = artistName.replace(/[^\w\s]/g, ' ').trim();
      const url = `/api/proxy/itunes?term=${encodeURIComponent(searchTerm)}&limit=10`;

      const response = await fetch(url, { signal, credentials: 'same-origin' });
      if (!response.ok) return null;

      const data = await response.json();
      if (!data.results || data.results.length === 0) return null;

      // iTunes album search returns artist info - find best artist match
      let bestMatch = null;
      let bestScore = 0;

      for (const album of data.results) {
        if (!album.artistName || !album.artworkUrl100) continue;

        const score = stringSimilarity(artistName, album.artistName);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = album;
        }
      }

      if (!bestMatch || bestScore < 0.7) return null;

      // Use album artwork as artist image (common practice when no dedicated artist image)
      // Convert to larger size
      const imageUrl = bestMatch.artworkUrl100.replace(
        /\/\d+x\d+bb\./,
        `/${ITUNES_IMAGE_SIZE}x${ITUNES_IMAGE_SIZE}bb.`
      );

      await verifyImageLoads(imageUrl, signal);
      return imageUrl;
    },
  },

  // Wikidata via MusicBrainz - slower but good for notable artists
  {
    name: 'Wikidata',
    search: async (artistName, artistId, signal) => {
      if (!artistId) return null;

      // Get Wikidata ID from MusicBrainz
      const endpoint = `artist/${artistId}?inc=url-rels&fmt=json`;
      const mbData = await rateLimitedFetch(endpoint, 'low', signal);

      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!mbData.relations) return null;

      const wikidataRel = mbData.relations.find(
        (r) => r.type === 'wikidata' && r.url?.resource
      );
      if (!wikidataRel) return null;

      const wikidataId = wikidataRel.url.resource.split('/').pop();

      // Get image from Wikidata
      const wikidataUrl = `${WIKIDATA_PROXY}?entity=${encodeURIComponent(wikidataId)}&property=P18`;
      const wdResponse = await fetch(wikidataUrl, {
        signal,
        credentials: 'same-origin',
      });

      if (!wdResponse.ok) return null;

      const wdData = await wdResponse.json();
      if (!wdData.claims?.P18?.[0]?.mainsnak?.datavalue?.value) return null;

      const filename = wdData.claims.P18[0].mainsnak.datavalue.value;
      const encodedFilename = encodeURIComponent(filename.replace(/ /g, '_'));
      const imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodedFilename}?width=500`;

      // Verify image loads
      await verifyImageLoads(imageUrl, signal);
      return imageUrl;
    },
  },
];

// Race all artist image providers - first verified load wins
async function searchArtistImageRacing(
  artistName,
  artistId,
  externalSignal = null
) {
  // If already aborted externally, bail immediately
  if (externalSignal?.aborted) {
    return null;
  }

  const cacheKey = artistId || artistName.toLowerCase();

  if (artistImageCache.has(cacheKey)) {
    return artistImageCache.get(cacheKey);
  }

  if (artistImageProviders.length === 0) {
    artistImageCache.set(cacheKey, null);
    return null;
  }

  const controller = new AbortController();

  // Link external signal to our controller - abort providers if parent aborts
  if (externalSignal) {
    externalSignal.addEventListener('abort', () => controller.abort(), {
      once: true,
    });
  }

  const providerPromises = artistImageProviders.map(async (provider) => {
    try {
      const url = await provider.search(
        artistName,
        artistId,
        controller.signal
      );
      if (url) {
        console.log(
          `📊 [ARTIST] ✅ ${provider.name} loaded image for "${artistName}"`
        );
        return { name: provider.name, url };
      }
      return null;
    } catch (error) {
      if (error.name !== 'AbortError') {
        // Silent fail for individual providers
      }
      return null;
    }
  });

  try {
    const result = await Promise.any(
      providerPromises.map((p) =>
        p.then((r) => {
          if (r?.url) return r;
          throw new Error('No result');
        })
      )
    );

    controller.abort();
    artistImageCache.set(cacheKey, result.url);
    return result.url;
  } catch (_error) {
    // Don't cache if aborted - might succeed on retry
    if (!externalSignal?.aborted) {
      artistImageCache.set(cacheKey, null);
    }
    return null;
  }
}

// =============================================================================
// COVER ART PROVIDER SYSTEM
// All providers are queried in PARALLEL. First successful result wins,
// and remaining requests are automatically aborted via AbortSignal.
//
// To add a new provider:
// 1. Create a search function: async (artistName, albumTitle, releaseGroupId, signal) => url | null
//    - signal is an AbortSignal - pass it to fetch() to support cancellation
// 2. Add to coverArtProviders array with name and search function
// 3. Optionally add CDN to warmupConnections() for preconnect
// =============================================================================

// Cache for cover art searches (keyed by releaseGroupId or "artistName::albumTitle")
const coverArtCache = new Map();

// iTunes/Apple Music image size (pixels)
// Options: 100, 300, 600, 1000, 2000, 5000
const ITUNES_IMAGE_SIZE = 600;

// Normalize string for fuzzy matching (lowercase, remove special chars)
function normalizeForMatch(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

// Calculate similarity score between two strings (0-1)
function stringSimilarity(str1, str2) {
  const s1 = normalizeForMatch(str1);
  const s2 = normalizeForMatch(str2);

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  // Check if one contains the other
  if (s1.includes(s2) || s2.includes(s1)) return 0.9;

  // Simple word overlap scoring
  const words1 = s1.split(' ');
  const words2 = s2.split(' ');
  const commonWords = words1.filter((w) => words2.includes(w));

  return commonWords.length / Math.max(words1.length, words2.length);
}

// Verify an image URL actually loads successfully
// Returns the URL if successful, throws on failure
async function verifyImageLoads(url, signal) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    // Handle abort signal
    const abortHandler = () => {
      img.src = ''; // Cancel the load
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abortHandler);

    img.onload = () => {
      signal?.removeEventListener('abort', abortHandler);
      // Check for valid image (not a placeholder)
      if (img.naturalWidth > 1 && img.naturalHeight > 1) {
        resolve(url);
      } else {
        reject(new Error('Invalid image dimensions'));
      }
    };

    img.onerror = () => {
      signal?.removeEventListener('abort', abortHandler);
      reject(new Error('Image failed to load'));
    };

    img.src = url;
  });
}

// Cover art providers - queried in parallel, first to LOAD wins
// Each provider returns URL only after verifying the image actually loads
const coverArtProviders = [
  // Cover Art Archive - uses MusicBrainz release group ID
  {
    name: 'CoverArtArchive',
    search: async (_artistName, _albumTitle, releaseGroupId, signal) => {
      if (!releaseGroupId) return null;
      const url = `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`;
      // Actually load the image to verify it exists
      await verifyImageLoads(url, signal);
      return url;
    },
  },

  // iTunes/Apple Music - search-based provider with fuzzy matching
  {
    name: 'iTunes',
    search: async (artistName, albumTitle, _releaseGroupId, signal) => {
      if (!artistName || !albumTitle) return null;

      try {
        const searchTerm = `${artistName} ${albumTitle}`;
        const apiUrl = `/api/proxy/itunes?term=${encodeURIComponent(searchTerm)}&limit=10`;

        const response = await fetch(apiUrl, {
          signal,
          credentials: 'same-origin',
        });

        if (!response.ok) return null;

        const data = await response.json();

        if (!data.results || data.results.length === 0) return null;

        // Find best matching album using fuzzy matching
        let bestMatch = null;
        let bestScore = 0;

        for (const album of data.results) {
          if (!album.artworkUrl100) continue;

          const artistScore = stringSimilarity(
            artistName,
            album.artistName || ''
          );
          const albumScore = stringSimilarity(
            albumTitle,
            album.collectionName || ''
          );
          const combinedScore = artistScore * 0.4 + albumScore * 0.6;

          if (combinedScore > bestScore) {
            bestScore = combinedScore;
            bestMatch = album;
          }
        }

        if (!bestMatch || bestScore < 0.5) return null;

        // Convert artwork URL to desired size
        const artworkUrl = bestMatch.artworkUrl100.replace(
          /\/\d+x\d+bb\./,
          `/${ITUNES_IMAGE_SIZE}x${ITUNES_IMAGE_SIZE}bb.`
        );

        // Actually load the image to verify it works
        await verifyImageLoads(artworkUrl, signal);
        return artworkUrl;
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        return null;
      }
    },
  },
];

// Query all providers in parallel, first to successfully LOAD an image wins
// Other providers are aborted once we have a winner
async function searchCoverArt(artistName, albumTitle, releaseGroupId) {
  const cacheKey =
    releaseGroupId || `${artistName}::${albumTitle}`.toLowerCase();

  if (coverArtCache.has(cacheKey)) {
    return coverArtCache.get(cacheKey);
  }

  if (coverArtProviders.length === 0) {
    coverArtCache.set(cacheKey, null);
    return null;
  }

  // AbortController to cancel remaining providers once one succeeds
  const controller = new AbortController();

  // Each provider races to actually LOAD an image (not just return a URL)
  const providerPromises = coverArtProviders.map(async (provider) => {
    try {
      const url = await provider.search(
        artistName,
        albumTitle,
        releaseGroupId,
        controller.signal
      );

      if (url) {
        console.log(
          `📊 [COVER] ✅ ${provider.name} loaded cover for "${albumTitle}"`
        );
        return { name: provider.name, url };
      }
      return null;
    } catch (error) {
      // AbortError is expected when cancelled - don't log it
      if (error.name !== 'AbortError') {
        // Don't log "Image failed to load" for every CAA miss - too noisy
      }
      return null;
    }
  });

  try {
    // Race all providers - first successful image load wins
    const result = await Promise.any(
      providerPromises.map((p) =>
        p.then((r) => {
          if (r?.url) return r;
          throw new Error('No result');
        })
      )
    );

    // Got a winner - abort all other providers
    controller.abort();
    coverArtCache.set(cacheKey, result.url);
    return result.url;
  } catch (_error) {
    // All providers failed
    coverArtCache.set(cacheKey, null);
    return null;
  }
}

// Load cover art for an album element - called when albums are rendered
// The provider system already verifies images load, so we just set the src
async function loadAlbumCover(
  imgElement,
  artistName,
  albumTitle,
  releaseGroupId,
  index
) {
  try {
    // searchCoverArt races all providers and returns first VERIFIED image URL
    const coverUrl = await searchCoverArt(
      artistName,
      albumTitle,
      releaseGroupId
    );

    if (coverUrl && imgElement && imgElement.parentElement) {
      // Store the cover URL for later use
      if (window.currentReleaseGroups && window.currentReleaseGroups[index]) {
        window.currentReleaseGroups[index].coverArt = coverUrl;
      }
      // Remove loading state and set the verified image
      imgElement.parentElement.classList.remove('animate-pulse');
      imgElement.src = coverUrl;
    } else {
      // No provider found a working image
      showCoverPlaceholder(imgElement);
    }
  } catch (error) {
    console.warn(
      `📊 [COVER] Failed to load cover for "${albumTitle}":`,
      error.message
    );
    showCoverPlaceholder(imgElement);
  }
}

// Modal management
let currentArtist = null;
let modal = null;
let modalElements = {};
let currentLoadingController = null;

// =============================================================================
// ALBUM PROVIDER SYSTEM
// Album metadata provider - MusicBrainz only for authoritative, high-quality data
// Cover images are fetched separately via coverArtProviders (CoverArtArchive, iTunes)
// =============================================================================

// MusicBrainz provides release group IDs, proper album types, and accurate dates
// Images are fetched separately via coverArtProviders (CoverArtArchive, iTunes)
const albumProviders = [
  // MusicBrainz - authoritative source with proper release group IDs, types, and dates
  {
    name: 'MusicBrainz',
    search: async (artistName, artistId, signal) => {
      if (!artistId) return null;

      const endpoint = `release-group?artist=${artistId}&type=album|ep&fmt=json&limit=100`;
      const data = await rateLimitedFetch(endpoint, 'high', signal);

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
          const lastDay = new Date(
            parseInt(year),
            parseInt(month),
            0
          ).getDate();
          comparableDate = `${releaseDate}-${lastDay.toString().padStart(2, '0')}`;
        }

        return isValidType && comparableDate <= todayStr;
      });

      if (releaseGroups.length === 0) return null;

      const albums = releaseGroups.map((rg) => ({
        title: rg.title,
        releaseDate: rg['first-release-date'] || '',
        type: rg['primary-type'],
        releaseGroupId: rg.id,
        artistName: artistName,
        source: 'MusicBrainz',
        // No coverUrl - will be fetched separately via cover art providers
      }));

      // Sort by release date descending
      albums.sort((a, b) =>
        (b.releaseDate || '').localeCompare(a.releaseDate || '')
      );

      return albums;
    },
  },
];

// Race all album providers - first valid album list wins
async function searchArtistAlbumsRacing(artistName, artistId) {
  const controller = new AbortController();

  const providerPromises = albumProviders.map(async (provider) => {
    try {
      const albums = await provider.search(
        artistName,
        artistId,
        controller.signal
      );
      if (albums && albums.length > 0) {
        console.log(
          `📊 [ALBUMS] ✅ ${provider.name} returned ${albums.length} albums for "${artistName}"`
        );
        return { name: provider.name, albums };
      }
      return null;
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.warn(
          `📊 [ALBUMS] ${provider.name} failed for "${artistName}":`,
          error.message
        );
      }
      return null;
    }
  });

  try {
    const result = await Promise.any(
      providerPromises.map((p) =>
        p.then((r) => {
          if (r?.albums) return r;
          throw new Error('No result');
        })
      )
    );

    // Got a winner - abort other providers
    controller.abort();
    return result;
  } catch (_error) {
    // All providers failed
    return null;
  }
}

// Browser Connection Optimization
function warmupConnections() {
  const cdns = [
    'https://coverartarchive.org', // Cover Art Archive (redirector)
    'https://archive.org', // Actual image host after CAA redirect
    'https://is1-ssl.mzstatic.com', // Apple/iTunes image CDN
    'https://e-cdns-images.dzcdn.net', // Deezer artist images CDN
    'https://commons.wikimedia.org', // Wikidata artist images
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

// Fetch via MusicBrainz proxy (rate limiting handled on backend)
// priority: 'high' (user searches), 'normal' (displayed data), 'low' (background images)
async function rateLimitedFetch(endpoint, priority = 'normal', signal = null) {
  // Check if already aborted
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  // Small UI delay to prevent overwhelming the interface
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        resolve,
        MIN_REQUEST_INTERVAL - timeSinceLastRequest
      );
      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timeout);
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true }
        );
      }
    });
  }

  // Check again after delay
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  lastRequestTime = Date.now();

  const url = `${MUSICBRAINZ_PROXY}?endpoint=${encodeURIComponent(endpoint)}&priority=${priority}`;
  const response = await fetch(url, {
    credentials: 'same-origin',
    signal: signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

// Search for artists
async function searchArtists(query) {
  // Request aliases and tags for better popularity scoring
  const endpoint = `artist/?query=${encodeURIComponent(query)}&fmt=json&limit=20&inc=aliases+tags`;
  // HIGH priority: user-initiated search
  const data = await rateLimitedFetch(endpoint, 'high');
  return data.artists || [];
}

// Add this function to sort and prioritize search results
function prioritizeSearchResults(artists, searchQuery) {
  const query = searchQuery.toLowerCase();

  return artists
    .map((artist) => {
      let score = 0;
      const displayName = formatArtistDisplayName(artist);

      // HIGHEST priority: MusicBrainz native score (includes popularity/quality)
      // This score is typically 0-100, multiply by 10 to make it most significant
      if (artist.score) {
        score += artist.score * 10;
      }

      // Popularity indicators: Tags count (more tags = better documented = more popular)
      if (artist.tags && Array.isArray(artist.tags)) {
        const tagBonus = Math.min(artist.tags.length * 5, 50);
        score += tagBonus;
      }

      // Popularity indicator: Has Wikidata link (well-documented artists)
      // Note: We don't have this in search results, but keeping for future enhancement

      // High priority: Exact name match in Latin
      if (artist.name.toLowerCase() === query) {
        score += 100;
      }

      // High priority: Latin script name
      if (!hasNonLatinCharacters(artist.name)) {
        score += 50;
      }

      // Medium priority: Has Latin transliteration
      if (
        displayName.primary !== displayName.original &&
        !displayName.warning
      ) {
        score += 30;
      }

      // Medium priority: Name contains search query
      if (artist.name.toLowerCase().includes(query)) {
        score += 20;
      }

      // Low priority: Disambiguation contains query
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

// Convert date to year format
function formatReleaseDate(date) {
  if (!date) return '';
  return date.split('-')[0];
}

// Show placeholder when no cover art is available
function showCoverPlaceholder(imgElement) {
  if (imgElement && imgElement.parentElement) {
    imgElement.parentElement.classList.remove('animate-pulse');
    imgElement.parentElement.innerHTML = `
      <div class="w-20 h-20 bg-gray-700 rounded-lg flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="text-gray-600">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
      </div>
    `;
  }
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

      // Prioritize results to show Latin-script and better matches first
      const prioritizedArtists = prioritizeSearchResults(artists, query);
      await displayArtistResults(prioritizedArtists);
    } else {
      // Album search mode
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

  // Hide the back button since we're not coming from artist selection
  if (modalElements.backToArtists) {
    modalElements.backToArtists.style.display = 'none';
  }

  // Store releaseGroups globally
  window.currentReleaseGroups = releaseGroups;

  modalElements.albumList.className = 'space-y-3';

  const currentYear = new Date().getFullYear().toString();

  for (const rg of releaseGroups) {
    const albumEl = document.createElement('div');
    albumEl.dataset.albumIndex = releaseGroups.indexOf(rg);
    albumEl.dataset.albumId = rg.id;

    // Get artist credits for this release group
    const artistCredits = rg['artist-credit'] || [];
    const artistNames = artistCredits.map(
      (credit) => credit.name || credit.artist?.name || 'Unknown Artist'
    );
    const artistDisplay = artistNames.join(', ');

    const releaseDate = formatReleaseDate(rg['first-release-date']);
    const albumType = rg['primary-type'];
    const isNewRelease =
      rg['first-release-date'] &&
      rg['first-release-date'].startsWith(currentYear);

    albumEl.className =
      'p-4 bg-gray-800 rounded-lg hover:bg-gray-700 cursor-pointer transition-all hover:shadow-lg flex items-center gap-4 relative';

    const index = releaseGroups.indexOf(rg);

    albumEl.innerHTML = `
      ${
        isNewRelease
          ? `
        <div class="absolute top-2 right-2 flex gap-1 z-10">
          <span class="bg-red-600 text-white text-xs px-2 py-1 rounded-sm font-semibold">NEW</span>
        </div>
      `
          : ''
      }
      <div class="album-cover-container shrink-0 w-20 h-20 rounded-lg overflow-hidden flex items-center justify-center shadow-md bg-gray-700 animate-pulse">
        <img data-artist="${artistDisplay.replace(/"/g, '&quot;')}"
            data-album="${rg.title.replace(/"/g, '&quot;')}"
            data-release-group-id="${rg.id}"
            data-index="${index}"
            alt="${rg.title.replace(/"/g, '&quot;')}"
            class="w-20 h-20 object-cover rounded-lg"
            src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
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
      const existingImg = coverContainer.querySelector('img');

      // Capture the cover URL if image successfully loaded
      if (
        existingImg &&
        existingImg.src &&
        !existingImg.src.startsWith('data:') &&
        !rg.coverArt
      ) {
        rg.coverArt = existingImg.src;
      }

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

      addAlbumToList(rg);
    };

    modalElements.albumList.appendChild(albumEl);

    // Trigger cover loading via provider system
    const img = albumEl.querySelector('img');
    if (img) {
      loadAlbumCover(img, artistDisplay, rg.title, rg.id, index);
    }
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
    cancelBtn: document.getElementById('cancelManualEntry'),
  };

  // Check if all essential elements exist
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
  searchModeButtons.forEach((btn) => {
    btn.onclick = () => updateSearchMode(btn.dataset.mode);
  });

  // Populate country dropdown
  populateCountryDropdown();

  // ESC key to close (desktop only)
  document.addEventListener('keydown', (e) => {
    if (
      e.key === 'Escape' &&
      !modal.classList.contains('hidden') &&
      window.innerWidth >= 1024
    ) {
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
  document.querySelectorAll('.search-mode-btn').forEach((btn) => {
    const isActive = btn.dataset.mode === mode;
    btn.classList.toggle('active', isActive);
    btn.classList.toggle('bg-gray-700', isActive);
    btn.classList.toggle('text-white', isActive);
    btn.classList.toggle('text-gray-400', !isActive);
  });

  // Update search placeholder
  const placeholder =
    mode === 'artist' ? 'Search for an artist...' : 'Search for an album...';

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

  // Warm up connections
  warmupConnections();

  console.log('Opening modal...');
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
  reader.onload = function (event) {
    modalElements.coverPreview.innerHTML = `
      <img src="${event.target.result}" alt="Cover preview" class="w-full h-full object-cover rounded-sm">
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
    album_id: 'manual-' + window.crypto.randomUUID(), // Generate a unique ID for manual entries
    release_date: formData.get('release_date') || '',
    country: formData.get('country') || '',
    genre_1: '',
    genre_2: '',
    comments: '',
  };

  // Handle cover art if uploaded
  const coverArtFile = formData.get('cover_art');
  if (coverArtFile && coverArtFile.size > 0) {
    showToast('Processing cover art...', 'info');

    try {
      // Resize image to 256x256 using Canvas API
      const img = new Image();
      const reader = new FileReader();

      reader.onload = function (e) {
        img.onload = async function () {
          // Create canvas for resizing
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          // Calculate dimensions to maintain aspect ratio (fit inside 256x256)
          let width = img.width;
          let height = img.height;
          const maxSize = 256;

          if (width > height) {
            if (width > maxSize) {
              height = (height * maxSize) / width;
              width = maxSize;
            }
          } else {
            if (height > maxSize) {
              width = (width * maxSize) / height;
              height = maxSize;
            }
          }

          canvas.width = width;
          canvas.height = height;

          // Draw resized image
          ctx.drawImage(img, 0, 0, width, height);

          // Convert to base64 JPEG (quality 0.85)
          const resizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
          album.cover_image = resizedDataUrl.split(',')[1];
          album.cover_image_format = 'JPEG';

          // Add to list
          await finishManualAdd(album);
        };

        img.onerror = function () {
          showToast('Error processing cover art', 'error');
        };

        img.src = e.target.result;
      };

      reader.onerror = function () {
        showToast('Error reading cover art file', 'error');
      };

      reader.readAsDataURL(coverArtFile);
    } catch (_error) {
      showToast('Error processing cover art', 'error');
    }
  } else {
    // No cover art, add directly
    await finishManualAdd(album);
  }
}

async function finishManualAdd(album) {
  try {
    // Get current list data
    const currentListData = window.getListData(window.currentList);
    if (!currentListData) {
      showToast('No list selected', 'error');
      return;
    }

    // Check for duplicate before adding
    if (isAlbumInList(album, currentListData)) {
      closeAddAlbumModal();
      showToast(`"${album.album}" is already in this list`, 'error');
      return;
    }

    // Check for similar existing albums before adding
    const similarCheck = await checkAndPromptSimilar(album);

    if (similarCheck.action === 'cancelled') {
      // User cancelled - don't close modal, let them continue editing
      return;
    }

    let albumToAdd = album;

    if (similarCheck.action === 'use_existing' && similarCheck.album) {
      // User wants to use the existing canonical album
      // Use the canonical album_id but keep the user's cover art if they uploaded one
      albumToAdd = {
        ...album,
        album_id: similarCheck.album.album_id,
        artist: similarCheck.album.artist,
        album: similarCheck.album.album,
      };
      // If the manual album had no cover but canonical has one, the server will use canonical's cover

      // Check if this canonical album is already in the list
      if (isAlbumInList(albumToAdd, currentListData)) {
        // Album already in list, but still merge the better metadata to canonical
        try {
          await fetch('/api/albums/merge-metadata', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              album_id: albumToAdd.album_id,
              artist: album.artist,
              album: album.album,
              cover_image: album.cover_image,
              cover_image_format: album.cover_image_format,
              tracks: album.tracks,
            }),
          });
        } catch (err) {
          console.warn('Failed to merge album metadata:', err);
        }

        closeAddAlbumModal();
        showToast(
          `"${albumToAdd.album}" is already in this list (metadata updated)`,
          'info'
        );

        // Refresh list to show updated cover
        window.selectList(window.currentList);
        return;
      }
    }

    // Add to current list
    currentListData.push(albumToAdd);
    window.setListData(window.currentList, currentListData);

    if (!Array.isArray(albumToAdd.tracks) || albumToAdd.tracks.length === 0) {
      try {
        await window.fetchTracksForAlbum(albumToAdd);
      } catch (_err) {
        // Auto track fetch failed - not critical
      }
    }

    // Save to server
    await window.saveList(window.currentList, currentListData);

    // Refresh the list view
    window.selectList(window.currentList);

    // Close modal
    closeAddAlbumModal();

    if (similarCheck.action === 'use_existing') {
      showToast(
        `Added "${albumToAdd.album}" by ${albumToAdd.artist} (using existing album)`
      );
    } else {
      showToast(
        `Added "${albumToAdd.album}" by ${albumToAdd.artist} to the list`
      );
    }
  } catch (_error) {
    showToast('Error adding album to list', 'error');

    // Remove from list on error
    const currentListData = window.getListData(window.currentList);
    if (currentListData) {
      currentListData.pop();
      window.setListData(window.currentList, currentListData);
    }
  }
}

function closeAddAlbumModal() {
  if (currentLoadingController) {
    currentLoadingController.abort();
    currentLoadingController = null;
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
  document.querySelectorAll('.search-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === searchMode);
    btn.classList.toggle('bg-gray-700', btn.dataset.mode === searchMode);
    btn.classList.toggle('text-white', btn.dataset.mode === searchMode);
    btn.classList.toggle('text-gray-400', btn.dataset.mode !== searchMode);
  });

  // Update placeholder to match current mode
  const placeholder =
    searchMode === 'artist'
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

// Display artist results with lazy-loaded images
async function displayArtistResults(artists) {
  // Abort any previous artist image searches
  if (artistImageAbortController) {
    artistImageAbortController.abort();
  }
  artistImageAbortController = new AbortController();
  const imageSignal = artistImageAbortController.signal;

  modalElements.artistList.innerHTML = '';

  // Desktop now uses the same list-style layout as mobile
  modalElements.artistList.className = 'space-y-3';

  // Render artists immediately with placeholders, then lazy-load images
  for (const artist of artists) {
    const displayName = formatArtistDisplayName(artist);
    const artistEl = document.createElement('div');
    artistEl.className =
      'p-4 bg-gray-800 rounded-lg hover:bg-gray-700 cursor-pointer transition-colors flex items-center gap-4';

    // Build disambiguation/secondary text
    let secondaryText = '';
    if (displayName.secondary) {
      secondaryText = displayName.secondary;
    }

    // Add any additional disambiguation that's not already shown
    if (
      artist.disambiguation &&
      artist.disambiguation !== displayName.secondary &&
      artist.disambiguation !== displayName.primary
    ) {
      secondaryText += secondaryText
        ? ` • ${artist.disambiguation}`
        : artist.disambiguation;
    }

    // Resolve country code to full name (async but don't block rendering)
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

    // Start with placeholder image
    artistEl.innerHTML = `
      <div class="artist-image-container shrink-0">
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
      <div class="shrink-0">
        <i class="fas fa-chevron-right text-gray-500"></i>
      </div>
    `;

    // Store the original artist data with enhanced display info
    const enhancedArtist = {
      ...artist,
      _displayName: displayName,
    };

    artistEl.onclick = () => selectArtist(enhancedArtist);

    modalElements.artistList.appendChild(artistEl);

    // Lazy-load artist image using parallel provider racing
    const searchName =
      displayName.original && !displayName.warning
        ? displayName.primary
        : artist.name;
    searchArtistImageRacing(searchName, artist.id, imageSignal)
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
          // No image found, remove pulse animation
          const imageContainer = artistEl.querySelector(
            '.artist-image-container div'
          );
          if (imageContainer) {
            imageContainer.classList.remove('animate-pulse');
          }
        }
      })
      .catch(() => {
        // Error loading image, remove pulse animation
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
  // Abort any ongoing artist image searches - user has made their selection
  if (artistImageAbortController) {
    artistImageAbortController.abort();
    artistImageAbortController = null;
  }

  // Use the enhanced artist with display name
  currentArtist = artist._displayName
    ? {
        ...artist,
        name: artist._displayName.primary, // Use the Latin name for album displays
        originalName: artist.name, // Keep the original for API calls
      }
    : artist;

  showLoading();

  currentLoadingController = new AbortController();

  try {
    // Race all album providers - first to return wins
    const result = await searchArtistAlbumsRacing(
      currentArtist.name,
      artist.id
    );

    if (!result || result.albums.length === 0) {
      showToast('No albums or EPs found for this artist', 'error');
      showAlbumResults();
      modalElements.albumList.innerHTML =
        '<p class="col-span-full text-center text-gray-500">No albums or EPs found.</p>';
      return;
    }

    // Display albums - covers will be fetched via coverArtProviders
    displayAlbumResultsWithProvider(result.albums, result.name);
  } catch (error) {
    if (error.name === 'AbortError') {
      // Album loading cancelled - expected behavior
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

  // Handle special MusicBrainz codes not in RestCountries
  const specialCodes = {
    XW: 'Worldwide',
    XE: 'Europe',
    XU: 'Unknown',
  };

  if (specialCodes[countryCode]) {
    return specialCodes[countryCode];
  }

  try {
    // Use RestCountries API to get country info
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

    // Try different name variations to match against our countries list
    const namesToTry = [
      countryData.name.common,
      countryData.name.official,
      // Also check alternative names
      ...(countryData.altSpellings || []),
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

    // Check if availableCountries is loaded
    if (
      !window.availableCountries ||
      !Array.isArray(window.availableCountries)
    ) {
      console.warn('availableCountries not loaded yet, returning country code');
      return countryData.name.common;
    }

    // Find the first name that matches our countries list
    for (const name of namesToTry) {
      if (name && window.availableCountries.includes(name)) {
        console.debug(`Resolved ${countryCode} to ${name}`);
        return name;
      }
    }

    // If no exact match, try case-insensitive partial matching
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

// Get combined country names for multiple artists
async function getCombinedArtistCountries(artistCredits) {
  const countries = [];

  for (const credit of artistCredits) {
    const id = credit.artist?.id;
    if (!id) continue;

    try {
      const endpoint = `artist/${id}?fmt=json`;
      // NORMAL priority: needed for display but not critical
      const artistData = await rateLimitedFetch(endpoint, 'normal');
      if (artistData && artistData.country) {
        const name = await resolveCountryCode(artistData.country);
        if (name && !countries.includes(name)) {
          countries.push(name);
        }
      }
    } catch (_err) {
      // Error fetching artist country - non-critical
    }
  }

  return countries.join(' / ');
}

async function searchAlbums(query) {
  const endpoint = `release-group/?query=${encodeURIComponent(query)}&type=album|ep&fmt=json&limit=20`;
  // HIGH priority: user-initiated album search
  const data = await rateLimitedFetch(endpoint, 'high');

  let releaseGroups = data['release-groups'] || [];

  // Filter and sort similar to getArtistReleaseGroups
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

  // Sort by relevance (MusicBrainz already does this) and then by date
  releaseGroups.sort((a, b) => {
    const dateA = a['first-release-date'] || '0000';
    const dateB = b['first-release-date'] || '0000';
    return dateB.localeCompare(dateA);
  });

  return releaseGroups;
}

// Display albums from provider system - handles albums with/without coverUrl
function displayAlbumResultsWithProvider(albums, providerName) {
  showAlbumResults();
  modalElements.albumList.innerHTML = '';

  // Convert to format compatible with addAlbumToList
  const normalizedAlbums = albums.map((album, index) => ({
    id: album.releaseGroupId || `${providerName}-${index}`,
    title: album.title,
    'first-release-date': album.releaseDate,
    'primary-type': album.type,
    coverArt: album.coverUrl || null,
    _source: album.source,
    _artistName: album.artistName,
  }));

  // Store globally for addAlbumToList
  window.currentReleaseGroups = normalizedAlbums;

  modalElements.albumList.className = 'space-y-3';

  const currentYear = new Date().getFullYear().toString();

  normalizedAlbums.forEach((album, index) => {
    const albumEl = document.createElement('div');
    albumEl.dataset.albumIndex = index;
    albumEl.dataset.albumId = album.id;

    const releaseDate = formatReleaseDate(album['first-release-date']);
    const albumType = album['primary-type'];
    const isNewRelease =
      album['first-release-date'] &&
      album['first-release-date'].startsWith(currentYear);

    albumEl.className =
      'p-4 bg-gray-800 rounded-lg hover:bg-gray-700 cursor-pointer transition-all hover:shadow-lg flex items-center gap-4 relative';

    // If we have a coverUrl from the provider, show it directly
    const hasCover = !!album.coverArt;
    const coverHtml = hasCover
      ? `<img src="${album.coverArt}" 
             alt="${album.title.replace(/"/g, '&quot;')}"
             class="w-20 h-20 object-cover rounded-lg"
             onerror="this.onerror=null; this.parentElement.classList.add('animate-pulse'); window.loadAlbumCoverFallback && window.loadAlbumCoverFallback(this, '${currentArtist.name.replace(/'/g, "\\'")}', '${album.title.replace(/'/g, "\\'")}', '${album.id}', ${index})">`
      : `<img data-artist="${currentArtist.name.replace(/"/g, '&quot;')}"
             data-album="${album.title.replace(/"/g, '&quot;')}"
             data-release-group-id="${album.id}"
             data-index="${index}"
             alt="${album.title.replace(/"/g, '&quot;')}"
             class="w-20 h-20 object-cover rounded-lg"
             src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">`;

    albumEl.innerHTML = `
      ${
        isNewRelease
          ? `
        <div class="absolute top-2 right-2 flex gap-1 z-10">
          <span class="bg-red-600 text-white text-xs px-2 py-1 rounded-sm font-semibold">NEW</span>
        </div>
      `
          : ''
      }
      <div class="album-cover-container shrink-0 w-20 h-20 rounded-lg overflow-hidden flex items-center justify-center shadow-md ${hasCover ? '' : 'bg-gray-700 animate-pulse'}">
        ${coverHtml}
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-semibold text-white truncate text-lg" title="${album.title}">${album.title}</div>
        <div class="text-sm text-gray-400 mt-1">${releaseDate} • ${albumType}</div>
        <div class="text-xs text-gray-500 mt-1">${currentArtist.name}</div>
      </div>
    `;

    // Click handler
    albumEl.onclick = async () => {
      const coverContainer = albumEl.querySelector('.album-cover-container');

      coverContainer.innerHTML = `
        <div class="w-20 h-20 bg-gray-700 rounded-lg flex items-center justify-center">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      `;

      addAlbumToList(album);
    };

    modalElements.albumList.appendChild(albumEl);

    // If no cover from provider, use cover art provider system
    if (!hasCover) {
      const img = albumEl.querySelector('img');
      if (img) {
        loadAlbumCover(img, currentArtist.name, album.title, album.id, index);
      }
    }
  });

  console.log(
    `📊 [ALBUMS] Displayed ${albums.length} albums from ${providerName}`
  );
}

// Fallback cover loader for when provider cover fails
window.loadAlbumCoverFallback = function (
  imgElement,
  artistName,
  albumTitle,
  albumId,
  index
) {
  loadAlbumCover(imgElement, artistName, albumTitle, albumId, index);
};

async function addAlbumToList(releaseGroup) {
  // Show initial loading message
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

  // Enhanced cover art retrieval
  let coverArtUrl = releaseGroup.coverArt;

  // If not in the data structure, check if it's already loaded in the DOM
  if (!coverArtUrl) {
    // Find the album element in the list
    const albumElements = document.querySelectorAll('[data-album-index]');
    for (const el of albumElements) {
      if (
        parseInt(el.dataset.albumIndex) ===
        window.currentReleaseGroups.indexOf(releaseGroup)
      ) {
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

  // Process cover art if found (already loaded via provider system)
  if (coverArtUrl) {
    try {
      // Use the image proxy endpoint to fetch external images
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
      // Error fetching cover art - will proceed without
      addAlbumToCurrentList(album);
    }
  } else {
    // No cover art available
    addAlbumToCurrentList(album);
  }
}

async function addAlbumToCurrentList(album) {
  try {
    // Get current list data
    const currentListData = window.getListData(window.currentList);
    if (!currentListData) {
      showToast('No list selected', 'error');
      return;
    }

    // Check for duplicate before adding
    if (isAlbumInList(album, currentListData)) {
      closeAddAlbumModal();
      showToast(`"${album.album}" is already in this list`, 'error');
      return;
    }

    // Check for similar albums in the database (fuzzy duplicate detection)
    const similarCheck = await checkAndPromptSimilar(album);

    if (similarCheck.action === 'cancelled') {
      // User cancelled - don't add anything
      return;
    }

    if (similarCheck.action === 'use_existing' && similarCheck.album) {
      // User confirmed this is the same album - use the existing album's ID
      // but keep the new metadata that might be better (cover, etc.)
      album.album_id = similarCheck.album.album_id;
      album.artist = similarCheck.album.artist;
      album.album = similarCheck.album.album;

      // Check if this canonical album is already in the list
      if (isAlbumInList(album, currentListData)) {
        // Album already in list, but still merge the better metadata to canonical
        try {
          await fetch('/api/albums/merge-metadata', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              album_id: album.album_id,
              artist: album.artist,
              album: album.album,
              cover_image: album.cover_image,
              cover_image_format: album.cover_image_format,
              tracks: album.tracks,
            }),
          });
        } catch (err) {
          console.warn('Failed to merge album metadata:', err);
        }

        closeAddAlbumModal();
        showToast(
          `"${album.album}" is already in this list (metadata updated)`,
          'info'
        );

        // Refresh list to show updated cover
        window.selectList(window.currentList);
        return;
      }
    }
    // If action === 'add_new', proceed with the new album as-is

    currentListData.push(album);
    window.setListData(window.currentList, currentListData);

    if (!Array.isArray(album.tracks) || album.tracks.length === 0) {
      try {
        await window.fetchTracksForAlbum(album);
      } catch (_err) {
        // Auto track fetch failed - not critical
      }
    }

    await window.saveList(window.currentList, currentListData);

    window.selectList(window.currentList);

    closeAddAlbumModal();

    showToast(`Added "${album.album}" by ${album.artist} to the list`);
  } catch (_error) {
    showToast('Error adding album to list', 'error');

    const currentListData = window.getListData(window.currentList);
    if (currentListData) {
      currentListData.pop();
      window.setListData(window.currentList, currentListData);
    }
  }
}

function hasNonLatinCharacters(str) {
  if (!str) return false;
  // Check if more than 50% of alphabetic characters are non-Latin
  const alphaChars = str.match(/\p{L}/gu) || [];
  const nonLatinChars = str.match(/[^\u0020-\u024F\u1E00-\u1EFF]/gu) || [];
  return (
    alphaChars.length > 0 && nonLatinChars.length / alphaChars.length > 0.5
  );
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

// Helper to format artist display name
function formatArtistDisplayName(artist) {
  const hasNonLatin = hasNonLatinCharacters(artist.name);

  if (!hasNonLatin) {
    // Name is already in Latin script
    return {
      primary: artist.name,
      secondary: artist.disambiguation || null,
      original: artist.name,
    };
  }

  // Try to extract Latin version using multiple strategies
  const latinName = extractLatinName(artist);

  if (latinName) {
    // Show Latin name as primary, original as secondary
    return {
      primary: latinName,
      secondary: artist.name,
      original: artist.name,
    };
  } else {
    // No Latin version found, show as-is with warning
    return {
      primary: artist.name,
      secondary: 'Non-Latin script',
      original: artist.name,
      warning: true,
    };
  }
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize on pages that have the add album feature
  const isAuthPage = window.location.pathname.match(
    /\/(login|register|forgot)/
  );
  if (!isAuthPage) {
    // Warm up CDN connections early for faster first-image load
    warmupConnections();
    initializeAddAlbumFeature();
  }
});

// Export for use in other modules
export { searchArtistImageRacing };
