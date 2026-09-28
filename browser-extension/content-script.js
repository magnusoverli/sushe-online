// Content script for RateYourMusic pages.
/* global DOMParser, location */

(function () {
  if (globalThis.RymContentScript) return;

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
    try {
      const response = await globalThis.SharedUtils.fetchWithTimeout(
        canonicalUrl,
        {
          credentials: 'same-origin',
          headers: { Accept: 'text/html' },
          redirect: 'follow',
          maxResponseBytes: RYM_DETAIL_MAX_RESPONSE_BYTES,
        },
        RYM_DETAIL_FETCH_TIMEOUT_MS
      );
      if (!response.ok) return null;

      const contentType = response.headers?.get?.('content-type') || '';
      if (!contentType.toLowerCase().includes('text/html')) return null;

      const finalCanonical = albumIdentity.canonicalizeRymAlbumUrl(
        response.url
      );
      if (!finalCanonical || finalCanonical.canonicalUrl !== canonicalUrl) {
        return null;
      }

      const html = await response.text();
      if (isChallengePage(html)) {
        return null;
      }

      const documentLike = new DOMParser().parseFromString(html, 'text/html');
      if (!documentLike || isMalformedDocument(documentLike)) return null;

      const observation = rymExtractor.extract(documentLike, canonicalUrl);
      return observation.identity ? observation : null;
    } catch (error) {
      console.warn('Could not extract RYM detail observation:', error);
      return null;
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
        !observation?.taxonomy?.complete &&
        detailObservationCache.get(canonical.canonicalUrl) === request
      ) {
        detailObservationCache.delete(canonical.canonicalUrl);
      }
    });
    return request;
  }

  function findAlbumContext(identity) {
    try {
      const canonicalUrl = (link) =>
        albumIdentity.canonicalizeRymAlbumUrl(link.href)?.canonicalUrl;
      const albumLink = Array.from(
        document.querySelectorAll('a[href*="/release/album/"]')
      ).find((link) => canonicalUrl(link) === identity.albumUrl);
      if (!albumLink) return null;

      const row =
        albumLink.closest('.page_section_charts_item_wrapper') ||
        albumLink.closest('.page_charts_section_charts_item_wrapper') ||
        albumLink.closest('[class*="chart_item"]') ||
        albumLink.closest('tr') ||
        albumLink.closest('[class*="release_row"]');
      if (!row) return null;
      const urls = Array.from(row.querySelectorAll('a[href*="/release/"]')).map(
        canonicalUrl
      );
      return urls.length && urls.every((url) => url === identity.albumUrl)
        ? row
        : null;
    } catch (error) {
      console.warn('Could not find the selected RYM album row:', error);
      return null;
    }
  }

  function extractLegacyGenres(identity) {
    const albumContext = findAlbumContext(identity);
    if (albumContext) {
      const genres = Array.from(albumContext.querySelectorAll('.genre'))
        .map((element) => element.textContent.trim())
        .filter(Boolean);
      if (genres.length > 0) {
        return { genre_1: genres[0] || '', genre_2: genres[1] || '' };
      }
    }

    return { genre_1: '', genre_2: '' };
  }

  function currentDocumentIsDetail(identity) {
    const current = albumIdentity.canonicalizeRymAlbumUrl(location.href);
    return !!current && current.canonicalUrl === identity?.albumUrl;
  }

  function isCurrentCoverLink(context) {
    if (!context.srcUrl || !context.linkUrl) return false;
    // A linked cover may open full-size artwork, but never reinterpret a release link.
    if (/\/release\//i.test(context.linkUrl)) return false;
    const current = albumIdentity.getAlbumIdentityFromUrl(location.href);
    const page = albumIdentity.getAlbumIdentityFromUrl(
      context.pageUrl || location.href
    );
    if (!current || current.albumUrl !== page?.albumUrl) return false;
    return Array.from(
      document.querySelectorAll('img.coverart_img, .release_cover img')
    ).some(
      (image) =>
        [image.src, image.currentSrc].includes(context.srcUrl) &&
        image.closest('a')?.href === context.linkUrl
    );
  }

  function applyObservation(data, identity, observation) {
    data.sourceObservation =
      observation || createIdentityOnlyObservation(identity);
    if (observation?.identity) {
      data.artist = observation.identity.artist;
      data.album = observation.identity.title;
    }
    if (
      observation?.taxonomy?.complete ||
      observation?.taxonomy?.primaryGenres?.length ||
      observation?.taxonomy?.secondaryGenres?.length
    ) {
      Object.assign(data, deriveLegacyGenres(observation));
    }
    return data;
  }

  async function extractAlbumDataFromPage(context) {
    const identity = albumIdentity.getContextAlbumIdentity({
      ...context,
      ...(isCurrentCoverLink(context) ? { linkUrl: null } : {}),
      pageUrl: context.pageUrl || location.href,
    });
    let pageGenres = { genre_1: '', genre_2: '' };
    try {
      pageGenres = extractLegacyGenres(identity);
    } catch (error) {
      console.warn('Could not extract basic RYM genres:', error);
    }
    const data = {
      artist: identity.artist,
      album: identity.album,
      genre_1: pageGenres.genre_1,
      genre_2: pageGenres.genre_2,
      albumUrl: identity.albumUrl,
    };

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

    return applyObservation(data, identity, observation);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === ACTIONS.EXTRACT_ALBUM_IDENTITY) {
      extractAlbumDataFromPage(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ error: error.message }));
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
          .catch(() => {
            // Ignore errors - background might not be ready yet.
          });
      })
      .catch(() => {});
  }, 500);
})();
