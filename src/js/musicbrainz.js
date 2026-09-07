// MusicBrainz API integration
import { isMobileViewport } from './utils/viewport.js';
import { createModal } from './modules/modal-factory.js';
import { isAlbumInList, showToast } from './modules/utils.js';
import { escapeHtml, escapeHtmlAttr } from './modules/html-utils.js';
import { checkAndPromptSimilar } from './modules/similar-album-modal.js';
import { createAlbumListAdder } from './modules/album-list-add.js';
import { createArtistDiscography } from './modules/artist-discography.js';
import { normalizeForExternalApi } from './modules/normalization.js';
import {
  createAlbumCoverLoader,
  createAlbumCoverObserver,
} from './modules/album-cover-loader.js';
import {
  hasNonLatinCharacters,
  formatArtistDisplayName,
} from './modules/musicbrainz-artist-name.js';
import {
  getCurrentListId,
  getListData,
  setListData,
  isViewingRecommendations,
  getCurrentRecommendationsYear,
  getAvailableCountries,
} from './modules/app-state.js';
import { apiCall } from './modules/api-client.js';
import {
  saveList,
  getListSaveState,
  displayAlbums,
  fetchAndDisplayPlaycounts,
  selectRecommendations,
} from './modules/list-actions.js';
import { showReasoningModal } from './modules/modals.js';
import {
  createArtistImageLoader,
  qualifiedArtistCandidates,
  firstWorkingArtistImage,
} from './modules/artist-image-loader.js';

const MUSICBRAINZ_PROXY = '/api/proxy/musicbrainz'; // Using our proxy
const WIKIDATA_PROXY = '/api/proxy/wikidata'; // Using our proxy

// ============================================================================
// SHARED HELPERS
// ============================================================================

/**
 * Merge album metadata to the canonical albums table (fire-and-forget).
 * @param {Object} album - Album with album_id, artist, album, cover_image, cover_image_format, tracks
 */
async function mergeMetadataToCanonical(album) {
  try {
    await apiCall('/api/albums/merge-metadata', {
      method: 'POST',
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
}

/**
 * Resolve an album against similar/canonical records and deduplicate.
 *
 * Returns `{ resolved, cancelled, alreadyInList }` where `resolved` is the
 * album object to add (with remapped IDs if user chose "use existing"),
 * `cancelled` is true when the user dismisses the modal, and
 * `alreadyInList` is true when the canonical album is already present
 * (metadata merge is done automatically in that case).
 *
 * @param {Object} album - Raw album to add
 * @param {Array} currentListData - Current list albums
 * @returns {Promise<{resolved: Object|null, cancelled: boolean, alreadyInList: boolean, usedExisting: boolean}>}
 */
async function resolveAndDedup(album, currentListData) {
  // Exact duplicate check
  if (isAlbumInList(album, currentListData)) {
    return {
      resolved: null,
      cancelled: false,
      alreadyInList: true,
      usedExisting: false,
    };
  }

  // Fuzzy similar-album check
  const similarCheck = await checkAndPromptSimilar(album);

  if (similarCheck.action === 'cancelled') {
    return {
      resolved: null,
      cancelled: true,
      alreadyInList: false,
      usedExisting: false,
    };
  }

  let resolved = album;
  let usedExisting = false;

  if (similarCheck.action === 'use_existing' && similarCheck.album) {
    // Remap to canonical album identity
    resolved = {
      ...album,
      album_id: similarCheck.album.album_id,
      artist: similarCheck.album.artist,
      album: similarCheck.album.album,
    };
    usedExisting = true;

    // Canonical album may already be in list — merge metadata and bail
    if (isAlbumInList(resolved, currentListData)) {
      await mergeMetadataToCanonical({
        ...resolved,
        cover_image: album.cover_image,
        cover_image_format: album.cover_image_format,
        tracks: album.tracks,
      });
      return {
        resolved: null,
        cancelled: false,
        alreadyInList: true,
        usedExisting: true,
      };
    }
  }

  return { resolved, cancelled: false, alreadyInList: false, usedExisting };
}

/**
 * Normalise a MusicBrainz partial date to a full YYYY-MM-DD string that can
 * be compared lexicographically. Year-only dates map to Dec-31, year-month
 * dates map to the last day of that month, and full dates pass through.
 *
 * @param {string} dateStr - A date in "YYYY", "YYYY-MM", or "YYYY-MM-DD" format
 * @returns {string} A full "YYYY-MM-DD" string
 */
function toComparableDate(dateStr) {
  if (dateStr.length === 4) {
    return `${dateStr}-12-31`;
  }
  if (dateStr.length === 7) {
    const [year, month] = dateStr.split('-');
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    return `${dateStr}-${lastDay.toString().padStart(2, '0')}`;
  }
  return dateStr;
}

let searchMode = 'artist';

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
    search: async (artistName, _artistId, signal, excluded) => {
      // Normalize artist name for better API matching (strips diacritics)
      const searchQuery = normalizeForExternalApi(artistName);
      const url = `/api/proxy/deezer/artist?q=${encodeURIComponent(searchQuery)}`;

      const response = await fetch(url, { signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Deezer HTTP ${response.status}`);

      const data = await response.json();
      if (data?.error) throw new Error('Deezer provider error');
      if (!Array.isArray(data.data)) throw new Error('Invalid Deezer response');
      const candidates = qualifiedArtistCandidates(
        artistName,
        data.data,
        (a) => a.name,
        (a) => a.id
      );
      return firstWorkingArtistImage(
        candidates
          .flatMap((a) => [
            a.picture_medium,
            a.picture_small,
            a.picture_big,
            a.picture_xl,
          ])
          .filter((url) => !excluded.has(url)),
        signal
      );
    },
  },

  // iTunes/Apple Music - good coverage, high quality images
  {
    name: 'iTunes',
    search: async (artistName, _artistId, signal, excluded) => {
      // Normalize artist name for better API matching (strips diacritics)
      const searchTerm = normalizeForExternalApi(artistName);
      const url = `/api/proxy/itunes?term=${encodeURIComponent(searchTerm)}&limit=10`;

      const response = await fetch(url, { signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error(`iTunes HTTP ${response.status}`);

      const data = await response.json();
      if (data?.error || data?.errorMessage)
        throw new Error('iTunes provider error');
      if (!Array.isArray(data.results))
        throw new Error('Invalid iTunes response');
      const candidates = qualifiedArtistCandidates(
        artistName,
        data.results,
        (a) => a.artistName,
        (a) => a.artistId
      );
      // Keep album artwork as the fallback, with the original small size available.
      return firstWorkingArtistImage(
        candidates
          .flatMap((a) =>
            a.artworkUrl100
              ? [
                  a.artworkUrl100.replace(/\/\d+x\d+bb\./, '/300x300bb.'),
                  a.artworkUrl100,
                ]
              : []
          )
          .filter((url) => !excluded.has(url)),
        signal
      );
    },
  },

  // Wikidata via MusicBrainz - slower but good for notable artists.
  // Marked `lastResort` so it only runs when Deezer/iTunes both miss: it hits
  // the rate-limited MusicBrainz queue, which we reserve for the album-list fetch.
  {
    name: 'Wikidata',
    lastResort: true,
    search: async (artistName, artistId, signal, excluded) => {
      if (!artistId) return null;

      // Get Wikidata ID from MusicBrainz
      const endpoint = `artist/${artistId}?inc=url-rels&fmt=json`;
      const mbData = await rateLimitedFetch(endpoint, 'low', signal);

      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (mbData?.error) throw new Error('MusicBrainz provider error');
      if (!Array.isArray(mbData.relations))
        throw new Error('Invalid MusicBrainz artist response');

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

      if (!wdResponse.ok) throw new Error(`Wikidata HTTP ${wdResponse.status}`);

      const wdData = await wdResponse.json();
      if (wdData?.error) throw new Error('Wikidata provider error');
      if (!wdData.claims || typeof wdData.claims !== 'object')
        throw new Error('Invalid Wikidata response');
      if (!wdData.claims?.P18?.[0]?.mainsnak?.datavalue?.value) return null;

      const filename = wdData.claims.P18[0].mainsnak.datavalue.value;
      const encodedFilename = encodeURIComponent(filename.replace(/ /g, '_'));
      const imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodedFilename}?width=500`;

      return firstWorkingArtistImage(
        [imageUrl.replace('width=500', 'width=200'), imageUrl].filter(
          (url) => !excluded.has(url)
        ),
        signal
      );
    },
  },
];

const artistImageLoader = createArtistImageLoader(artistImageProviders);
const searchArtistImageRacing = artistImageLoader.search;

// =============================================================================
// COVER ART PROVIDER SYSTEM
// CAA starts immediately; iTunes is hedged after 200ms. First verified cover wins.
// =============================================================================

const albumCoverLoader = createAlbumCoverLoader();

const albumCoverRenders = new WeakMap();

// A verified URL can still require a fresh network request in the actual row.
function loadAlbumCover(
  imgElement,
  artistName,
  albumTitle,
  releaseGroupId,
  album,
  request
) {
  let active = true;
  let clearRender = () => {};
  const cancel = () => {
    active = false;
    clearRender();
    request.signal.removeEventListener('abort', cancel);
    if (albumCoverRenders.get(imgElement) === cancel)
      albumCoverRenders.delete(imgElement);
  };
  const identity = {
    artist: artistName,
    title: albumTitle,
    id: releaseGroupId,
  };
  const isCurrent = () =>
    active &&
    !request.signal.aborted &&
    isSearchRequestCurrent(request) &&
    imgElement?.isConnected &&
    imgElement.parentElement;
  if (!isCurrent()) return;
  albumCoverRenders.get(imgElement)?.();
  albumCoverRenders.set(imgElement, cancel);
  request.signal.addEventListener('abort', cancel, { once: true });
  const attempt = async (excluded = new Set()) => {
    try {
      const coverUrl =
        (!excluded.size &&
          (album.coverArt || albumCoverLoader.peek(identity))) ||
        (await albumCoverLoader.search(identity, request.signal, excluded));

      if (!isCurrent()) return cancel();
      if (coverUrl && imgElement && imgElement.parentElement) {
        // Store the cover URL for later use
        album.coverArt = coverUrl;
        let settled = false;
        const finish = (loaded) => {
          if (settled) return;
          clearRender();
          if (!isCurrent()) return cancel();
          if (loaded) {
            albumCoverLoader.seed(identity, coverUrl);
            return cancel();
          }
          imgElement.removeAttribute('src');
          albumCoverLoader.evict(identity);
          delete album.coverArt;
          if (excluded.size) {
            showCoverPlaceholder(imgElement);
            return cancel();
          }
          attempt(new Set([coverUrl]));
        };
        const timer = setTimeout(() => finish(false), 3000);
        clearRender = () => {
          settled = true;
          clearTimeout(timer);
          imgElement.onload = null;
          imgElement.onerror = null;
          clearRender = () => {};
        };
        imgElement.onload = () => finish(true);
        imgElement.onerror = () => finish(false);
        // Remove loading state and set the verified image
        imgElement.parentElement.classList.remove('animate-pulse');
        imgElement.src = coverUrl;
      } else {
        // No provider found a working image
        showCoverPlaceholder(imgElement);
        cancel();
      }
    } catch (error) {
      if (!isCurrent()) return cancel();
      console.warn(
        `📊 [COVER] Failed to load cover for "${albumTitle}":`,
        error.message
      );
      showCoverPlaceholder(imgElement);
      cancel();
    }
  };
  return attempt();
}

// =============================================================================
// LAZY IMAGE LOADING
// Defer artist-image and album-cover fetches until the row nears the viewport.
// Avoids firing dozens-to-hundreds of image/API requests (and, for artist
// images, rate-limited MusicBrainz queue traffic) for rows never scrolled to.
// =============================================================================

let albumCoverObserver = null;
let artistImageObserver = null;

/**
 * Create a one-shot lazy loader backed by an IntersectionObserver.
 * `loadFn(ctx)` runs once, the first time the observed element nears the root.
 * Falls back to eager loading where IntersectionObserver is unavailable.
 *
 * @param {(ctx: any) => void} loadFn - Called once per element when it nears view
 * @param {Element|null} root - Scroll container to observe within (null = viewport)
 * @returns {{ observe: (el: Element, ctx: any) => void, disconnect: () => void }}
 */
function createLazyLoader(loadFn, root = null) {
  if (typeof IntersectionObserver === 'undefined') {
    return { observe: (_el, ctx) => loadFn(ctx), disconnect() {} };
  }

  const ctxByEl = new WeakMap();
  const observer = new IntersectionObserver(
    (entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        obs.unobserve(entry.target);
        const ctx = ctxByEl.get(entry.target);
        ctxByEl.delete(entry.target);
        if (ctx) loadFn(ctx);
      }
    },
    { root, rootMargin: '300px 0px' }
  );

  return {
    observe(el, ctx) {
      ctxByEl.set(el, ctx);
      observer.observe(el);
    },
    disconnect() {
      observer.disconnect();
    },
  };
}

/** Scroll container that wraps the artist/album result lists. */
function resultsScrollRoot() {
  return (
    modalElements.albumResults?.parentElement ||
    modalElements.artistResults?.parentElement ||
    null
  );
}

/** Replace the album-cover lazy loader, disconnecting any previous one. */
function resetAlbumCoverObserver() {
  if (albumCoverObserver) albumCoverObserver.disconnect();
  albumCoverObserver = createAlbumCoverObserver(
    (ctx) =>
      loadAlbumCover(
        ctx.img,
        ctx.artistName,
        ctx.albumTitle,
        ctx.releaseGroupId,
        ctx.album,
        ctx.request
      ),
    (ctx) =>
      ctx.album.coverArt ||
      albumCoverLoader.peek({
        artist: ctx.artistName,
        title: ctx.albumTitle,
        id: ctx.releaseGroupId,
      }),
    resultsScrollRoot()
  );
}

/** Replace the artist-image lazy loader, disconnecting any previous one. */
function resetArtistImageObserver() {
  if (artistImageObserver) artistImageObserver.disconnect();
  artistImageObserver = createLazyLoader(
    loadArtistImageInto,
    resultsScrollRoot()
  );
}

/** Stop all pending lazy image work (e.g. when the modal closes). */
function disconnectImageObservers() {
  if (albumCoverObserver) albumCoverObserver.disconnect();
  if (artistImageObserver) artistImageObserver.disconnect();
  albumCoverObserver = null;
  artistImageObserver = null;
}

// Modal management
let currentArtist = null;
let modal = null;
let modalElements = {};
let addAlbumController = null;
let currentLoadingController = null;
let currentReleaseGroups = [];
let albumModalSession = 0;
let albumListAdder = null;
let currentArtistResults = [];
let searchEmptyHTML = '';

function captureAlbumAddContext() {
  const listId = getCurrentListId();
  const session = albumModalSession;
  const request = currentLoadingController;
  return {
    listId,
    isCurrent: () =>
      session === albumModalSession &&
      request === currentLoadingController &&
      getCurrentListId() === listId &&
      !modal.classList.contains('hidden'),
  };
}

function persistAlbumAddition(album, context) {
  albumListAdder ||= createAlbumListAdder({
    getCurrentListId,
    getListData,
    setListData,
    resolveAndDedup,
    isAlbumInList,
    saveList,
    getListSaveState,
    apiCall,
    displayAlbums,
    closeAddAlbumModal,
    showToast,
    fetchAndDisplayPlaycounts,
  });
  return albumListAdder.add(album, context);
}
// A request owns its results until the next search, selection or view change.
function invalidateSearchWork() {
  currentLoadingController?.abort();
  currentLoadingController = null;
  artistImageAbortController?.abort();
  artistImageAbortController = null;
  disconnectImageObservers();
  currentArtist = null;
  currentReleaseGroups = [];
}

function beginSearchRequest() {
  invalidateSearchWork();
  currentLoadingController = new AbortController();
  return currentLoadingController;
}

function isSearchRequestCurrent(request) {
  return (
    !!request && request === currentLoadingController && !request.signal.aborted
  );
}

// MusicBrainz is the authoritative metadata source; covers load independently.
const getArtistDiscography = createArtistDiscography((...args) =>
  rateLimitedFetch(...args)
);
async function searchArtistAlbums(artistName, artistId, signal, offset = 0) {
  const { groups, nextOffset } = await getArtistDiscography(
    artistId,
    signal,
    offset
  );
  const todayStr = new Date().toISOString().split('T')[0];
  const albums = groups
    .filter((rg) => {
      const primaryType = rg['primary-type'];
      const releaseDate = rg['first-release-date'];
      return (
        (primaryType === 'Album' || primaryType === 'EP') &&
        (rg['secondary-types'] || []).length === 0 &&
        releaseDate &&
        toComparableDate(releaseDate) <= todayStr
      );
    })
    .map((rg) => ({
      title: rg.title,
      releaseDate: rg['first-release-date'],
      type: rg['primary-type'],
      releaseGroupId: rg.id,
      artistName,
      source: 'MusicBrainz',
    }));
  albums.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  return { name: 'MusicBrainz', albums, nextOffset };
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

  const url = `${MUSICBRAINZ_PROXY}?endpoint=${encodeURIComponent(endpoint)}&priority=${priority}`;
  const response = await fetch(url, {
    credentials: 'same-origin',
    signal: signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  if (!data || typeof data !== 'object' || data.error || data.errors) {
    throw new Error('Invalid MusicBrainz response');
  }
  Object.defineProperty(data, '_providerCache', {
    value: response.headers?.get('X-Provider-Cache'),
  });
  return data;
}

// Search for artists
async function searchArtists(query, signal) {
  // Request aliases and tags for better popularity scoring
  const endpoint = `artist/?query=${encodeURIComponent(query)}&fmt=json&limit=20&inc=aliases+tags`;
  // HIGH priority: user-initiated search
  const data = await rateLimitedFetch(endpoint, 'high', signal);
  if (!Array.isArray(data.artists)) {
    throw new Error('Invalid MusicBrainz artist response');
  }
  return data.artists;
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
  const mode = searchMode;
  clearSearchResults();
  if (!query) {
    showToast(
      `Please enter ${searchMode === 'artist' ? 'an artist' : 'an album'} name`,
      'error'
    );
    return;
  }

  const request = beginSearchRequest();
  showLoading();

  try {
    if (mode === 'artist') {
      const artists = await searchArtists(query, request.signal);
      if (!isSearchRequestCurrent(request)) return;

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
      const albums = await searchAlbums(query, request.signal);
      if (!isSearchRequestCurrent(request)) return;

      if (albums.length === 0) {
        modalElements.searchLoading.classList.add('hidden');
        modalElements.searchEmpty.classList.remove('hidden');
        modalElements.searchEmpty.innerHTML =
          '<p>No albums found. Try a different search.</p>';
        return;
      }

      await displayDirectAlbumResults(albums, request);
    }
  } catch (error) {
    if (!isSearchRequestCurrent(request) || error.name === 'AbortError') return;
    showToast(`Error searching ${mode}s`, 'error');
    modalElements.searchLoading.classList.add('hidden');
    modalElements.searchEmpty.classList.remove('hidden');
    modalElements.searchEmpty.textContent = `Error searching ${mode}s. Try again.`;
  }
}

async function displayDirectAlbumResults(releaseGroups, request) {
  if (!isSearchRequestCurrent(request)) return;
  showAlbumResults();
  modalElements.albumList.innerHTML = '';

  // Hide the back button since we're not coming from artist selection
  if (modalElements.backToArtists) {
    modalElements.backToArtists.style.display = 'none';
  }

  currentReleaseGroups = releaseGroups;

  resetAlbumCoverObserver();

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
        <img data-artist="${escapeHtmlAttr(artistDisplay)}"
            data-album="${escapeHtmlAttr(rg.title)}"
            data-release-group-id="${escapeHtmlAttr(rg.id)}"
            data-index="${index}"
            alt="${escapeHtmlAttr(rg.title)}"
            class="w-20 h-20 object-cover rounded-lg"
            src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-semibold text-white truncate text-lg" title="${escapeHtmlAttr(rg.title)}">${escapeHtmlAttr(rg.title)}</div>
        <div class="text-sm text-gray-400 mt-1">${escapeHtmlAttr(releaseDate)} • ${escapeHtmlAttr(albumType)}</div>
        <div class="text-xs text-gray-500 mt-1">${escapeHtmlAttr(artistDisplay)}</div>
      </div>
    `;

    // Store artist info for album addition
    rg._artistDisplay = artistDisplay;
    rg._artistCredit = artistCredits[0]; // Use first artist for metadata

    // Click handler
    albumEl.onclick = async () => {
      if (currentReleaseGroups !== releaseGroups) return;
      const selectionRequest = beginSearchRequest();
      currentReleaseGroups = releaseGroups;
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
      let combinedCountries;
      try {
        combinedCountries = await getCombinedArtistCountries(
          artistCredits,
          selectionRequest.signal
        );
      } catch (error) {
        if (
          !isSearchRequestCurrent(selectionRequest) ||
          error.name === 'AbortError'
        )
          return;
        showToast('Error fetching artist countries', 'error');
        return;
      }
      if (!isSearchRequestCurrent(selectionRequest)) return;

      currentArtist = {
        name: artistDisplay,
        id: primaryArtist?.artist?.id || null,
        country: combinedCountries,
      };

      addAlbumToList(rg);
    };

    modalElements.albumList.appendChild(albumEl);

    // Lazy-load the cover via the provider system once the row nears view
    const img = albumEl.querySelector('img');
    if (img) {
      albumCoverObserver.observe(img, {
        img,
        artistName: artistDisplay,
        albumTitle: rg.title,
        releaseGroupId: rg.id,
        album: rg,
        request,
      });
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
  searchEmptyHTML = modalElements.searchEmpty?.innerHTML || '';

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

  // Backdrop, Escape, scroll lock and focus trap via the shared controller. The
  // in-flight search aborts and the modal state resets on close (all paths).
  addAlbumController = createModal({
    element: modal,
    backdrop: modal,
    label: 'Add album',
    initialFocus: '#artistSearchInput',
    onClose: () => {
      resetModalState();
    },
  });

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
      invalidateSearchWork();
      displayArtistResults(currentArtistResults);
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

  // Handle window resize to ensure proper modal behavior
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      // Re-setup handlers if needed after resize
      if (!modal.classList.contains('hidden')) {
        // Ensure proper modal styling based on new viewport
        const isMobile = isMobileViewport();
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
  const isMobile = isMobileViewport();

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
  invalidateSearchWork();
  currentArtistResults = [];
  modalElements.artistResults.classList.add('hidden');
  modalElements.albumResults.classList.add('hidden');
  modalElements.searchLoading.classList.add('hidden');
  modalElements.searchEmpty.classList.remove('hidden');
  modalElements.searchEmpty.innerHTML = searchEmptyHTML;
  modalElements.artistList.innerHTML = '';
  modalElements.albumList.innerHTML = '';
}

// Unified manual entry form functions

// Unified open modal function
window.openAddAlbumModal = function () {
  const currentListId = getCurrentListId();

  console.log(
    'openAddAlbumModal called, currentList:',
    currentListId,
    'recommendations year:',
    getCurrentRecommendationsYear(),
    'modal:',
    modal
  );

  // Allow opening if we have a list OR if we're viewing recommendations
  if (!currentListId && !getCurrentRecommendationsYear()) {
    console.log('No list or recommendations selected, showing toast');
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
  addAlbumController.open();

  // Reset search mode to artist when opening the modal
  searchMode = 'artist';
  updateSearchMode('artist');

  // Clear the search input (the controller has moved focus into it)
  if (modalElements.artistSearchInput) {
    modalElements.artistSearchInput.value = '';
  }

  resetModalState();

  // Populate country dropdown when modal opens
  populateCountryDropdown();
};

// Unified close modal function

// Unified display functions that handle both mobile and desktop layouts

// New functions for manual entry
function showManualEntryForm() {
  albumModalSession++;
  clearSearchResults();
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
  albumModalSession++;
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

  const availableCountries = getAvailableCountries();
  if (Array.isArray(availableCountries)) {
    availableCountries.forEach((country) => {
      const option = document.createElement('option');
      option.value = country;
      option.textContent = country;
      select.appendChild(option);
    });
  }
}

function resetCoverPreview() {
  const defaultContent = isMobileViewport()
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
  const context = captureAlbumAddContext();

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
    album_id: 'manual-' + globalThis.crypto.randomUUID(), // Generate a unique ID for manual entries
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
      // Resize image to 512x512 using Canvas API
      const img = new Image();
      const reader = new FileReader();

      reader.onload = function (e) {
        img.onload = async function () {
          // Create canvas for resizing
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          // Calculate dimensions to maintain aspect ratio (fit inside 512x512)
          let width = img.width;
          let height = img.height;
          const maxSize = 512;

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
          await finishManualAdd(album, context);
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
    await finishManualAdd(album, context);
  }
}

function finishManualAdd(album, context = captureAlbumAddContext()) {
  return persistAlbumAddition(album, { ...context, manual: true });
}

function closeAddAlbumModal() {
  // The controller's onClose aborts the in-flight search and resets state.
  if (addAlbumController) {
    addAlbumController.close();
  }
}

function resetModalState() {
  albumModalSession++;
  clearSearchResults();

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
  modalElements.searchEmpty.classList.add('hidden');
  modalElements.artistResults.classList.add('hidden');
  modalElements.albumResults.classList.remove('hidden');
}

// Display artist results with lazy-loaded images
async function displayArtistResults(artists) {
  currentArtistResults = artists;
  // Abort any previous artist image searches
  if (artistImageAbortController) {
    artistImageAbortController.abort();
  }
  artistImageAbortController = new AbortController();
  const imageSignal = artistImageAbortController.signal;

  resetArtistImageObserver();

  modalElements.artistList.innerHTML = '';

  // Desktop now uses the same list-style layout as mobile
  modalElements.artistList.className = 'space-y-3';

  // Reveal the list before observing so the IntersectionObserver can fire for
  // rows that are visible immediately (it won't fire reliably on a later
  // display:none -> visible transition). The rows below are built synchronously,
  // so there is no empty-list flash before paint.
  showArtistResults();

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

    // Display country code directly (server resolves to full name when saved)
    let countryDisplay = '';
    if (artist.country) {
      const formattedCountry = formatCountryCode(artist.country);
      if (formattedCountry) {
        countryDisplay = ` • ${formattedCountry}`;
      }
    }

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
          ${escapeHtml(displayName.primary)}
          ${displayName.warning ? '<i class="fas fa-exclamation-triangle text-yellow-500 text-xs ml-2" title="Non-Latin script - no Latin version found"></i>' : ''}
        </div>
        ${secondaryText ? `<div class="text-sm text-gray-400 mt-1">${escapeHtml(secondaryText)}</div>` : ''}
        <div class="text-sm text-gray-400 mt-1 artist-country">${escapeHtml(artist.type || 'Artist')}${escapeHtml(countryDisplay)}</div>
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

    artistEl.onclick = () => {
      if (
        currentArtistResults !== artists ||
        modalElements.artistResults.classList.contains('hidden')
      )
        return;
      return selectArtist(enhancedArtist);
    };

    modalElements.artistList.appendChild(artistEl);

    // Lazy-load the artist image only once the row nears the viewport.
    const searchName =
      displayName.original && !displayName.warning
        ? displayName.primary
        : artist.name;
    artistImageObserver.observe(artistEl, {
      artistEl,
      displayName,
      searchName,
      artistId: artist.id,
      signal: imageSignal,
    });
  }
}

/**
 * Lazy callback: fetch an artist image via provider racing and swap it in for
 * the placeholder. Mirrors the behaviour previously run eagerly per row.
 *
 * @param {Object} ctx - { artistEl, displayName, searchName, artistId, signal }
 */
async function loadArtistImageInto({
  artistEl,
  displayName,
  searchName,
  artistId,
  signal,
}) {
  const excluded = new Set();
  const imageContainer = artistEl.querySelector('.artist-image-container');
  if (!imageContainer || signal.aborted) return;
  const placeholder = imageContainer.innerHTML.replace('animate-pulse', '');
  const load = async () => {
    try {
      const imageUrl = await searchArtistImageRacing(
        searchName,
        artistId,
        signal,
        excluded
      );
      if (signal.aborted) return;
      if (imageUrl) {
        const img = document.createElement('img');
        img.alt = displayName.primary;
        img.className = 'w-16 h-16 rounded-full object-cover';
        const cleanup = () => {
          clearTimeout(timer);
          img.onload = null;
          img.onerror = null;
          signal.removeEventListener('abort', cancel);
        };
        const cancel = () => {
          cleanup();
          img.src = '';
        };
        const failed = () => {
          cleanup();
          img.src = '';
          if (signal.aborted) return;
          artistImageLoader.evict(searchName, artistId);
          imageContainer.innerHTML = placeholder;
          excluded.add(imageUrl);
          if (excluded.size < 2) void load();
        };
        img.onload = cleanup;
        img.onerror = failed;
        signal.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(failed, 3000);
        imageContainer.innerHTML = '';
        imageContainer.appendChild(img);
        img.src = imageUrl;
      } else {
        imageContainer.innerHTML = placeholder;
      }
    } catch (_error) {
      if (!signal.aborted) imageContainer.innerHTML = placeholder;
    }
  };
  await load();
}

async function selectArtist(artist) {
  const request = beginSearchRequest();

  // Use the enhanced artist with display name
  const selectedArtist = artist._displayName
    ? {
        ...artist,
        name: artist._displayName.primary, // Use the Latin name for album displays
        originalName: artist.name, // Keep the original for API calls
      }
    : artist;
  currentArtist = selectedArtist;

  showLoading();
  modalElements.albumList.innerHTML = '';
  if (modalElements.backToArtists) {
    modalElements.backToArtists.style.display = '';
  }

  try {
    const result = await searchArtistAlbums(
      selectedArtist.name,
      selectedArtist.id,
      request.signal
    );
    if (!isSearchRequestCurrent(request)) return;

    if (!result.nextOffset && result.albums.length === 0) {
      showToast('No albums or EPs found for this artist', 'error');
      showAlbumResults();
      modalElements.albumList.innerHTML =
        '<p class="col-span-full text-center text-gray-500">No albums or EPs found.</p>';
      return;
    }

    // Display albums - covers will be fetched via coverArtProviders
    displayAlbumResultsWithProvider(
      result.albums,
      result.name,
      selectedArtist,
      request
    );
    appendDiscographyPageButton(result, selectedArtist, request);
  } catch (error) {
    if (!isSearchRequestCurrent(request) || error.name === 'AbortError') {
      // Album loading cancelled - expected behavior
      return;
    }
    showToast(
      'Could not load albums from MusicBrainz. Please try again.',
      'error'
    );
    await displayArtistResults(currentArtistResults);
  }
}

function appendDiscographyPageButton(result, artist, request) {
  if (result.nextOffset === null) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'w-full py-3 text-sm text-gray-400 hover:text-white';
  button.textContent = 'Load more albums';
  button.onclick = async () => {
    if (button.disabled || !isSearchRequestCurrent(request)) return;
    button.disabled = true;
    button.textContent = 'Loading more albums...';
    try {
      const page = await searchArtistAlbums(
        artist.name,
        artist.id,
        request.signal,
        result.nextOffset
      );
      if (!isSearchRequestCurrent(request)) return;
      const byId = new Map(
        [...result.albums, ...page.albums].map((album) => [
          album.releaseGroupId,
          album,
        ])
      );
      result.albums = [...byId.values()].sort((a, b) =>
        b.releaseDate.localeCompare(a.releaseDate)
      );
      result.nextOffset = page.nextOffset;
      displayAlbumResultsWithProvider(
        result.albums,
        result.name,
        artist,
        request
      );
      appendDiscographyPageButton(result, artist, request);
    } catch (_error) {
      if (!isSearchRequestCurrent(request)) return;
      button.disabled = false;
      button.textContent = 'Retry loading more albums';
      showToast('Could not load more albums. Please try again.', 'error');
    }
  };
  modalElements.albumList.appendChild(button);
}

// Country code resolution is now handled server-side during album save.
// For display purposes, we show 2-letter codes directly.
// Special MusicBrainz codes that we can resolve client-side without API calls.
function formatCountryCode(countryCode) {
  if (!countryCode) return '';

  const specialCodes = {
    XW: 'Worldwide',
    XE: 'Europe',
    XU: 'Unknown',
  };

  return specialCodes[countryCode] || countryCode;
}

// Get combined country names for multiple artists
async function getCombinedArtistCountries(artistCredits, signal) {
  const countries = [];

  for (const credit of artistCredits) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const id = credit.artist?.id;
    if (!id) continue;

    try {
      const endpoint = `artist/${id}?fmt=json`;
      // NORMAL priority: needed for display but not critical
      const artistData = await rateLimitedFetch(endpoint, 'normal', signal);
      if (artistData && artistData.country) {
        const name = formatCountryCode(artistData.country);
        if (name && !countries.includes(name)) {
          countries.push(name);
        }
      }
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError') throw error;
      // Error fetching artist country - non-critical
    }
  }

  return countries.join(' / ');
}

async function searchAlbums(query, signal) {
  const endpoint = `release-group/?query=${encodeURIComponent(query)}&type=album|ep&fmt=json&limit=20`;
  // HIGH priority: user-initiated album search
  const data = await rateLimitedFetch(endpoint, 'high', signal);

  if (!Array.isArray(data['release-groups'])) {
    throw new Error('Invalid MusicBrainz album response');
  }
  let releaseGroups = data['release-groups'];

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

    return isValidType && toComparableDate(releaseDate) <= todayStr;
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
function displayAlbumResultsWithProvider(
  albums,
  providerName,
  artist,
  request
) {
  if (!isSearchRequestCurrent(request)) return;
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

  currentReleaseGroups = normalizedAlbums;

  resetAlbumCoverObserver();

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
      ? `<img src="${escapeHtmlAttr(album.coverArt)}"
             alt="${escapeHtmlAttr(album.title)}"
             class="w-20 h-20 object-cover rounded-lg">`
      : `<img data-artist="${escapeHtmlAttr(artist.name)}"
             data-album="${escapeHtmlAttr(album.title)}"
             data-release-group-id="${escapeHtmlAttr(album.id)}"
             data-index="${index}"
             alt="${escapeHtmlAttr(album.title)}"
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
        <div class="font-semibold text-white truncate text-lg" title="${escapeHtmlAttr(album.title)}">${escapeHtml(album.title)}</div>
        <div class="text-sm text-gray-400 mt-1">${escapeHtml(releaseDate)} • ${escapeHtml(albumType)}</div>
        <div class="text-xs text-gray-500 mt-1">${escapeHtml(artist.name)}</div>
      </div>
    `;

    // Click handler
    albumEl.onclick = async () => {
      if (!isSearchRequestCurrent(request)) return;
      const coverContainer = albumEl.querySelector('.album-cover-container');

      coverContainer.innerHTML = `
        <div class="w-20 h-20 bg-gray-700 rounded-lg flex items-center justify-center">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      `;

      currentArtist = artist;
      addAlbumToList(album);
    };

    modalElements.albumList.appendChild(albumEl);

    const renderedImg = albumEl.querySelector('.album-cover-container img');
    if (hasCover && renderedImg) {
      loadAlbumCover(
        renderedImg,
        artist.name,
        album.title,
        album.id,
        album,
        request
      );
    }

    // If no cover from provider, lazy-load via the cover art provider system
    if (!hasCover) {
      const img = albumEl.querySelector('img');
      if (img) {
        albumCoverObserver.observe(img, {
          img,
          artistName: artist.name,
          albumTitle: album.title,
          releaseGroupId: album.id,
          album,
          request,
        });
      }
    }
  });

  console.log(
    `📊 [ALBUMS] Displayed ${albums.length} albums from ${providerName}`
  );
}

async function addAlbumToList(releaseGroup) {
  // Show initial loading message
  showToast('Adding album...', 'info');

  console.debug('Adding album for artist:', currentArtist);
  console.debug('Artist country field:', currentArtist.country);

  // Send country code directly to server - it will resolve to full name during save
  const countryCode = currentArtist.country || '';
  if (countryCode) {
    console.debug('Sending country code to server:', countryCode);
  } else {
    console.warn('No country field found for artist:', currentArtist.name);
  }

  const album = {
    artist: currentArtist.name,
    album: releaseGroup.title,
    album_id: releaseGroup.id,
    release_date: releaseGroup['first-release-date'] || '',
    country: countryCode,
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
        currentReleaseGroups.indexOf(releaseGroup)
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

  if (coverArtUrl) {
    album.external_cover_url = coverArtUrl;
  }

  // Do not block the optimistic add on image proxying/resizing. The server-side
  // cover fetch queue resolves and stores covers after the list save.
  return addAlbumToCurrentList(album);
}

async function addAlbumToCurrentList(album) {
  // Check if we're viewing recommendations - route to recommendations flow
  if (isViewingRecommendations()) {
    await addAlbumToRecommendations(album);
    return;
  }

  return persistAlbumAddition(album, captureAlbumAddContext());
}

/**
 * Add an album to the recommendations for the current year
 * @param {Object} album - Album object with artist, album, etc.
 */
async function addAlbumToRecommendations(album) {
  const year = getCurrentRecommendationsYear();
  if (!year) {
    showToast('No recommendations year selected', 'error');
    return;
  }

  // Close the add album modal first
  closeAddAlbumModal();

  // Show reasoning modal
  const reasoning = await showReasoningModal(album, year);
  if (!reasoning) {
    // User cancelled
    return;
  }

  try {
    await apiCall(`/api/recommendations/${year}`, {
      method: 'POST',
      body: JSON.stringify({ album, reasoning }),
    });

    showToast(`Recommended "${album.album}" by ${album.artist}`, 'success');

    // Refresh recommendations display
    if (typeof selectRecommendations === 'function') {
      selectRecommendations(year);
    }
  } catch (error) {
    if (error.status === 409) {
      showToast(error.message || 'This album was already recommended', 'info');
      return;
    }
    if (error.status === 403 && error.locked) {
      showToast('Recommendations are locked for this year', 'error');
      return;
    }
    console.error('Error adding recommendation:', error);
    showToast('Error adding recommendation', 'error');
  }
}

// Self-initialize: works both when loaded eagerly (DOMContentLoaded hasn't fired)
// and when loaded lazily via dynamic import() (DOMContentLoaded already fired).
function selfInit() {
  const isAuthPage = window.location.pathname.match(
    /\/(login|register|forgot)/
  );
  if (!isAuthPage) {
    warmupConnections();
    initializeAddAlbumFeature();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', selfInit);
} else {
  selfInit();
}

// Export for use in other modules
export { searchArtistImageRacing };
