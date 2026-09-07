import * as matching from '../../../utils/entity-matching.js';
import * as normalization from '../../../utils/normalization.js';
import {
  qualifiedArtistCandidates,
  firstWorkingArtistImage,
  verifyImageLoads,
} from './artist-image-loader.js';

export function qualifiedAlbumCandidates(artist, title, candidates) {
  const key = matching.externalMatchKey(
    normalization.stripEditionSuffix(title)
  );
  if (!key) return [];
  return qualifiedArtistCandidates(
    artist,
    candidates.filter(
      (a) =>
        matching.externalMatchKey(
          normalization.stripEditionSuffix(a.collectionName || '')
        ) === key
    ),
    (a) => a.artistName,
    (a) => a.artistId
  );
}

export function createCoverProviders({
  fetcher = fetch,
  verify = verifyImageLoads,
} = {}) {
  return [
    async ({ id }, signal, excluded) => {
      if (!id) return null;
      const url = `https://coverartarchive.org/release-group/${encodeURIComponent(id)}/front-250`;
      if (excluded.has(url)) throw new Error('Excluded cover');
      // An image error cannot distinguish a 404 from a temporary CDN failure.
      await verify(url, signal, 3000);
      return url;
    },
    async ({ artist, title }, signal, excluded) => {
      if (!artist || !title) return null;
      const response = await fetcher(
        `/api/proxy/itunes?term=${encodeURIComponent(`${artist} ${title}`)}&limit=10`,
        { signal, credentials: 'same-origin' }
      );
      if (!response.ok) throw new Error(`iTunes HTTP ${response.status}`);
      const data = await response.json();
      if (data.error || data.errorMessage || !Array.isArray(data.results))
        throw new Error('Invalid iTunes response');
      const urls = qualifiedAlbumCandidates(artist, title, data.results)
        .flatMap((a) =>
          a.artworkUrl100
            ? [
                a.artworkUrl100.replace(/\/\d+x\d+bb\./, '/200x200bb.'),
                a.artworkUrl100,
              ]
            : []
        )
        .filter((url) => !excluded.has(url));
      return firstWorkingArtistImage(urls, signal, verify);
    },
  ];
}

export function createAlbumCoverLoader({
  providers = createCoverProviders(),
  concurrency = 8,
  hedgeMs = 200,
  providerTimeoutMs = 3000,
  timeoutMs = 6000,
  positiveTtl = 30 * 60 * 1000,
  negativeTtl = 60 * 1000,
  maxEntries = 300,
  now = Date.now,
} = {}) {
  const cache = new Map();
  const queue = [];
  const inFlight = new WeakMap();
  let running = 0;
  const keyFor = ({ artist, title, id }) =>
    id ||
    JSON.stringify([
      matching.externalMatchKey(artist),
      matching.externalMatchKey(title),
    ]);
  const cached = (album) => {
    const key = keyFor(album);
    const entry = cache.get(key);
    if (entry?.expires > now()) return entry;
    cache.delete(key);
    return null;
  };
  const seed = (album, url) => {
    cache.delete(keyFor(album));
    cache.set(keyFor(album), {
      url,
      expires: now() + (url ? positiveTtl : negativeTtl),
    });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  };
  const drain = () => {
    while (running < concurrency && queue.length) queue.shift()();
  };
  function race(album, signal, excluded) {
    return new Promise((resolve) => {
      const controllers = new Set();
      const timers = new Set();
      let settled = false;
      let fallbackStarted = false;
      let completed = 0;
      let temporary = false;
      const finish = (url, cancelled = false) => {
        if (settled) return;
        settled = true;
        timers.forEach(clearTimeout);
        controllers.forEach((c) => c.abort());
        signal?.removeEventListener('abort', abort);
        if (!cancelled && (url || (!temporary && !excluded.size)))
          seed(album, url);
        resolve(cancelled ? null : url);
      };
      const abort = () => finish(null, true);
      const startFallback = () => {
        if (settled || fallbackStarted) return;
        fallbackStarted = true;
        run(1);
      };
      const run = (index) => {
        const controller = new AbortController();
        controllers.add(controller);
        let done = false;
        const complete = (url, failed) => {
          if (done || settled) return;
          done = true;
          clearTimeout(timer);
          controllers.delete(controller);
          controller.abort();
          temporary ||= failed;
          if (url && !excluded.has(url)) return finish(url);
          completed++;
          if (index === 0) startFallback();
          if (completed === 2) finish(null);
        };
        const timer = setTimeout(() => complete(null, true), providerTimeoutMs);
        timers.add(timer);
        Promise.resolve()
          .then(() => {
            if (controller.signal.aborted) throw new Error('Cancelled');
            return providers[index](album, controller.signal, excluded);
          })
          .then(
            (url) => complete(url, false),
            () => complete(null, true)
          );
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) return abort();
      timers.add(setTimeout(abort, timeoutMs));
      timers.add(setTimeout(startFallback, hedgeMs));
      run(0);
    });
  }
  return {
    peek: (album) => cached(album)?.url || null,
    seed,
    evict: (album) => cache.delete(keyFor(album)),
    search(album, signal, excluded = new Set()) {
      if (signal?.aborted) return Promise.resolve(null);
      const hit = cached(album);
      if (hit && !excluded.has(hit.url)) return Promise.resolve(hit.url);
      // Paging shares work only within a request, including its queued jobs.
      // Retry exclusions form a separate lookup, never the original promise.
      excluded = new Set(excluded);
      const scope = signal || null;
      let pending = scope && inFlight.get(scope);
      if (scope && !pending) {
        pending = new Map();
        inFlight.set(scope, pending);
      }
      const key = JSON.stringify([keyFor(album), [...excluded].sort()]);
      if (pending?.has(key)) return pending.get(key);
      const work = new Promise((resolve) => {
        const cancel = () => {
          const index = queue.indexOf(run);
          if (index >= 0) queue.splice(index, 1);
          resolve(null);
        };
        const run = () => {
          signal?.removeEventListener('abort', cancel);
          if (signal?.aborted) return resolve(null);
          const warmed = cached(album);
          if (warmed && !excluded.has(warmed.url)) return resolve(warmed.url);
          running++;
          race(album, signal, excluded)
            .then(resolve)
            .finally(() => {
              running--;
              drain();
            });
        };
        signal?.addEventListener('abort', cancel, { once: true });
        queue.push(run);
        drain();
      });
      const shared = work.finally(() => pending?.delete(key));
      pending?.set(key, shared);
      return shared;
    },
  };
}

// Warm covers bypass observation; cold work remains scoped to this renderer.
export function createAlbumCoverObserver(
  load,
  peek,
  root = null,
  Observer = globalThis.IntersectionObserver
) {
  let disconnected = false;
  const contexts = new WeakMap();
  const observer = Observer
    ? new Observer(
        (entries) => {
          if (disconnected) return;
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            const ctx = contexts.get(entry.target);
            contexts.delete(entry.target);
            if (ctx && !ctx.request?.signal.aborted) load(ctx);
          }
        },
        { root, rootMargin: '150px 0px' }
      )
    : null;
  return {
    observe(el, ctx) {
      if (disconnected || ctx.request?.signal.aborted) return;
      if (peek(ctx)) load(ctx);
      else if (observer) {
        contexts.set(el, ctx);
        observer.observe(el);
      }
      // Without an observer, do not eagerly fetch an unbounded hidden list.
    },
    disconnect() {
      disconnected = true;
      observer?.disconnect();
    },
  };
}
