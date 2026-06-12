const INITIAL_DESKTOP_COVER_PRELOAD_COUNT = 16;
const INITIAL_MOBILE_COVER_PRELOAD_COUNT = 8;
const INITIAL_COVER_PRELOAD_TIMEOUT_MS = 650;
const INITIAL_PLAYCOUNT_PRELOAD_TIMEOUT_MS = 650;

export function createListSelectionPreloader(deps = {}) {
  const {
    win = typeof window !== 'undefined' ? window : null,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    logger = console,
    primePlaycountCache,
    prefetchPlaycountsForRender,
  } = deps;
  const createImage =
    deps.createImage ||
    (() => {
      if (typeof win?.Image === 'function') return new win.Image();
      if (typeof globalThis.Image === 'function') return new globalThis.Image();
      return null;
    });

  function getInitialCoverPreloadCount() {
    return win?.innerWidth < 1024
      ? INITIAL_MOBILE_COVER_PRELOAD_COUNT
      : INITIAL_DESKTOP_COVER_PRELOAD_COUNT;
  }

  function getCoverPreloadUrl(album) {
    if (!album || album.cover_image) return null;
    return album.cover_thumb_url || album.cover_image_url || null;
  }

  function preloadCoverImage(url) {
    return new Promise((resolve) => {
      const image = createImage();
      if (!image) {
        resolve();
        return;
      }

      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const finishAfterDecode = () => {
        if (typeof image.decode === 'function') {
          image
            .decode()
            .catch(() => {})
            .finally(done);
          return;
        }
        done();
      };

      image.onload = finishAfterDecode;
      image.onerror = done;
      image.src = url;

      if (image.complete && image.naturalWidth !== 0) {
        finishAfterDecode();
      }
    });
  }

  async function preloadInitialCoverImages(albums) {
    if (!Array.isArray(albums) || albums.length === 0) return;

    const urls = [];
    const seen = new Set();
    const initialCount = getInitialCoverPreloadCount();

    for (const album of albums.slice(0, initialCount)) {
      const url = getCoverPreloadUrl(album);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }

    if (urls.length === 0) return;

    await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeoutFn(() => {
        if (settled) return;
        settled = true;
        resolve();
      }, INITIAL_COVER_PRELOAD_TIMEOUT_MS);
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeoutFn(timer);
        resolve();
      };

      Promise.all(urls.map(preloadCoverImage)).then(finish, finish);
    });
  }

  function hasRenderablePlaycounts(playcounts) {
    if (!playcounts || typeof playcounts !== 'object') return false;
    return Object.values(playcounts).some(
      (entry) =>
        entry && (entry.status === 'not_found' || entry.playcount != null)
    );
  }

  async function preloadInitialPlaycounts(listId, initialPlaycounts) {
    if (hasRenderablePlaycounts(initialPlaycounts)) {
      primePlaycountCache?.(initialPlaycounts);
      return { source: 'bootstrap', timedOut: false };
    }

    if (initialPlaycounts && typeof initialPlaycounts === 'object') {
      primePlaycountCache?.(initialPlaycounts);
    }

    if (!prefetchPlaycountsForRender) {
      return { source: 'none', timedOut: false };
    }

    let settled = false;
    let timeoutId = null;
    const prefetchPromise = prefetchPlaycountsForRender(listId)
      .then((response) => {
        settled = true;
        if (timeoutId !== null) clearTimeoutFn(timeoutId);
        return { source: 'prefetch', response, timedOut: false };
      })
      .catch((error) => {
        settled = true;
        if (timeoutId !== null) clearTimeoutFn(timeoutId);
        logger.warn('Early playcount fetch failed:', error);
        return { source: 'prefetch', response: null, timedOut: false };
      });

    const timeoutPromise = new Promise((resolve) => {
      timeoutId = setTimeoutFn(() => {
        if (settled) return;
        resolve({ source: 'prefetch', response: null, timedOut: true });
      }, INITIAL_PLAYCOUNT_PRELOAD_TIMEOUT_MS);
    });

    return Promise.race([prefetchPromise, timeoutPromise]);
  }

  return {
    preloadInitialCoverImages,
    preloadInitialPlaycounts,
  };
}
