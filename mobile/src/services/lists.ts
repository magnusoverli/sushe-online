/**
 * Lists Service - API calls for list operations.
 */

import { api } from './api-client';
import type { Album, ListMetadata } from '@/lib/types';

/**
 * Get all lists metadata (without album data).
 */
export async function getLists(): Promise<Record<string, ListMetadata>> {
  return api.get<Record<string, ListMetadata>>('/api/lists');
}

/**
 * Get all lists with full album data.
 */
export async function getListsFull(): Promise<Record<string, Album[]>> {
  return api.get<Record<string, Album[]>>('/api/lists?full=true');
}

/**
 * Get a single list with its albums.
 */
export async function getList(listId: string): Promise<Album[]> {
  return api.get<Album[]>(`/api/lists/${listId}`);
}

export interface CreateListRequest {
  name: string;
  groupId?: string;
  year?: number;
  data?: Album[];
}

export interface CreateListResponse {
  success: boolean;
  _id: string;
  name: string;
  year: number | null;
  groupId: string | null;
  count: number;
}

/**
 * Create a new list.
 */
export async function createList(
  data: CreateListRequest
): Promise<CreateListResponse> {
  return api.post<CreateListResponse>('/api/lists', data);
}

/**
 * Update list metadata (rename, change year, move group).
 */
export async function updateList(
  listId: string,
  data: { name?: string; year?: number; groupId?: string }
): Promise<{ success: boolean }> {
  return api.patch<{ success: boolean }>(`/api/lists/${listId}`, data);
}

/**
 * Delete a list.
 */
export async function deleteList(
  listId: string
): Promise<{ success: boolean }> {
  return api.delete<{ success: boolean }>(`/api/lists/${listId}`);
}

/**
 * Reorder items within a list.
 */
export async function reorderList(
  listId: string,
  order: string[]
): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>(`/api/lists/${listId}/reorder`, {
    order,
  });
}

/**
 * Incremental update: add/remove/update items.
 */
export async function updateListItems(
  listId: string,
  changes: {
    added?: Partial<Album>[];
    removed?: string[];
    updated?: { album_id: string; position: number }[];
  }
): Promise<{
  success: boolean;
  changes: number;
  addedItems: { album_id: string; _id: string }[];
  duplicates: { album_id: string; artist: string; album: string }[];
}> {
  return api.patch(`/api/lists/${listId}/items`, changes);
}

/**
 * Full replacement of list items (PUT).
 */
export async function replaceListItems(
  listId: string,
  data: Album[]
): Promise<{ success: boolean; count: number }> {
  return api.put<{ success: boolean; count: number }>(`/api/lists/${listId}`, {
    data,
  });
}

/**
 * Toggle main list status.
 */
export async function setMainList(
  listId: string,
  isMain: boolean
): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>(`/api/lists/${listId}/main`, {
    isMain,
  });
}

/**
 * Move a list to a different group/year.
 */
export async function moveList(
  listId: string,
  data: { groupId?: string; year?: number }
): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>(`/api/lists/${listId}/move`, data);
}
