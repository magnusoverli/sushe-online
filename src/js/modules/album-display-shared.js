/**
 * Shared helpers and caches for album display rendering.
 */

export const PLACEHOLDER_GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function createAlbumDisplayShared(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const createObserver =
    deps.createObserver ||
    ((callback, options) => new IntersectionObserver(callback, options));

  const {
    computeGridTemplate,
    getVisibleColumns,
    getToggleableColumns,
    isColumnVisible,
  } = deps;

  let fingerprintCache = new WeakMap();
  let rowElementsCache = new WeakMap();
  let coverImageObserver = null;

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

  function initCoverImageObserver() {
    if (coverImageObserver) return;

    coverImageObserver = createObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          const image = entry.target;
          const lazySrc = image.dataset.lazySrc;
          if (lazySrc) {
            image.src = lazySrc;
            delete image.dataset.lazySrc;
          }
          coverImageObserver.unobserve(image);
        });
      },
      {
        rootMargin: '200px',
        threshold: 0,
      }
    );
  }

  function observeLazyImages(container) {
    if (!coverImageObserver) {
      initCoverImageObserver();
    }

    const lazyImages = container.querySelectorAll('img[data-lazy-src]');
    lazyImages.forEach((img) => {
      coverImageObserver.observe(img);
    });
  }

  function cacheDesktopRowElements(row) {
    const cache = {
      position:
        row.querySelector('[data-position-element="true"]') ||
        row.querySelector('.position-display'),
      albumName: row.querySelector('.font-semibold.text-gray-100'),
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
          `${album._id || ''}|${album.primary_track || album.track_picks?.primary || album.track_pick || ''}|${album.secondary_track || album.track_picks?.secondary || ''}|${album.country || ''}|${album.genre_1 || ''}|${album.genre_2 || ''}|${album.comments || ''}|${album.comments_2 || ''}`
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

    return albums.map(
      (album) =>
        `${album._id || ''}|${album.artist || ''}|${album.album || ''}|${album.release_date || ''}|${album.country || ''}|${album.genre_1 || ''}|${album.genre_2 || ''}|${album.comments || ''}|${album.comments_2 || ''}|${album.primary_track || album.track_picks?.primary || album.track_pick || ''}|${album.secondary_track || album.track_picks?.secondary || ''}`
    );
  }

  function resetFingerprintCache() {
    fingerprintCache = new WeakMap();
  }

  return {
    applyVisibilityInPlace,
    observeLazyImages,
    getCachedElements,
    resetRowElementsCache,
    generateAlbumFingerprint,
    invalidateFingerprint,
    extractMutableFingerprints,
    resetFingerprintCache,
  };
}
