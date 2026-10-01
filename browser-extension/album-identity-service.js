// Shared album identity helpers for RYM URL parsing and SuShe matching.

(function () {
  function decodePathPart(value) {
    try {
      return decodeURIComponent(value);
    } catch (_error) {
      return value;
    }
  }

  function cleanName(name) {
    if (!name) return '';

    let cleaned = decodePathPart(name).replace(/[-_]/g, ' ').trim();

    if (typeof cleaned.normalize === 'function') {
      cleaned = cleaned.normalize('NFC');
    }

    const isAllLowercase = cleaned === cleaned.toLowerCase();
    const isAllUppercase = cleaned === cleaned.toUpperCase();

    if (isAllLowercase || isAllUppercase) {
      cleaned = cleaned
        .split(' ')
        .map((word) => {
          if (!word) return word;
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');
    }

    return cleaned;
  }

  function normalizeForMatch(value) {
    if (!value) return '';

    let normalized = String(value).trim().toLowerCase();
    if (typeof normalized.normalize === 'function') {
      normalized = normalized.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    }

    return normalized
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function canonicalizeRymAlbumUrl(value, { buyLink = false } = {}) {
    if (!value) return null;

    const rawValue = String(value);
    if (
      rawValue.includes('\\') ||
      /%(?:2f|5c)/i.test(rawValue) ||
      Array.from(rawValue).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || (code >= 127 && code <= 159);
      })
    ) {
      return null;
    }

    let parsed;
    try {
      parsed = new URL(rawValue);
    } catch (_error) {
      return null;
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (
      parsed.hostname !== 'rateyourmusic.com' &&
      parsed.hostname !== 'www.rateyourmusic.com'
    ) {
      return null;
    }
    if (parsed.username || parsed.password || parsed.port) return null;

    const pathMatch = parsed.pathname.match(
      buyLink
        ? /^\/release\/album\/([^/]+)\/([^/]+)\/buy\/?$/i
        : /^\/release\/album\/([^/]+)\/([^/]+)\/?$/i
    );
    if (!pathMatch) return null;

    const artistSlug = pathMatch[1];
    const albumSlug = pathMatch[2];
    if (!artistSlug || !albumSlug) return null;

    try {
      const decodedPath = `${decodeURIComponent(artistSlug)}/${decodeURIComponent(albumSlug)}`;
      if (
        decodedPath.includes('\\') ||
        Array.from(decodedPath).some((character) => {
          const code = character.charCodeAt(0);
          return code <= 31 || (code >= 127 && code <= 159);
        })
      ) {
        return null;
      }
    } catch (_error) {
      return null;
    }

    const canonicalPath = `/release/album/${artistSlug}/${albumSlug}/`;
    return {
      canonicalPath,
      canonicalUrl: `https://rateyourmusic.com${canonicalPath}`,
    };
  }

  function getAlbumIdentityFromUrl(url) {
    const canonical = canonicalizeRymAlbumUrl(url);
    if (!canonical) return null;

    const parts = canonical.canonicalPath.split('/').filter(Boolean);

    const artist = cleanName(parts[2]);
    const album = cleanName(parts[3]);
    if (!artist || !album) return null;

    return {
      artist,
      album,
      albumUrl: canonical.canonicalUrl,
      canonicalPath: canonical.canonicalPath,
    };
  }

  function getAlbumKey(albumData) {
    const artist = normalizeForMatch(albumData?.artist);
    const album = normalizeForMatch(albumData?.album);

    if (!artist || !album) return '';
    return `${artist}::${album}`;
  }

  function getContextAlbumIdentity({ linkUrl, pageUrl, srcUrl, mediaType }) {
    // An explicit link is the selection, even when its release type is unsupported.
    const identity = getAlbumIdentityFromUrl(linkUrl || pageUrl);
    if (identity) return identity;
    // RYM links the cover image to this album's /buy/ page on some releases.
    const isImage = srcUrl && mediaType === 'image';
    const page = isImage && getAlbumIdentityFromUrl(pageUrl);
    const buy = isImage && canonicalizeRymAlbumUrl(linkUrl, { buyLink: true });
    if (page && buy?.canonicalPath === page.canonicalPath) return page;
    throw new Error(
      'Right-click a RYM album link or a recognizable album cover. Only album releases are supported.'
    );
  }

  function getIdentityKeys(album) {
    const identity =
      album?.sourceObservation?.identity || album?.identity || {};
    const value = album?.rymNumericId ?? album?.numericId ?? identity.numericId;
    const numeric = value == null ? '' : String(value).trim();
    const paths = [
      album?.rymCanonicalUrl,
      album?.canonicalUrl,
      album?.canonicalPath,
      album?.albumUrl,
      identity.canonicalUrl,
      identity.canonicalPath,
    ];
    const canonical = paths
      .filter(Boolean)
      .map((value) =>
        canonicalizeRymAlbumUrl(
          String(value).startsWith('/')
            ? `https://rateyourmusic.com${value}`
            : value
        )
      )
      .find(Boolean);
    const name = getAlbumKey({
      artist: album?.artist || identity.artist,
      album: album?.album || album?.title || identity.title,
    });
    return [
      /^\d+$/.test(numeric) ? `rym-id:${numeric}` : null,
      canonical ? `rym-path:${canonical.canonicalPath}` : null,
      name ? `name:${name}` : null,
    ].filter(Boolean);
  }

  function identityKeysMatch(a, b) {
    for (const prefix of ['rym-id:', 'rym-path:', 'name:']) {
      const x = a.find((key) => key.startsWith(prefix));
      const y = b.find((key) => key.startsWith(prefix));
      if (x && y) return x === y;
    }
    return false;
  }

  function identitiesMatch(left, right) {
    return identityKeysMatch(getIdentityKeys(left), getIdentityKeys(right));
  }

  globalThis.AlbumIdentity = {
    canonicalizeRymAlbumUrl,
    cleanName,
    getAlbumIdentityFromUrl,
    getContextAlbumIdentity,
    getAlbumKey,
    getIdentityKeys,
    identityKeysMatch,
    identitiesMatch,
    normalizeForMatch,
  };
})();
