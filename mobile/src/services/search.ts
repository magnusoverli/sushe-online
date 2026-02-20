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
 * Returns null if unavailable (caller should handle fallback).
 */
export function getCoverArtUrl(releaseGroupId: string): string {
  return `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`;
}

// ── Artist Image Racing System ──
// Fires 3 providers in parallel (Deezer, iTunes, Wikidata).
// First verified image wins; losers are aborted.

/** In-memory cache: artistId|name → URL | null */
const artistImageCache = new Map<string, string | null>();

const ITUNES_IMAGE_SIZE = 600;

/**
 * Simple bigram-based string similarity (0..1).
 * Good enough for fuzzy artist name matching.
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
 * Returns the URL on success, rejects on failure.
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

// ── Provider: Deezer ──

interface DeezerArtist {
  name: string;
  picture_xl?: string;
  picture_big?: string;
  picture_medium?: string;
}

async function searchDeezer(
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

  const imageUrl =
    best?.picture_xl ?? best?.picture_big ?? best?.picture_medium;
  if (!imageUrl) return null;

  await verifyImageLoads(imageUrl, signal);
  return imageUrl;
}

// ── Provider: iTunes ──

interface ITunesAlbum {
  artistName?: string;
  artworkUrl100?: string;
}

async function searchItunes(
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

  const imageUrl = bestAlbum.artworkUrl100.replace(
    /\/\d+x\d+bb\./,
    `/${ITUNES_IMAGE_SIZE}x${ITUNES_IMAGE_SIZE}bb.`
  );

  await verifyImageLoads(imageUrl, signal);
  return imageUrl;
}

// ── Provider: Wikidata via MusicBrainz ──

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

  // Step 1: Get Wikidata ID from MusicBrainz relations
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

  // Step 2: Get image filename from Wikidata P18 property
  const wdRes = await fetch(
    `/api/proxy/wikidata?entity=${encodeURIComponent(wikidataId!)}&property=P18`,
    { signal, credentials: 'same-origin' }
  );
  if (!wdRes.ok) return null;

  const wdData = (await wdRes.json()) as WikidataClaims;
  const filename = wdData.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (!filename) return null;

  // Step 3: Build Wikimedia Commons URL
  const encoded = encodeURIComponent(filename.replace(/ /g, '_'));
  const imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=500`;

  await verifyImageLoads(imageUrl, signal);
  return imageUrl;
}

// ── Public: Race all providers ──

/**
 * Search for an artist image by racing Deezer, iTunes, and Wikidata.
 * Returns the first verified image URL, or null if none found.
 * Results are cached in memory.
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

  const providers = [
    searchDeezer(artistName, controller.signal),
    searchItunes(artistName, controller.signal),
    searchWikidata(artistId, controller.signal),
  ];

  try {
    // Race: first provider to resolve with a URL wins.
    // Wrap each so failures become never-resolving (until all settle).
    const url = await new Promise<string>((resolve, reject) => {
      let settled = 0;
      const total = providers.length;

      for (const p of providers) {
        p.then((result) => {
          if (result) {
            resolve(result);
          } else {
            settled++;
            if (settled >= total) reject(new Error('All failed'));
          }
        }).catch(() => {
          settled++;
          if (settled >= total) reject(new Error('All failed'));
        });
      }
    });

    controller.abort(); // Cancel remaining providers
    artistImageCache.set(cacheKey, url);
    return url;
  } catch {
    // All providers failed (or aborted)
    if (!signal?.aborted) {
      artistImageCache.set(cacheKey, null);
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
