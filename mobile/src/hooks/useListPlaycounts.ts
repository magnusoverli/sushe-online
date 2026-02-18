/**
 * useListPlaycounts - React Query hook for Last.fm playcounts per list.
 *
 * Fetches playcounts for all albums in the active list and returns
 * a map of list-item _id → playcount number.
 */

import { useQuery } from '@tanstack/react-query';
import { getListPlaycounts } from '@/services/lastfm';

/**
 * Fetch playcounts for a list and return a map of item _id → playcount.
 *
 * @param listId - The active list ID (null disables the query)
 * @param lastfmConnected - Whether the user has Last.fm connected
 */
export function useListPlaycounts(
  listId: string | null,
  lastfmConnected: boolean
) {
  const { data, isLoading } = useQuery({
    queryKey: ['lastfm', 'playcounts', listId],
    queryFn: async () => {
      const response = await getListPlaycounts(listId!);
      // Transform to a simple id → playcount map, only including successful lookups
      const map: Record<string, number> = {};
      for (const [itemId, entry] of Object.entries(response.playcounts)) {
        if (entry && entry.status === 'success' && entry.playcount > 0) {
          map[itemId] = entry.playcount;
        }
      }
      return map;
    },
    enabled: !!listId && lastfmConnected,
    staleTime: 5 * 60 * 1000, // 5 minutes
    // Playcounts are non-critical; don't retry aggressively
    retry: 1,
  });

  return {
    playcounts: data ?? ({} as Record<string, number>),
    isLoading,
  };
}
