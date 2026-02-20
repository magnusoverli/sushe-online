/**
 * Search Service - MusicBrainz search for adding albums to lists.
 *
 * Uses the server-side MusicBrainz proxy to avoid CORS and rate limits.
 * Two search modes: Artist (browse discography) and Album (direct search).
 */

import { api } from './api-client';
import type { MBArtistResult, MBAlbumResult } from '@/lib/types';

// ── Raw MusicBrainz response shapes ──

interface MBArtistRaw {
  id: string;
  name: string;
  disambiguation?: string;
  country?: string;
  type?: string;
  score: number;
}

interface MBReleaseGroupRaw {
  id: string;
  title: string;
  'primary-type'?: string;
  'secondary-types'?: string[];
  'first-release-date'?: string;
  'artist-credit'?: { name: string; artist: { id: string } }[];
}

// ── Public API ──

/**
 * Search for artists by name.
 */
export async function searchArtists(query: string): Promise<MBArtistResult[]> {
  const endpoint = `artist/?query=${encodeURIComponent(query)}&fmt=json&limit=20`;
  const data = await api.get<{ artists?: MBArtistRaw[] }>(
    `/api/proxy/musicbrainz?endpoint=${encodeURIComponent(endpoint)}&priority=high`
  );

  return (data.artists ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    disambiguation: a.disambiguation,
    country: a.country,
    type: a.type,
    score: a.score,
  }));
}

/**
 * Search for albums (release groups) directly by name.
 */
export async function searchAlbums(query: string): Promise<MBAlbumResult[]> {
  const endpoint = `release-group/?query=${encodeURIComponent(query)}&type=album|ep&fmt=json&limit=20`;
  const data = await api.get<{ 'release-groups'?: MBReleaseGroupRaw[] }>(
    `/api/proxy/musicbrainz?endpoint=${encodeURIComponent(endpoint)}&priority=high`
  );

  return parseReleaseGroups(data['release-groups'] ?? []);
}

/**
 * Get albums (release groups) for a specific artist.
 */
export async function getArtistAlbums(
  artistId: string
): Promise<MBAlbumResult[]> {
  const endpoint = `release-group?artist=${artistId}&type=album|ep&inc=artist-credits&fmt=json&limit=100`;
  const data = await api.get<{ 'release-groups'?: MBReleaseGroupRaw[] }>(
    `/api/proxy/musicbrainz?endpoint=${encodeURIComponent(endpoint)}&priority=high`
  );

  return parseReleaseGroups(data['release-groups'] ?? []);
}

/**
 * Build a Cover Art Archive thumbnail URL for a release group.
 */
export function getCoverArtUrl(releaseGroupId: string): string {
  return `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`;
}

// =============================================================================
// SHARED UTILITIES
// =============================================================================

const ITUNES_IMAGE_SIZE = 600;

/** CDN hosts used for image loading — preconnect to these for faster TLS. */
const IMAGE_CDN_HOSTS = [
  'https://coverartarchive.org',
  'https://archive.org',
  'https://e-cdns-images.dzcdn.net',
  'https://is1-ssl.mzstatic.com',
  'https://commons.wikimedia.org',
];

let preconnected = false;

/**
 * Inject <link rel="preconnect"> tags for all image CDNs.
 * Called once when the AddAlbumSheet opens. Saves ~100-200ms per CDN.
 */
export function warmupImageConnections(): void {
  if (preconnected) return;
  preconnected = true;

  for (const href of IMAGE_CDN_HOSTS) {
    const existing = document.querySelector(
      `link[rel="preconnect"][href="${href}"]`
    );
    if (!existing) {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = href;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }
  }
}

/**
 * Simple bigram-based string similarity (0..1).
 */
function stringSimilarity(a: string, b: string): number {
  const lower1 = a.toLowerCase();
  const lower2 = b.toLowerCase();
  if (lower1 === lower2) return 1;
  if (lower1.length < 2 || lower2.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < lower1.length - 1; i++) {
    const bigram = lower1.substring(i, i + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }

  let intersect = 0;
  for (let i = 0; i < lower2.length - 1; i++) {
    const bigram = lower2.substring(i, i + 2);
    const count = bigrams.get(bigram) ?? 0;
    if (count > 0) {
      bigrams.set(bigram, count - 1);
      intersect++;
    }
  }

  return (2 * intersect) / (lower1.length - 1 + (lower2.length - 1));
}

/**
 * Normalize a string for external API matching (strip diacritics).
 */
function normalizeForApi(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Verify an image URL actually loads (not a placeholder / broken).
 * Only used for Wikidata where placeholder images are common.
 */
function verifyImageLoads(url: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    const abortHandler = () => {
      img.src = '';
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abortHandler);

    img.onload = () => {
      signal?.removeEventListener('abort', abortHandler);
      if (img.naturalWidth > 1 && img.naturalHeight > 1) {
        resolve(url);
      } else {
        reject(new Error('Invalid image dimensions'));
      }
    };

    img.onerror = () => {
      signal?.removeEventListener('abort', abortHandler);
      reject(new Error('Image failed to load'));
    };

    img.src = url;
  });
}

/**
 * Race multiple promises — first to resolve with a truthy value wins.
 * Rejects only when ALL promises have settled without a winner.
 */
function raceProviders<T>(promises: Promise<T | null>[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = 0;
    const total = promises.length;

    for (const p of promises) {
      p.then((result) => {
        if (result) {
          resolve(result);
        } else {
          settled++;
          if (settled >= total) reject(new Error('All providers failed'));
        }
      }).catch(() => {
        settled++;
        if (settled >= total) reject(new Error('All providers failed'));
      });
    }
  });
}

// =============================================================================
// ARTIST IMAGE RACING SYSTEM
// Fires 3 providers in parallel (Deezer, iTunes, Wikidata).
// Deezer and iTunes skip image verification (reliable URLs).
// Wikidata keeps verification (can return placeholders).
// =============================================================================

/** In-memory cache: artistId|name → URL | null */
const artistImageCache = new Map<string, string | null>();

// ── Provider: Deezer (artist) ──

interface DeezerArtist {
  name: string;
  picture_xl?: string;
  picture_big?: string;
  picture_medium?: string;
}

async function searchDeezerArtist(
  artistName: string,
  signal: AbortSignal
): Promise<string | null> {
  const q = normalizeForApi(artistName);
  const res = await fetch(
    `/api/proxy/deezer/artist?q=${encodeURIComponent(q)}`,
    { signal, credentials: 'same-origin' }
  );
  if (!res.ok) return null;

  const data = (await res.json()) as { data?: DeezerArtist[] };
  if (!data.data?.length) return null;

  const lower = artistName.toLowerCase();
  let best: DeezerArtist | undefined = data.data.find(
    (a) => a.name.toLowerCase() === lower
  );

  if (!best) {
    let bestScore = 0;
    for (const a of data.data) {
      const score = stringSimilarity(artistName, a.name);
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    if (bestScore < 0.7) return null;
  }

  // Skip verifyImageLoads — Deezer reliably returns valid URLs
  return best?.picture_xl ?? best?.picture_big ?? best?.picture_medium ?? null;
}

// ── Provider: iTunes (artist image via album art) ──

interface ITunesAlbum {
  artistName?: string;
  artworkUrl100?: string;
}

async function searchItunesArtist(
  artistName: string,
  signal: AbortSignal
): Promise<string | null> {
  const term = normalizeForApi(artistName);
  const res = await fetch(
    `/api/proxy/itunes?term=${encodeURIComponent(term)}&limit=10`,
    { signal, credentials: 'same-origin' }
  );
  if (!res.ok) return null;

  const data = (await res.json()) as { results?: ITunesAlbum[] };
  if (!data.results?.length) return null;

  let bestAlbum: ITunesAlbum | null = null;
  let bestScore = 0;

  for (const album of data.results) {
    if (!album.artistName || !album.artworkUrl100) continue;
    const score = stringSimilarity(artistName, album.artistName);
    if (score > bestScore) {
      bestScore = score;
      bestAlbum = album;
    }
  }

  if (!bestAlbum || bestScore < 0.7 || !bestAlbum.artworkUrl100) return null;

  // Skip verifyImageLoads — iTunes reliably returns valid URLs
  return bestAlbum.artworkUrl100.replace(
    /\/\d+x\d+bb\./,
    `/${ITUNES_IMAGE_SIZE}x${ITUNES_IMAGE_SIZE}bb.`
  );
}

// ── Provider: Wikidata via MusicBrainz (keeps verification) ──

interface MBRelation {
  type: string;
  url?: { resource?: string };
}

interface WikidataClaims {
  claims?: {
    P18?: Array<{
      mainsnak?: { datavalue?: { value?: string } };
    }>;
  };
}

async function searchWikidata(
  artistId: string | undefined,
  signal: AbortSignal
): Promise<string | null> {
  if (!artistId) return null;

  const mbEndpoint = `artist/${artistId}?inc=url-rels&fmt=json`;
  const mbRes = await fetch(
    `/api/proxy/musicbrainz?endpoint=${encodeURIComponent(mbEndpoint)}&priority=low`,
    { signal, credentials: 'same-origin' }
  );
  if (!mbRes.ok) return null;

  const mbData = (await mbRes.json()) as { relations?: MBRelation[] };
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!mbData.relations) return null;

  const wikidataRel = mbData.relations.find(
    (r) => r.type === 'wikidata' && r.url?.resource
  );
  if (!wikidataRel?.url?.resource) return null;

  const wikidataId = wikidataRel.url.resource.split('/').pop();

  const wdRes = await fetch(
    `/api/proxy/wikidata?entity=${encodeURIComponent(wikidataId!)}&property=P18`,
    { signal, credentials: 'same-origin' }
  );
  if (!wdRes.ok) return null;

  const wdData = (await wdRes.json()) as WikidataClaims;
  const filename = wdData.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (!filename) return null;

  const encoded = encodeURIComponent(filename.replace(/ /g, '_'));
  const imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=500`;

  // Keep verification for Wikidata — can return placeholders
  await verifyImageLoads(imageUrl, signal);
  return imageUrl;
}

// ── Public: Race artist image providers ──

/**
 * Search for an artist image by racing Deezer, iTunes, and Wikidata.
 * Returns the first image URL, or null. Results are cached in memory.
 */
export async function searchArtistImage(
  artistName: string,
  artistId?: string,
  signal?: AbortSignal
): Promise<string | null> {
  if (signal?.aborted) return null;

  const cacheKey = artistId ?? artistName.toLowerCase();
  if (artistImageCache.has(cacheKey)) {
    return artistImageCache.get(cacheKey)!;
  }

  const controller = new AbortController();
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const url = await raceProviders([
      searchDeezerArtist(artistName, controller.signal),
      searchItunesArtist(artistName, controller.signal),
      searchWikidata(artistId, controller.signal),
    ]);

    controller.abort();
    artistImageCache.set(cacheKey, url);
    return url;
  } catch {
    if (!signal?.aborted) {
      artistImageCache.set(cacheKey, null);
    }
    return null;
  }
}

// =============================================================================
// ALBUM COVER ART RACING SYSTEM
// Races Cover Art Archive, server-side image proxy, Deezer, and iTunes.
// Concurrency-limited to avoid thundering herd on external APIs.
// =============================================================================

/** In-memory cache: releaseGroupId → URL | null */
const coverArtCache = new Map<string, string | null>();

/**
 * Get a cached cover art URL for a release group (album_id).
 * Returns the URL if previously resolved by the racing system, or undefined.
 * Used by LibraryPage to show covers instantly for just-added albums
 * before the server-side background fetch completes.
 */
export function getCachedCoverArt(
  releaseGroupId: string | undefined
): string | undefined {
  if (!releaseGroupId) return undefined;
  return coverArtCache.get(releaseGroupId) ?? undefined;
}

/**
 * Concurrency limiter for the heavy CAA image proxy only.
 * Deezer/iTunes are lightweight API calls and don't need limiting.
 */
const CAA_PROXY_CONCURRENCY = 4;
let caaInFlight = 0;
const caaQueue: Array<() => void> = [];

function runWithCaaConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const execute = () => {
      caaInFlight++;
      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          caaInFlight--;
          if (caaQueue.length > 0) {
            const next = caaQueue.shift()!;
            next();
          }
        });
    };

    if (caaInFlight < CAA_PROXY_CONCURRENCY) {
      execute();
    } else {
      caaQueue.push(execute);
    }
  });
}

// ── Cover provider: Server-side image proxy (handles CAA redirects) ──

async function searchCoverProxy(
  releaseGroupId: string,
  signal: AbortSignal
): Promise<string | null> {
  // Concurrency-limit CAA proxy calls (heavy: redirects + sharp resize)
  return runWithCaaConcurrency(async () => {
    const caaUrl = `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`;
    const proxyUrl = `/api/proxy/image?url=${encodeURIComponent(caaUrl)}`;
    const res = await fetch(proxyUrl, { signal, credentials: 'same-origin' });
    if (!res.ok) return null;

    // Proxy returns JSON { data: base64, contentType: "image/jpeg" }
    const json = (await res.json()) as { data?: string; contentType?: string };
    if (!json.data) return null;

    return `data:${json.contentType ?? 'image/jpeg'};base64,${json.data}`;
  });
}

// ── Cover provider: Deezer album search ──

interface DeezerAlbumResult {
  title: string;
  artist?: { name?: string };
  cover_xl?: string;
  cover_big?: string;
  cover_medium?: string;
}

async function searchCoverDeezer(
  artist: string,
  album: string,
  signal: AbortSignal
): Promise<string | null> {
  const q = normalizeForApi(`${artist} ${album}`);
  const res = await fetch(`/api/proxy/deezer?q=${encodeURIComponent(q)}`, {
    signal,
    credentials: 'same-origin',
  });
  if (!res.ok) return null;

  const data = (await res.json()) as { data?: DeezerAlbumResult[] };
  if (!data.data?.length) return null;

  // Find best match by album title similarity
  let best: DeezerAlbumResult | null = null;
  let bestScore = 0;

  for (const d of data.data) {
    const titleScore = stringSimilarity(album, d.title);
    const artistScore = d.artist?.name
      ? stringSimilarity(artist, d.artist.name)
      : 0;
    const combined = titleScore * 0.6 + artistScore * 0.4;
    if (combined > bestScore) {
      bestScore = combined;
      best = d;
    }
  }

  if (!best || bestScore < 0.5) return null;
  return best.cover_xl ?? best.cover_big ?? best.cover_medium ?? null;
}

// ── Cover provider: iTunes album search ──

async function searchCoverItunes(
  artist: string,
  album: string,
  signal: AbortSignal
): Promise<string | null> {
  const term = normalizeForApi(`${artist} ${album}`);
  const res = await fetch(
    `/api/proxy/itunes?term=${encodeURIComponent(term)}&limit=5`,
    { signal, credentials: 'same-origin' }
  );
  if (!res.ok) return null;

  const data = (await res.json()) as {
    results?: Array<{
      collectionName?: string;
      artistName?: string;
      artworkUrl100?: string;
    }>;
  };
  if (!data.results?.length) return null;

  let best: (typeof data.results)[0] | null = null;
  let bestScore = 0;

  for (const r of data.results) {
    if (!r.artworkUrl100) continue;
    const titleScore = stringSimilarity(album, r.collectionName ?? '');
    const artistScore = stringSimilarity(artist, r.artistName ?? '');
    const combined = titleScore * 0.6 + artistScore * 0.4;
    if (combined > bestScore) {
      bestScore = combined;
      best = r;
    }
  }

  if (!best || bestScore < 0.5 || !best.artworkUrl100) return null;
  return best.artworkUrl100.replace(
    /\/\d+x\d+bb\./,
    `/${ITUNES_IMAGE_SIZE}x${ITUNES_IMAGE_SIZE}bb.`
  );
}

// ── Public: Race cover art providers ──

/**
 * Search for album cover art by racing Deezer, iTunes, and CAA proxy.
 * Deezer/iTunes fire freely (lightweight). CAA proxy is concurrency-limited.
 * Results are cached in memory.
 */
export async function searchCoverArt(
  releaseGroupId: string,
  artist: string,
  album: string,
  signal?: AbortSignal
): Promise<string | null> {
  if (signal?.aborted) return null;

  if (coverArtCache.has(releaseGroupId)) {
    return coverArtCache.get(releaseGroupId)!;
  }

  const controller = new AbortController();
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const url = await raceProviders([
      searchCoverDeezer(artist, album, controller.signal),
      searchCoverItunes(artist, album, controller.signal),
      searchCoverProxy(releaseGroupId, controller.signal),
    ]);

    controller.abort();
    coverArtCache.set(releaseGroupId, url);
    return url;
  } catch {
    if (!signal?.aborted) {
      coverArtCache.set(releaseGroupId, null);
    }
    return null;
  }
}

// ── Helpers ──

function parseReleaseGroups(groups: MBReleaseGroupRaw[]): MBAlbumResult[] {
  return groups
    .filter((rg) => {
      const primary = rg['primary-type'] ?? '';
      const secondary = rg['secondary-types'] ?? [];
      // Keep albums and EPs, skip compilations/soundtracks/etc.
      if (!['Album', 'EP'].includes(primary)) return false;
      if (
        secondary.some((s) =>
          ['Compilation', 'Soundtrack', 'Live', 'Remix', 'DJ-mix'].includes(s)
        )
      ) {
        return false;
      }
      return true;
    })
    .map((rg) => {
      const artistCredit = rg['artist-credit']?.[0];
      return {
        id: rg.id,
        title: rg.title,
        artist: artistCredit?.name ?? 'Unknown Artist',
        artistId: artistCredit?.artist?.id,
        releaseDate: rg['first-release-date'] || null,
        type: rg['primary-type'] ?? 'Album',
        secondaryTypes: rg['secondary-types'] ?? [],
      };
    })
    .sort((a, b) => {
      // Sort by release date descending (newest first)
      const dateA = a.releaseDate ?? '';
      const dateB = b.releaseDate ?? '';
      return dateB.localeCompare(dateA);
    });
}
