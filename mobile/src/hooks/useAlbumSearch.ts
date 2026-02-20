/**
 * useAlbumSearch - React Query hooks for MusicBrainz album search.
 *
 * Provides hooks for artist search, album search, and fetching
 * an artist's discography. All queries are manual (enabled: false)
 * so they only fire when explicitly triggered.
 *
 * Also includes useArtistImage for lazy-loading artist thumbnails
 * via the racing provider system (Deezer, iTunes, Wikidata).
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  searchArtists,
  searchAlbums,
  getArtistAlbums,
  searchArtistImage,
  searchCoverArt,
} from '@/services/search';

/**
 * Search artists by name. Manual trigger via refetch().
 */
export function useArtistSearch(query: string) {
  return useQuery({
    queryKey: ['search', 'artists', query],
    queryFn: () => searchArtists(query),
    enabled: false,
    staleTime: 5 * 60_000,
  });
}

/**
 * Search albums by name. Manual trigger via refetch().
 */
export function useAlbumSearch(query: string) {
  return useQuery({
    queryKey: ['search', 'albums', query],
    queryFn: () => searchAlbums(query),
    enabled: false,
    staleTime: 5 * 60_000,
  });
}

/**
 * Fetch albums for a specific artist. Auto-triggers when artistId is set.
 */
export function useArtistAlbums(artistId: string | null) {
  return useQuery({
    queryKey: ['search', 'artist-albums', artistId],
    queryFn: () => getArtistAlbums(artistId!),
    enabled: !!artistId,
    staleTime: 5 * 60_000,
  });
}

/**
 * Lazy-load an artist image via the racing provider system.
 * Returns { imageUrl, loading } — imageUrl is null until resolved.
 * Aborts in-flight requests on unmount or when artist changes.
 */
export function useArtistImage(
  artistName: string | undefined,
  artistId: string | undefined
): { imageUrl: string | null; loading: boolean } {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!artistName) {
      setImageUrl(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setImageUrl(null);

    searchArtistImage(artistName, artistId, controller.signal)
      .then((url) => {
        if (!controller.signal.aborted) {
          setImageUrl(url);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setImageUrl(null);
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [artistName, artistId]);

  return { imageUrl, loading };
}

/**
 * Lazy-load album cover art via the racing provider system.
 * Returns { coverUrl } — null until resolved, stays null on failure.
 * Aborts in-flight requests on unmount or when album changes.
 */
export function useCoverArt(
  releaseGroupId: string | undefined,
  artist: string | undefined,
  album: string | undefined
): { coverUrl: string | null } {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!releaseGroupId || !artist || !album) {
      setCoverUrl(null);
      return;
    }

    const controller = new AbortController();
    setCoverUrl(null);

    searchCoverArt(releaseGroupId, artist, album, controller.signal)
      .then((url) => {
        if (!controller.signal.aborted) {
          setCoverUrl(url);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCoverUrl(null);
        }
      });

    return () => controller.abort();
  }, [releaseGroupId, artist, album]);

  return { coverUrl };
}
