/**
 * Shared helpers and caches for album display rendering.
 */

export const PLACEHOLDER_GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const COVER_RETRY_DELAY_MS = 2500;
const MAX_COVER_RETRIES = 2;
// Cap how many off-screen covers fetch at once so opening a large list does not
// fire one request per album in a single cold-load burst; slots refill as each
// cover settles (load or error).
const MAX_CONCURRENT_COVER_LOADS = 12;

function addRetryParam(url) {
  try {
    const origin = globalThis.location?.origin || 'http://localhost';
    const parsed = new URL(url, origin);
    parsed.searchParams.set('coverRetry', String(Date.now()));
    return parsed.pathname + parsed.search + parsed.hash;
  } catch (_error) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}coverRetry=${Date.now()}`;
  }
}

/**
 * Build the per-album mutable-field fingerprint used by both
 * extractMutableFingerprints and detectUpdateType. Field order and
 * separators must stay identical on both sides of the comparison.
 * @param {Object} album - Album object
 * @returns {string} Pipe-separated fingerprint string
 */
export function albumMutableFingerprint(album) {
  return `${album._id || ''}|${album.artist || ''}|${album.album || ''}|${album.release_date || ''}|${album.country || ''}|${album.genre_1 || ''}|${album.genre_2 || ''}|${album.comments || ''}|${album.comments_2 || ''}|${album.primary_track || ''}|${album.secondary_track || ''}`;
}

function renderCoverPlaceholder(parent) {
  parent.innerHTML = `<div class="album-cover-placeholder rounded-sm bg-gray-800 shadow-lg">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-600">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
      <circle cx="8.5" cy="8.5" r="1.5"></circle>
      <polyline points="21 15 16 10 5 21"></polyline>
    </svg>
  </div>`;
}

function removeCoverRevealState(image) {
  image.classList.remove('cover-reveal-pending');
  image.classList.add('cover-reveal-visible');
  delete image.dataset.coverRevealGroup;
}

export function createAlbumDisplayShared(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const setTimer = deps.setTimeout || globalThis.setTimeout;

  const {
    computeGridTemplate,
    getVisibleColumns,
    getToggleableColumns,
    isColumnVisible,
  } = deps;

  let fingerprintCache = new WeakMap();
  let rowElementsCache = new WeakMap();

  function handleCoverError(image) {
    const coverSrc = image.dataset.coverSrc || image.src;
    const retryCount = Number.parseInt(
      image.dataset.coverRetryCount || '0',
      10
    );

    if (coverSrc && retryCount < MAX_COVER_RETRIES) {
      image.dataset.coverRetryCount = String(retryCount + 1);
      image.src = PLACEHOLDER_GIF;
      setTimer(() => {
        if (image.isConnected === false) return;
        image.src = addRetryParam(coverSrc);
      }, COVER_RETRY_DELAY_MS);
      return;
    }

    if (image.parentElement) {
      renderCoverPlaceholder(image.parentElement);
    }
  }

  function attachCoverErrorRetry(image) {
    if (image.dataset.coverRetryAttached === 'true') return;
    if (typeof image.addEventListener !== 'function') return;

    image.dataset.coverRetryAttached = 'true';
    image.addEventListener('error', () => handleCoverError(image));
  }

  function applyVisibilityInPlace() {
    const container = doc?.getElementById('albumContainer');
    if (!container) return;

    const newTemplate = computeGridTemplate(getVisibleColumns());
    const header = container.querySelector('.album-header');
    if (header) {
      header.style.gridTemplateColumns = newTemplate;
    }

    container.querySelectorAll('.album-row').forEach((row) => {
      row.style.gridTemplateColumns = newTemplate;
    });

    for (const column of getToggleableColumns()) {
      const visible = isColumnVisible(column.id);
      container
        .querySelectorAll(`.${column.cellClass}`)
        .forEach((cell) => cell.classList.toggle('column-hidden', !visible));
    }
  }

  // Load every album cover up front (no scroll gating) so the art is present for
  // the whole list the way the availability badges are. The error-retry handler
  // is attached before the real src is swapped in, so a cover that fails to load
  // still retries and then falls back to the placeholder with no load-vs-attach
  // race. Off-screen covers carry fetchpriority="low" so the visible ones win the
  // connection race; we also drain them MAX_CONCURRENT_COVER_LOADS at a time so a
  // big list does not fire one request per album in a single cold-load burst.
  function loadCoverImages(container) {
    const pending = Array.from(
      container.querySelectorAll('img[data-lazy-src]')
    );
    let cursor = 0;
    let active = 0;

    const startNext = () => {
      while (active < MAX_CONCURRENT_COVER_LOADS && cursor < pending.length) {
        const image = pending[cursor];
        cursor += 1;
        const lazySrc = image.dataset.lazySrc;
        if (!lazySrc) continue;

        attachCoverErrorRetry(image);

        active += 1;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          active -= 1;
          startNext();
        };
        if (typeof image.addEventListener === 'function') {
          image.addEventListener('load', release, { once: true });
          image.addEventListener('error', release, { once: true });
        }

        image.dataset.coverSrc = lazySrc;
        image.src = lazySrc;
        delete image.dataset.lazySrc;
      }
    };

    startNext();
  }

  function revealInitialCoverGroup(container, options = {}) {
    const images = Array.from(
      container?.querySelectorAll?.('img[data-cover-reveal-group="initial"]') ||
        []
    );
    if (images.length === 0) return;

    const timeoutMs = options.timeoutMs ?? 800;
    let remaining = images.length;
    let released = false;

    const release = () => {
      if (released) return;
      released = true;
      images.forEach(removeCoverRevealState);
    };

    const markReady = () => {
      remaining -= 1;
      if (remaining <= 0) release();
    };

    setTimer(release, timeoutMs);

    images.forEach((image) => {
      const handleLoaded = () => {
        if (typeof image.decode === 'function') {
          image
            .decode()
            .catch(() => {})
            .finally(markReady);
          return;
        }
        markReady();
      };

      if (image.complete && image.naturalWidth !== 0) {
        handleLoaded();
        return;
      }

      image.addEventListener('load', handleLoaded, { once: true });
      image.addEventListener('error', markReady, { once: true });
    });
  }

  function cacheDesktopRowElements(row) {
    const cache = {
      position:
        row.querySelector('[data-position-element="true"]') ||
        row.querySelector('.position-display'),
      albumName: row.querySelector('.album-name'),
      releaseDate: row.querySelector('.release-date-display'),
      artist: row.querySelector('.artist-cell span'),
      countryCell: row.querySelector('.country-cell'),
      genre1Cell: row.querySelector('.genre-1-cell'),
      genre2Cell: row.querySelector('.genre-2-cell'),
      commentCell: row.querySelector('.comment-cell'),
      comment2Cell: row.querySelector('.comment-2-cell'),
      trackCell: row.querySelector('.track-cell'),
    };

    if (cache.countryCell) {
      cache.countrySpan = cache.countryCell.querySelector('span');
    }
    if (cache.genre1Cell) {
      cache.genre1Span = cache.genre1Cell.querySelector('span');
    }
    if (cache.genre2Cell) {
      cache.genre2Span = cache.genre2Cell.querySelector('span');
    }
    if (cache.commentCell) {
      cache.commentSpan = cache.commentCell.querySelector('span');
    }
    if (cache.comment2Cell) {
      cache.comment2Span = cache.comment2Cell.querySelector('span');
    }
    if (cache.trackCell) {
      cache.trackSpan = cache.trackCell.querySelector('span');
    }

    rowElementsCache.set(row, cache);
    return cache;
  }

  function cacheMobileCardElements(card) {
    const cache = {
      position: card.querySelector('[data-position-element="true"]'),
      releaseDate: card.querySelector('.release-date-display'),
      artistText: card.querySelector('[data-field="artist-mobile-text"]'),
      countryText: card.querySelector('[data-field="country-mobile-text"]'),
      genreText: card.querySelector('[data-field="genre-mobile-text"]'),
      trackText: card.querySelector('[data-field="track-mobile-text"]'),
      secondaryTrackText: card.querySelector(
        '[data-field="secondary-track-mobile-text"]'
      ),
    };

    rowElementsCache.set(card, cache);
    return cache;
  }

  function getCachedElements(row, isMobile) {
    let cache = rowElementsCache.get(row);
    if (!cache) {
      cache = isMobile
        ? cacheMobileCardElements(row)
        : cacheDesktopRowElements(row);
    }
    return cache;
  }

  function resetRowElementsCache() {
    rowElementsCache = new WeakMap();
  }

  function generateAlbumFingerprint(albums) {
    if (!albums || albums.length === 0) return '';

    const cached = fingerprintCache.get(albums);
    if (cached !== undefined) {
      return cached;
    }

    const fingerprint = albums
      .map(
        (album) =>
          `${album._id || ''}|${album.primary_track || ''}|${album.secondary_track || ''}|${album.country || ''}|${album.genre_1 || ''}|${album.genre_2 || ''}|${album.comments || ''}|${album.comments_2 || ''}`
      )
      .join('::');

    fingerprintCache.set(albums, fingerprint);
    return fingerprint;
  }

  function invalidateFingerprint(albums) {
    if (albums) {
      fingerprintCache.delete(albums);
    }
  }

  function extractMutableFingerprints(albums) {
    if (!albums || albums.length === 0) return null;

    return albums.map((album) => albumMutableFingerprint(album));
  }

  function resetFingerprintCache() {
    fingerprintCache = new WeakMap();
  }

  return {
    applyVisibilityInPlace,
    loadCoverImages,
    revealInitialCoverGroup,
    getCachedElements,
    resetRowElementsCache,
    generateAlbumFingerprint,
    invalidateFingerprint,
    extractMutableFingerprints,
    resetFingerprintCache,
  };
}
