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
  updateEmail,
  updateUsername,
  changePassword,
  requestAdmin,
  makeAdmin,
  revokeAdmin,
  deleteUser,
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
