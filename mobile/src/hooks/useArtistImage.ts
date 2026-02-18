/**
 * useArtistImage - Fetches artist images from the Deezer API.
 *
 * Uses a simple in-memory cache (Map) shared across all component instances.
 * The Deezer search endpoint is public, fast, and doesn't require auth.
 */

import { useState, useEffect } from 'react';

/** Module-level cache: artist name (lowercased) → image URL or null. */
const imageCache = new Map<string, string | null>();

/** Pending fetches to avoid duplicate in-flight requests. */
const pendingFetches = new Map<string, Promise<string | null>>();

/**
 * Fetch an artist image URL from the Deezer search API.
 * Returns `picture_medium` (300x300) from the first search result, or null.
 */
async function fetchDeezerArtistImage(
  artistName: string
): Promise<string | null> {
  try {
    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const json = await res.json();
    const picture: string | undefined = json?.data?.[0]?.picture_medium;

    // Deezer sometimes returns a placeholder "no image" URL — treat as null.
    if (!picture || picture.includes('/artist//')) return null;
    return picture;
  } catch {
    return null;
  }
}

/**
 * Look up or fetch an artist image, deduplicating in-flight requests.
 */
function getArtistImage(artistName: string): Promise<string | null> {
  const key = artistName.toLowerCase();

  if (imageCache.has(key)) {
    return Promise.resolve(imageCache.get(key)!);
  }

  if (pendingFetches.has(key)) {
    return pendingFetches.get(key)!;
  }

  const promise = fetchDeezerArtistImage(artistName).then((url) => {
    imageCache.set(key, url);
    pendingFetches.delete(key);
    return url;
  });

  pendingFetches.set(key, promise);
  return promise;
}

/**
 * React hook that returns the Deezer image URL for an artist.
 *
 * @param artistName - The artist to look up (empty string skips the fetch).
 * @returns `{ imageUrl, isLoading }`
 */
export function useArtistImage(artistName: string): {
  imageUrl: string | null;
  isLoading: boolean;
} {
  const key = artistName.toLowerCase();
  const cached = artistName ? imageCache.get(key) : undefined;

  const [imageUrl, setImageUrl] = useState<string | null>(cached ?? null);
  const [isLoading, setIsLoading] = useState(
    !!artistName && cached === undefined
  );

  useEffect(() => {
    if (!artistName) {
      setImageUrl(null);
      setIsLoading(false);
      return;
    }

    // Already cached (including null = "not found").
    if (imageCache.has(key)) {
      setImageUrl(imageCache.get(key)!);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    getArtistImage(artistName).then((url) => {
      if (!cancelled) {
        setImageUrl(url);
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [artistName, key]);

  return { imageUrl, isLoading };
}

/**
 * Clear the image cache. Useful in tests.
 */
export function clearImageCache(): void {
  imageCache.clear();
  pendingFetches.clear();
}
