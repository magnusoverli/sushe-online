/**
 * usePreferences - React Query hooks for preferences data.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPreferences, syncPreferences } from '@/services/preferences';
import { showToast } from '@/components/ui/Toast';

export function usePreferences() {
  return useQuery({
    queryKey: ['preferences'],
    queryFn: getPreferences,
    staleTime: 60_000,
  });
}

export function useSyncPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: syncPreferences,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] });
      const msg =
        result.errors.length > 0
          ? `Synced with ${result.errors.length} error(s)`
          : 'Preferences synced';
      showToast(msg, result.errors.length > 0 ? 'error' : 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Sync failed', 'error');
    },
  });
}
