// Content script for RateYourMusic pages.
/* global DOMParser, location */

console.log('SuShe Online content script loaded on RateYourMusic');

const {
  ACTIONS,
  STORAGE_KEYS,
  RYM_DETAIL_FETCH_TIMEOUT_MS,
  RYM_DETAIL_MAX_RESPONSE_BYTES,
} = globalThis.ExtensionConstants;
const albumIdentity = globalThis.AlbumIdentity;
const rymExtractor = globalThis.RymAlbumExtractor;
const detailObservationCache = new Map();
const maxDetailObservationCacheSize = 40;

function deriveLegacyGenres(observation) {
  const taxonomy = observation?.taxonomy || observation;
  const primaryGenres = taxonomy?.primaryGenres || [];
  const secondaryGenres = taxonomy?.secondaryGenres || [];

  if (primaryGenres.length >= 2) {
    return { genre_1: primaryGenres[0], genre_2: primaryGenres[1] };
  }
  if (primaryGenres.length === 1) {
    return {
      genre_1: primaryGenres[0],
      genre_2: secondaryGenres[0] || '',
    };
  }
  return {
    genre_1: secondaryGenres[0] || '',
    genre_2: secondaryGenres[1] || '',
  };
}

function createIdentityOnlyObservation(identity) {
  if (!identity?.canonicalPath || !identity?.albumUrl) return null;

  return {
    schemaVersion: rymExtractor.SCHEMA_VERSION,
    identity: {
      numericId: null,
      canonicalPath: identity.canonicalPath,
      canonicalUrl: identity.albumUrl,
      artist: identity.artist,
      title: identity.album,
    },
    platformLinks: [],
    taxonomy: {
      complete: false,
      primaryGenres: [],
      secondaryGenres: [],
      descriptors: [],
      sourceUrl: identity.albumUrl,
      extractorVersion: rymExtractor.EXTRACTOR_VERSION,
      capturedAt: new Date().toISOString(),
    },
  };
}

function isChallengePage(html) {
  const sample = String(html || '')
    .slice(0, 250000)
    .toLowerCase();
  return [
    'cf-chl-',
    'challenge-platform',
    'just a moment...',
    'verify you are human',
    'g-recaptcha',
    'hcaptcha',
    'id="captcha"',
    'attention required! | cloudflare',
  ].some((marker) => sample.includes(marker));
}

function isMalformedDocument(documentLike) {
  return !!documentLike?.querySelector?.('parsererror');
}

async function requestDetailObservation(canonicalUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    RYM_DETAIL_FETCH_TIMEOUT_MS
  );

  try {
    const response = await fetch(canonicalUrl, {
      credentials: 'same-origin',
      headers: { Accept: 'text/html' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const contentType = response.headers?.get?.('content-type') || '';
    if (!contentType.toLowerCase().includes('text/html')) return null;

    const contentLength = Number(response.headers?.get?.('content-length'));
    if (
      Number.isFinite(contentLength) &&
      contentLength > RYM_DETAIL_MAX_RESPONSE_BYTES
    ) {
      return null;
    }

    const finalCanonical = albumIdentity.canonicalizeRymAlbumUrl(response.url);
    if (!finalCanonical || finalCanonical.canonicalUrl !== canonicalUrl) {
      return null;
    }

    const html = await response.text();
    if (html.length > RYM_DETAIL_MAX_RESPONSE_BYTES || isChallengePage(html)) {
      return null;
    }

    const documentLike = new DOMParser().parseFromString(html, 'text/html');
    if (!documentLike || isMalformedDocument(documentLike)) return null;

    const observation = rymExtractor.extract(documentLike, canonicalUrl);
    return observation.identity ? observation : null;
  } catch (error) {
    console.warn('Could not extract RYM detail observation:', error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function fetchDetailObservation(url) {
  const canonical = albumIdentity.canonicalizeRymAlbumUrl(url);
  if (!canonical) return Promise.resolve(null);

  const cached = detailObservationCache.get(canonical.canonicalUrl);
  if (cached) return cached;

  if (detailObservationCache.size >= maxDetailObservationCacheSize) {
    detailObservationCache.delete(detailObservationCache.keys().next().value);
  }
  const request = requestDetailObservation(canonical.canonicalUrl);
  detailObservationCache.set(canonical.canonicalUrl, request);
  request.then((observation) => {
    if (
      !observation &&
      detailObservationCache.get(canonical.canonicalUrl) === request
    ) {
      detailObservationCache.delete(canonical.canonicalUrl);
    }
  });
  return request;
}

function getPageTitleIdentity() {
  const title = String(document.title || '')
    .replace(/\s+-\s+Rate Your Music\s*$/i, '')
    .trim();
  const separatorIndex = title.toLowerCase().lastIndexOf(' by ');
  if (separatorIndex <= 0) return null;

  const album = title.slice(0, separatorIndex).trim();
  const artistWithMetadata = title.slice(separatorIndex + 4).trim();
  const normalizedArtist = artistWithMetadata.toLowerCase();
  const metadataIndex = [
    ' (album',
    ' (ep',
    ' (single',
    ' (mixtape',
    ' (compilation',
    ' (soundtrack',
  ].reduce((earliest, marker) => {
    const index = normalizedArtist.indexOf(marker);
    return index >= 0 ? Math.min(earliest, index) : earliest;
  }, artistWithMetadata.length);
  const artist = artistWithMetadata.slice(0, metadataIndex).trim();
  return album && artist ? { album, artist } : null;
}

function getDocumentCanonicalAlbumUrl() {
  for (const selector of ['link[rel="canonical"]', 'meta[property="og:url"]']) {
    const element = document.querySelector?.(selector);
    const value =
      element?.href ||
      element?.getAttribute?.('href') ||
      element?.getAttribute?.('content');
    const canonical = albumIdentity.canonicalizeRymAlbumUrl(value);
    if (canonical) return canonical.canonicalUrl;
  }
  return null;
}

function getContextAlbumIdentity(context) {
  const candidates = [
    context.linkUrl,
    context.pageUrl,
    location.href,
    getDocumentCanonicalAlbumUrl(),
  ];
  for (const candidate of new Set(candidates.filter(Boolean))) {
    const identity = albumIdentity.getAlbumIdentityFromUrl(candidate);
    if (identity) return identity;
  }

  const titleIdentity = getPageTitleIdentity();
  return titleIdentity
    ? { ...titleIdentity, albumUrl: null, canonicalPath: null }
    : null;
}

function findAlbumContext(context) {
  const canonical = albumIdentity.canonicalizeRymAlbumUrl(context.linkUrl);
  if (!canonical) return null;

  try {
    const albumLink = document.querySelector(
      `a[href*="${canonical.canonicalPath}"]`
    );
    if (!albumLink) return null;

    return (
      albumLink.closest('.page_section_charts_item_wrapper') ||
      albumLink.closest('.page_charts_section_charts_item_wrapper') ||
      albumLink.closest('[class*="chart_item"]') ||
      albumLink.closest('tr') ||
      albumLink.closest('[class*="release_row"]')
    );
  } catch (error) {
    console.warn('Could not find the selected RYM album row:', error);
    return null;
  }
}

function extractLegacyGenres(context) {
  const albumContext = findAlbumContext(context);
  if (albumContext) {
    const genres = Array.from(albumContext.querySelectorAll('.genre'))
      .map((element) => element.textContent.trim())
      .filter(Boolean);
    if (genres.length > 0) {
      return { genre_1: genres[0] || '', genre_2: genres[1] || '' };
    }
  }

  return deriveLegacyGenres(rymExtractor.extract(document, location.href));
}

function currentDocumentIsDetail(identity) {
  const current = albumIdentity.canonicalizeRymAlbumUrl(location.href);
  return !!current && current.canonicalUrl === identity?.albumUrl;
}

async function extractAlbumDataFromPage(context) {
  const identity = getContextAlbumIdentity(context);
  let pageGenres = { genre_1: '', genre_2: '' };
  try {
    pageGenres = extractLegacyGenres(context);
  } catch (error) {
    console.warn('Could not extract basic RYM genres:', error);
  }
  const data = {
    artist: identity?.artist || '',
    album: identity?.album || '',
    genre_1: pageGenres.genre_1,
    genre_2: pageGenres.genre_2,
    albumUrl: identity?.albumUrl || null,
  };

  if (!identity?.albumUrl) return data;

  let observation = null;
  try {
    if (currentDocumentIsDetail(identity)) {
      const localObservation = rymExtractor.extract(
        document,
        identity.albumUrl
      );
      observation = localObservation.identity ? localObservation : null;
    } else {
      observation = await fetchDetailObservation(identity.albumUrl);
    }
  } catch (error) {
    console.warn('RYM observation extraction failed:', error);
  }

  data.sourceObservation =
    observation || createIdentityOnlyObservation(identity);
  if (observation?.taxonomy?.complete) {
    const genres = deriveLegacyGenres(observation);
    data.genre_1 = genres.genre_1;
    data.genre_2 = genres.genre_2;
  }

  return data;
}

async function fetchGenresFromAlbumPage(albumUrl) {
  const observation = await fetchDetailObservation(albumUrl);
  return deriveLegacyGenres(observation);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message.action === ACTIONS.EXTRACT_ALBUM_IDENTITY ||
    message.action === ACTIONS.EXTRACT_ALBUM_DATA
  ) {
    extractAlbumDataFromPage(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message.action === ACTIONS.FETCH_GENRES_FOR_ALBUM) {
    fetchGenresFromAlbumPage(message.albumUrl)
      .then(sendResponse)
      .catch(() => sendResponse({ genre_1: '', genre_2: '' }));
    return true;
  }

  return false;
});

globalThis.RymContentScript = {
  deriveLegacyGenres,
  extractAlbumDataFromPage,
  fetchDetailObservation,
  isChallengePage,
};

setTimeout(() => {
  chrome.storage.local
    .get([STORAGE_KEYS.AUTO_REFRESH_SUPPORTED])
    .then((data) => {
      if (data[STORAGE_KEYS.AUTO_REFRESH_SUPPORTED] !== false) return;

      chrome.runtime
        .sendMessage({ action: ACTIONS.RYM_PAGE_LOADED })
        .then(() => {
          console.log('[Content Script] Notified background of RYM page load');
        })
        .catch(() => {
          // Ignore errors - background might not be ready yet.
        });
    });
}, 500);
