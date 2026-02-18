/**
 * Groups Service - API calls for collection/group operations.
 */

import { api } from './api-client';
import type { Group } from '@/lib/types';

/**
 * Get all groups for the current user.
 */
export async function getGroups(): Promise<Group[]> {
  return api.get<Group[]>('/api/groups');
}

/**
 * Create a new group/collection.
 */
export async function createGroup(name: string): Promise<Group> {
  return api.post<Group>('/api/groups', { name });
}

/**
 * Rename or reorder a group.
 */
export async function updateGroup(
  groupId: string,
  data: { name?: string; sortOrder?: number }
): Promise<{ success: boolean }> {
  return api.patch<{ success: boolean }>(`/api/groups/${groupId}`, data);
}

/**
 * Delete a group.
 */
export async function deleteGroup(
  groupId: string,
  force = false
): Promise<{ success: boolean; listsUnassigned?: number }> {
  const query = force ? '?force=true' : '';
  return api.delete(`/api/groups/${groupId}${query}`);
}

/**
 * Reorder groups.
 */
export async function reorderGroups(
  order: string[]
): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>('/api/groups/reorder', { order });
}

/**
 * Reorder lists within a group.
 */
export async function reorderListsInGroup(
  groupId: string,
  order: string[]
): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>('/api/lists/reorder', {
    groupId,
    order,
  });
}
