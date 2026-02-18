/**
 * useRecommendations - Hooks for recommendation data fetching and mutations.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getRecommendationYears,
  getRecommendations,
  getRecommendationStatus,
  addRecommendation,
  editReasoning,
  removeRecommendation,
} from '@/services/recommendations';
import { showToast } from '@/components/ui/Toast';

/** Get all years with recommendations. */
export function useRecommendationYears() {
  return useQuery({
    queryKey: ['recommendations', 'years'],
    queryFn: getRecommendationYears,
    staleTime: 5 * 60_000,
  });
}

/** Get recommendations for a specific year. */
export function useRecommendationsForYear(year: number | null) {
  return useQuery({
    queryKey: ['recommendations', year],
    queryFn: () => getRecommendations(year!),
    enabled: year !== null,
    staleTime: 60_000,
  });
}

/** Get recommendation status for a specific year. */
export function useRecommendationStatus(year: number | null) {
  return useQuery({
    queryKey: ['recommendations', year, 'status'],
    queryFn: () => getRecommendationStatus(year!),
    enabled: year !== null,
    staleTime: 60_000,
  });
}

/** Add a recommendation. */
export function useAddRecommendation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      year,
      album,
      reasoning,
    }: {
      year: number;
      album: {
        artist: string;
        album: string;
        release_date?: string;
        country?: string;
        genre_1?: string;
        genre_2?: string;
      };
      reasoning: string;
    }) => addRecommendation(year, album, reasoning),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['recommendations', variables.year],
      });
      queryClient.invalidateQueries({
        queryKey: ['recommendations', 'years'],
      });
      showToast('Album recommended', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to recommend', 'error');
    },
  });
}

/** Edit own reasoning. */
export function useEditReasoning() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      year,
      albumId,
      reasoning,
    }: {
      year: number;
      albumId: string;
      reasoning: string;
    }) => editReasoning(year, albumId, reasoning),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['recommendations', variables.year],
      });
      showToast('Reasoning updated', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to update', 'error');
    },
  });
}

/** Remove a recommendation (admin only). */
export function useRemoveRecommendation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ year, albumId }: { year: number; albumId: string }) =>
      removeRecommendation(year, albumId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['recommendations', variables.year],
      });
      showToast('Recommendation removed', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to remove', 'error');
    },
  });
}
