/**
 * useLists - TanStack Query hooks for list data.
 */

import { useQuery } from '@tanstack/react-query';
import { getLists, getList, getSetupStatus } from '@/services/lists';
import { getGroups } from '@/services/groups';
import type { ListMetadata, Album, Group, SetupStatus } from '@/lib/types';

/** Fetch all list metadata (lightweight, keyed by list ID). */
export function useListsMetadata() {
  return useQuery<Record<string, ListMetadata>>({
    queryKey: ['lists', 'metadata'],
    queryFn: getLists,
    staleTime: 2 * 60 * 1000,
  });
}

/** Fetch albums for a single list. */
export function useListAlbums(listId: string | null) {
  return useQuery<Album[]>({
    queryKey: ['lists', listId, 'albums'],
    queryFn: () => getList(listId!),
    enabled: !!listId,
    staleTime: 60 * 1000,
  });
}

/** Fetch all groups/collections. */
export function useGroups() {
  return useQuery<Group[]>({
    queryKey: ['groups'],
    queryFn: getGroups,
    staleTime: 5 * 60 * 1000,
  });
}

/** Fetch list setup status (enabled only when list metadata is loaded). */
export function useSetupStatus(enabled: boolean) {
  return useQuery<SetupStatus>({
    queryKey: ['lists', 'setup-status'],
    queryFn: getSetupStatus,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
