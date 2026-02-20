/**
 * useSettings - Hooks for settings data fetching and mutations.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import {
  getSystemStats,
  getAdminStats,
  getAdminEvents,
  getAdminEventCounts,
  executeEventAction,
  updateAccentColor,
  updateTimeFormat,
  updateDateFormat,
  updateMusicService,
  updatePreferredUi,
  updateEmail,
  updateUsername,
  changePassword,
  requestAdmin,
  makeAdmin,
  revokeAdmin,
  deleteUser,
  scanDuplicates,
  mergeAlbums,
  markAlbumsDistinct,
  auditManualAlbums,
  mergeManualAlbum,
  getRecommendationYearsAdmin,
  getLockedRecommendationYears,
  lockRecommendationYear,
  unlockRecommendationYear,
  getTelegramStatus,
  getTelegramRecsStatus,
  sendTelegramTest,
  toggleTelegramRecs,
  disconnectTelegram,
  getAggregateYears,
  getAggregateStatus,
  getAggregateStats,
  confirmAggregateReveal,
  revokeAggregateConfirmation,
  recomputeAggregate,
  lockAggregateYear,
  unlockAggregateYear,
  reidentifySearch,
  applyReidentification,
} from '@/services/settings';
import { showToast } from '@/components/ui/Toast';
import { checkSession } from '@/services/auth';

/** Refresh the user session to pick up changed fields. */
function useRefreshSession() {
  const queryClient = useQueryClient();
  const setUser = useAppStore((s) => s.setUser);

  return async () => {
    const session = await checkSession();
    if (session.authenticated && session.user) {
      setUser(session.user);
    }
    queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
  };
}

/** Hook for simple setting mutations that refresh the session afterward. */
function useSettingMutation<TData>(
  mutationFn: (data: TData) => Promise<{ success: boolean }>,
  successMessage: string
) {
  const refreshSession = useRefreshSession();

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await refreshSession();
      showToast(successMessage, 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Update failed', 'error');
    },
  });
}

// ── Setting mutations ──

export function useUpdateAccentColor() {
  return useSettingMutation(updateAccentColor, 'Accent color updated');
}

export function useUpdateTimeFormat() {
  return useSettingMutation(updateTimeFormat, 'Time format updated');
}

export function useUpdateDateFormat() {
  return useSettingMutation(updateDateFormat, 'Date format updated');
}

export function useUpdateMusicService() {
  return useSettingMutation(
    (val: string | null) => updateMusicService(val),
    'Music service updated'
  );
}

export function useUpdatePreferredUi() {
  return useSettingMutation(
    (val: string | null) => updatePreferredUi(val),
    'Interface preference updated'
  );
}

export function useUpdateEmail() {
  return useSettingMutation(updateEmail, 'Email updated');
}

export function useUpdateUsername() {
  return useSettingMutation(updateUsername, 'Username updated');
}

export function useChangePassword() {
  return useSettingMutation(changePassword, 'Password changed');
}

export function useRequestAdmin() {
  return useSettingMutation(requestAdmin, 'Admin access granted');
}

// ── Stats queries ──

export function useSystemStats(enabled = true) {
  return useQuery({
    queryKey: ['stats', 'system'],
    queryFn: getSystemStats,
    staleTime: 60_000,
    enabled,
  });
}

export function useAdminStats(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: getAdminStats,
    staleTime: 60_000,
    enabled,
  });
}

// ── Admin event queries + mutations ──

export function useAdminEvents(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'events'],
    queryFn: () => getAdminEvents(),
    staleTime: 30_000,
    enabled,
  });
}

export function useAdminEventCounts(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'events', 'counts'],
    queryFn: getAdminEventCounts,
    staleTime: 30_000,
    enabled,
  });
}

export function useExecuteEventAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ eventId, action }: { eventId: string; action: string }) =>
      executeEventAction(eventId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'events'] });
      showToast('Action completed', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Action failed', 'error');
    },
  });
}

// ── Admin user management mutations ──

export function useMakeAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: makeAdmin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      showToast('Admin role granted', 'success');
    },
    onError: (err: Error) => showToast(err.message, 'error'),
  });
}

export function useRevokeAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeAdmin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      showToast('Admin role revoked', 'success');
    },
    onError: (err: Error) => showToast(err.message, 'error'),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      showToast('User deleted', 'success');
    },
    onError: (err: Error) => showToast(err.message, 'error'),
  });
}

// ── Admin: Duplicate Scanner ──

export function useScanDuplicates() {
  return useMutation({
    mutationFn: (threshold: number) => scanDuplicates(threshold),
    onError: (err: Error) => showToast(err.message || 'Scan failed', 'error'),
  });
}

export function useMergeAlbums() {
  return useMutation({
    mutationFn: ({
      keepAlbumId,
      deleteAlbumId,
    }: {
      keepAlbumId: string;
      deleteAlbumId: string;
    }) => mergeAlbums(keepAlbumId, deleteAlbumId),
    onSuccess: () => showToast('Albums merged', 'success'),
    onError: (err: Error) => showToast(err.message || 'Merge failed', 'error'),
  });
}

export function useMarkDistinct() {
  return useMutation({
    mutationFn: ({
      albumId1,
      albumId2,
    }: {
      albumId1: string;
      albumId2: string;
    }) => markAlbumsDistinct(albumId1, albumId2),
    onSuccess: () => showToast('Marked as distinct', 'success'),
    onError: (err: Error) =>
      showToast(err.message || 'Failed to mark distinct', 'error'),
  });
}

// ── Admin: Manual Album Audit ──

export function useAuditManualAlbums() {
  return useMutation({
    mutationFn: (threshold: number) => auditManualAlbums(threshold),
    onError: (err: Error) => showToast(err.message || 'Audit failed', 'error'),
  });
}

export function useMergeManualAlbum() {
  return useMutation({
    mutationFn: ({
      manualAlbumId,
      canonicalAlbumId,
    }: {
      manualAlbumId: string;
      canonicalAlbumId: string;
    }) => mergeManualAlbum(manualAlbumId, canonicalAlbumId),
    onSuccess: () => showToast('Album reconciled', 'success'),
    onError: (err: Error) =>
      showToast(err.message || 'Reconciliation failed', 'error'),
  });
}

// ── Admin: Recommendation Lock ──

export function useRecommendationYearsAdmin() {
  return useQuery({
    queryKey: ['admin', 'recommendation-years'],
    queryFn: getRecommendationYearsAdmin,
    staleTime: 60_000,
  });
}

export function useLockedRecommendationYears() {
  return useQuery({
    queryKey: ['admin', 'recommendation-locked-years'],
    queryFn: getLockedRecommendationYears,
    staleTime: 60_000,
  });
}

export function useLockRecommendationYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (year: number) => lockRecommendationYear(year),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'recommendation-locked-years'],
      });
      showToast('Recommendations locked', 'success');
    },
    onError: (err: Error) => showToast(err.message || 'Lock failed', 'error'),
  });
}

export function useUnlockRecommendationYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (year: number) => unlockRecommendationYear(year),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'recommendation-locked-years'],
      });
      showToast('Recommendations unlocked', 'success');
    },
    onError: (err: Error) => showToast(err.message || 'Unlock failed', 'error'),
  });
}

// ── Admin: Telegram Configuration ──

export function useTelegramStatus() {
  return useQuery({
    queryKey: ['admin', 'telegram', 'status'],
    queryFn: getTelegramStatus,
    staleTime: 60_000,
  });
}

export function useTelegramRecsStatus() {
  return useQuery({
    queryKey: ['admin', 'telegram', 'recs-status'],
    queryFn: getTelegramRecsStatus,
    staleTime: 60_000,
  });
}

export function useSendTelegramTest() {
  return useMutation({
    mutationFn: () => sendTelegramTest(),
    onSuccess: () => showToast('Test message sent', 'success'),
    onError: (err: Error) => showToast(err.message || 'Test failed', 'error'),
  });
}

export function useToggleTelegramRecs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => toggleTelegramRecs(enabled),
    onSuccess: (_data, enabled) => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'telegram', 'recs-status'],
      });
      showToast(
        enabled
          ? 'Recommendation notifications enabled'
          : 'Recommendation notifications disabled',
        'success'
      );
    },
    onError: (err: Error) => showToast(err.message || 'Toggle failed', 'error'),
  });
}

export function useDisconnectTelegram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectTelegram(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'telegram'] });
      showToast('Telegram disconnected', 'success');
    },
    onError: (err: Error) =>
      showToast(err.message || 'Disconnect failed', 'error'),
  });
}

// ── Admin: Aggregate Lists ──

export function useAggregateYears() {
  return useQuery({
    queryKey: ['admin', 'aggregate-years'],
    queryFn: getAggregateYears,
    staleTime: 60_000,
  });
}

export function useAggregateStatus(year: number) {
  return useQuery({
    queryKey: ['admin', 'aggregate-status', year],
    queryFn: () => getAggregateStatus(year),
    staleTime: 60_000,
  });
}

export function useAggregateStats(year: number) {
  return useQuery({
    queryKey: ['admin', 'aggregate-stats', year],
    queryFn: () => getAggregateStats(year),
    staleTime: 60_000,
  });
}

export function useConfirmAggregateReveal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (year: number) => confirmAggregateReveal(year),
    onSuccess: (_data, year) => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'aggregate-status', year],
      });
      showToast('Reveal confirmed', 'success');
    },
    onError: (err: Error) =>
      showToast(err.message || 'Confirm failed', 'error'),
  });
}

export function useRevokeAggregateConfirmation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (year: number) => revokeAggregateConfirmation(year),
    onSuccess: (_data, year) => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'aggregate-status', year],
      });
      showToast('Confirmation revoked', 'success');
    },
    onError: (err: Error) => showToast(err.message || 'Revoke failed', 'error'),
  });
}

export function useRecomputeAggregate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (year: number) => recomputeAggregate(year),
    onSuccess: (_data, year) => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'aggregate-stats', year],
      });
      queryClient.invalidateQueries({
        queryKey: ['admin', 'aggregate-status', year],
      });
      showToast('Aggregate recomputed', 'success');
    },
    onError: (err: Error) =>
      showToast(err.message || 'Recompute failed', 'error'),
  });
}

export function useLockAggregateYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (year: number) => lockAggregateYear(year),
    onSuccess: (_data, year) => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'aggregate-status', year],
      });
      showToast('Year locked', 'success');
    },
    onError: (err: Error) => showToast(err.message || 'Lock failed', 'error'),
  });
}

export function useUnlockAggregateYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (year: number) => unlockAggregateYear(year),
    onSuccess: (_data, year) => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'aggregate-status', year],
      });
      showToast('Year unlocked', 'success');
    },
    onError: (err: Error) => showToast(err.message || 'Unlock failed', 'error'),
  });
}

// ── Admin: Re-identify Album ──

export function useReidentifySearch() {
  return useMutation({
    mutationFn: ({
      artist,
      album,
      currentAlbumId,
    }: {
      artist: string;
      album: string;
      currentAlbumId: string;
    }) => reidentifySearch(artist, album, currentAlbumId),
    onError: (err: Error) => showToast(err.message || 'Search failed', 'error'),
  });
}

export function useApplyReidentification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      currentAlbumId,
      newAlbumId,
      artist,
      album,
    }: {
      currentAlbumId: string;
      newAlbumId: string;
      artist: string;
      album: string;
    }) => applyReidentification(currentAlbumId, newAlbumId, artist, album),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      showToast('Album re-identified', 'success');
    },
    onError: (err: Error) =>
      showToast(err.message || 'Re-identification failed', 'error'),
  });
}
