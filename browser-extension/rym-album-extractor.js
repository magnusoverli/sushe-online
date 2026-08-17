// Pure RateYourMusic album detail observation extraction.

(function () {
  const SCHEMA_VERSION = 1;
  const SOURCE = 'rateyourmusic';
  const EXTRACTOR_VERSION = 'rym-extension/1.9.6';
  const primaryGenreSelectors = [
    '.release_pri_genres .genre',
    '.release_pri_genres a[href*="/genre/"]',
  ];
  const secondaryGenreSelectors = [
    '.release_sec_genres .genre',
    '.release_sec_genres a[href*="/genre/"]',
  ];
  const descriptorSelectors = [
    '.release_descriptors .release_pri_descriptors',
    'tr.release_descriptors .release_pri_descriptors',
  ];
  const albumInfoRowSelectors = [
    'table.album_info tr',
    'table.album_info_outer tr',
    '.album_info tr',
    '.album_info_outer tr',
  ];
  const mediaScopeSelectors = [
    '.release_media_links',
    '[class*="media_links"]',
    '[class*="streaming_links"]',
    '.release_left_column',
    '.release_cover',
  ];
  const albumIdAttributeSelectors = ['[data-album-id]', '[data-rym-album-id]'];
  const albumIdTextSelectors = [
    '.album_id',
    '.release_album_id',
    '[data-album-id-text]',
  ];
  const soundCloudReservedSegments = new Set([
    'albums',
    'discover',
    'likes',
    'reposts',
    'search',
    'sets',
    'tracks',
    'you',
  ]);

  function queryAll(documentLike, selector) {
    try {
      return Array.from(documentLike?.querySelectorAll?.(selector) || []);
    } catch (_error) {
      return [];
    }
  }

  function queryOne(documentLike, selector) {
    try {
      return (
        documentLike?.querySelector?.(selector) ||
        documentLike?.querySelectorAll?.(selector)?.[0] ||
        null
      );
    } catch (_error) {
      return null;
    }
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function collectOrderedText(documentLike, selectors) {
    const seenElements = new Set();
    const seenValues = new Set();
    const values = [];

    for (const selector of selectors) {
      for (const element of queryAll(documentLike, selector)) {
        if (seenElements.has(element)) continue;
        seenElements.add(element);

        const value = normalizeText(element.textContent);
        const key = value.toLocaleLowerCase();
        if (!value || seenValues.has(key)) continue;
        seenValues.add(key);
        values.push(value);
      }
    }

    return values;
  }

  function splitOrderedText(value) {
    const seen = new Set();
    return String(value || '')
      .split(',')
      .map(normalizeText)
      .filter((term) => {
        const key = term.toLocaleLowerCase();
        if (!term || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function extractDescriptors(documentLike) {
    const descriptorText = collectOrderedText(
      documentLike,
      descriptorSelectors
    ).join(',');
    const descriptors = splitOrderedText(descriptorText);
    if (descriptors.length > 0) return descriptors;

    const row = queryOne(documentLike, 'tr.release_descriptors');
    if (!row) return [];
    return splitOrderedText(
      queryAll(row, 'meta[content]')
        .map((meta) => meta.getAttribute?.('content'))
        .filter(Boolean)
        .join(',')
    );
  }

  function findAlbumInfoRow(documentLike, labels) {
    const expected = new Set(labels.map((label) => label.toLowerCase()));
    const seen = new Set();
    for (const selector of albumInfoRowSelectors) {
      for (const row of queryAll(documentLike, selector)) {
        if (seen.has(row)) continue;
        seen.add(row);
        const header =
          queryOne(row, 'th.info_hdr') || queryOne(row, 'th') || null;
        const label = normalizeText(header?.textContent)
          .replace(/:$/, '')
          .toLowerCase();
        if (expected.has(label)) return row;
      }
    }
    return null;
  }

  function extractRowTerms(row, selectors = ['td a']) {
    if (!row) return [];
    const linkedTerms = collectOrderedText(row, selectors);
    if (linkedTerms.length > 0) return linkedTerms;
    return splitOrderedText(
      queryAll(row, 'td')
        .map((cell) => cell.textContent)
        .join(',')
    );
  }

  function parseAlbumId(value, textFormat = false) {
    const pattern = textFormat
      ? /^\[Album([1-9]\d*)\]$/
      : /^(?:Album)?([1-9]\d*)$/;
    const match = normalizeText(value).match(pattern);
    if (!match) return null;

    return match[1];
  }

  function extractAlbumId(documentLike) {
    const candidates = new Set();
    for (const selector of albumIdAttributeSelectors) {
      for (const element of queryAll(documentLike, selector)) {
        const attributeName = selector.slice(1, -1);
        const albumId = parseAlbumId(element.getAttribute?.(attributeName));
        if (albumId !== null) candidates.add(albumId);
      }
    }

    for (const selector of [...albumIdTextSelectors, 'a']) {
      for (const element of queryAll(documentLike, selector)) {
        const albumId = parseAlbumId(element.textContent, true);
        if (albumId !== null) candidates.add(albumId);
      }
    }

    return candidates.size === 1 ? [...candidates][0] : null;
  }

  function getPlatformForHostname(hostname) {
    const host = hostname.toLowerCase();
    if (host === 'open.spotify.com') return 'spotify';
    if (host === 'itunes.apple.com' || host === 'music.apple.com') {
      return 'itunes';
    }
    if (host === 'qobuz.com' || host.endsWith('.qobuz.com')) return 'qobuz';
    if (host === 'tidal.com' || host.endsWith('.tidal.com')) return 'tidal';
    if (host === 'bandcamp.com' || host.endsWith('.bandcamp.com')) {
      return 'bandcamp';
    }
    if (host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) {
      return 'soundcloud';
    }
    if (
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtu.be'
    ) {
      return 'youtube';
    }
    return null;
  }

  function isPlatformAlbumLink(parsed, service) {
    switch (service) {
      case 'spotify':
        return /^\/album\/[A-Za-z0-9]{22}\/?$/.test(parsed.pathname);
      case 'itunes': {
        const segments = parsed.pathname.split('/').filter(Boolean);
        const albumIndex = segments[0]?.toLowerCase() === 'album' ? 0 : 1;
        const albumSegments = segments.slice(albumIndex + 1);
        return (
          (albumIndex === 0 || /^[a-z]{2}$/i.test(segments[0])) &&
          segments[albumIndex]?.toLowerCase() === 'album' &&
          albumSegments.length >= 1 &&
          albumSegments.length <= 2 &&
          (parsed.hostname.endsWith('itunes.apple.com')
            ? /^id\d+$/i.test(albumSegments.at(-1) || '')
            : /^(?:id)?\d+$/i.test(albumSegments.at(-1) || ''))
        );
      }
      case 'qobuz':
        return (
          /^\/album\/[A-Za-z0-9]+\/?$/.test(parsed.pathname) ||
          /^\/[a-z]{2}-[a-z]{2}\/album\/[^/]+\/[A-Za-z0-9]+\/?$/i.test(
            parsed.pathname
          )
        );
      case 'tidal':
        return /^\/(?:browse\/)?album\/\d+\/?$/.test(parsed.pathname);
      case 'bandcamp':
        return (
          parsed.hostname !== 'bandcamp.com' &&
          /^\/album\/[^/]+\/?$/.test(parsed.pathname)
        );
      case 'soundcloud':
        if (/^\/[^/]+\/sets\/[^/]+\/?$/i.test(parsed.pathname)) return true;
        {
          const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
          return Boolean(
            match &&
            !soundCloudReservedSegments.has(match[1].toLowerCase()) &&
            !soundCloudReservedSegments.has(match[2].toLowerCase())
          );
        }
      case 'youtube': {
        const playlistId = parsed.searchParams.get('list');
        if (
          playlistId &&
          /^[A-Za-z0-9_-]{10,128}$/.test(playlistId) &&
          /^\/(?:playlist|watch)\/?$/.test(parsed.pathname)
        ) {
          return true;
        }
        const videoId =
          parsed.hostname === 'youtu.be'
            ? parsed.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1]
            : /^\/watch\/?$/.test(parsed.pathname)
              ? parsed.searchParams.get('v')
              : parsed.pathname.match(
                  /^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/
                )?.[1];
        return /^[A-Za-z0-9_-]{11}$/.test(videoId || '');
      }
      default:
        return false;
    }
  }

  function normalizePlatformLink(value) {
    let parsed;
    try {
      parsed = new URL(String(value));
    } catch (_error) {
      return null;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password || parsed.port) return null;

    const service = getPlatformForHostname(parsed.hostname);
    if (!service || !isPlatformAlbumLink(parsed, service)) return null;

    parsed.protocol = 'https:';
    parsed.hash = '';
    return { service, url: parsed.toString() };
  }

  function getPlatformService(value) {
    return normalizePlatformLink(value)?.service || null;
  }

  function collectPlatformLinks(documentLike) {
    const scopes = [];
    const seenScopes = new Set();
    for (const selector of mediaScopeSelectors) {
      for (const scope of queryAll(documentLike, selector)) {
        if (seenScopes.has(scope)) continue;
        seenScopes.add(scope);
        scopes.push(scope);
      }
    }

    const links = [];
    const seenUrls = new Set();
    for (const scope of scopes) {
      for (const anchor of queryAll(scope, 'a[href]')) {
        const link = normalizePlatformLink(
          anchor.href || anchor.getAttribute?.('href')
        );
        if (!link || seenUrls.has(link.url)) continue;
        seenUrls.add(link.url);
        links.push(link);
      }
    }

    return { links, scopeFound: scopes.length > 0 };
  }

  function hasSection(documentLike, selector) {
    return !!queryOne(documentLike, selector);
  }

  function extract(documentLike, url) {
    const canonical = globalThis.AlbumIdentity?.canonicalizeRymAlbumUrl(url);
    const compatibleIdentity =
      globalThis.AlbumIdentity?.getAlbumIdentityFromUrl(url);
    const albumId = extractAlbumId(documentLike);
    const primaryGenres = collectOrderedText(
      documentLike,
      primaryGenreSelectors
    );
    const secondaryGenres = collectOrderedText(
      documentLike,
      secondaryGenreSelectors
    );
    const descriptors = extractDescriptors(documentLike);
    const languageRow = findAlbumInfoRow(documentLike, [
      'Language',
      'Languages',
    ]);
    const scenesRow = findAlbumInfoRow(documentLike, ['Scenes']);
    const movementsRow = findAlbumInfoRow(documentLike, ['Movements']);
    const languages = extractRowTerms(languageRow);
    const scenes = extractRowTerms(scenesRow, [
      '.release_pri_genres a',
      'td a',
    ]);
    const movements = extractRowTerms(movementsRow, [
      '.release_pri_genres a',
      'td a',
    ]);
    const platformResult = collectPlatformLinks(documentLike);
    const identity = canonical
      ? {
          numericId: albumId,
          canonicalPath: canonical.canonicalPath,
          canonicalUrl: canonical.canonicalUrl,
          artist: compatibleIdentity?.artist || '',
          title: compatibleIdentity?.album || '',
        }
      : null;

    const primarySection = hasSection(documentLike, '.release_pri_genres');
    const secondarySection = hasSection(documentLike, '.release_sec_genres');
    const descriptorSection = hasSection(documentLike, '.release_descriptors');
    const authoritativeTaxonomy =
      primarySection || secondarySection || descriptorSection;
    const complete = !!canonical && authoritativeTaxonomy;

    return {
      schemaVersion: SCHEMA_VERSION,
      identity,
      platformLinks: platformResult.links,
      taxonomy: {
        complete,
        primaryGenres,
        secondaryGenres,
        descriptors,
        ...(languageRow ? { languages } : {}),
        ...(scenesRow ? { scenes } : {}),
        ...(movementsRow ? { movements } : {}),
        sourceUrl: canonical?.canonicalUrl || null,
        extractorVersion: EXTRACTOR_VERSION,
        capturedAt: new Date().toISOString(),
      },
    };
  }

  globalThis.RymAlbumExtractor = {
    EXTRACTOR_VERSION,
    SCHEMA_VERSION,
    SOURCE,
    extract,
    getPlatformService,
  };
})();
