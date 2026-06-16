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
    cleaned = cleaned.replace(/\s+\d+$/, '');

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
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getAlbumIdentityFromUrl(url) {
    if (!url) return null;

    const match = String(url).match(/\/release\/[^/]+\/([^/?#]+)\/([^/?#]+)/);
    if (!match) return null;

    const artist = cleanName(match[1]);
    const album = cleanName(match[2]);
    if (!artist || !album) return null;

    return { artist, album, albumUrl: url };
  }

  function getAlbumKey(albumData) {
    const artist = normalizeForMatch(albumData?.artist);
    const album = normalizeForMatch(albumData?.album);

    if (!artist || !album) return '';
    return `${artist}::${album}`;
  }

  globalThis.AlbumIdentity = {
    cleanName,
    getAlbumIdentityFromUrl,
    getAlbumKey,
    normalizeForMatch,
  };
})();
