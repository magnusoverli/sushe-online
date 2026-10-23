/**
 * List reorder persistence flow.
 *
 * Persists drag/drop ordering using canonical album identity.
 */

import {
  getLastSavedSnapshots as defaultGetLastSavedSnapshots,
  saveSnapshotToStorage as defaultSaveSnapshotToStorage,
} from './app-state.js';

export function createListReorder(deps = {}) {
  const apiCall = deps.apiCall;
  const logger = deps.logger || console;
  const getLastSavedSnapshots =
    deps.getLastSavedSnapshots || defaultGetLastSavedSnapshots;
  const saveSnapshotToStorage =
    deps.saveSnapshotToStorage || defaultSaveSnapshotToStorage;

  async function saveReorder(listName, list) {
    if (!list || !Array.isArray(list)) {
      logger.error('List data not found:', listName);
      return;
    }

    try {
      const order = list.map((album) => album.album_id || null);

      await apiCall(`/api/lists/${encodeURIComponent(listName)}/reorder`, {
        method: 'POST',
        body: JSON.stringify({ order }),
      });
      const previous = getLastSavedSnapshots().get(listName);
      const snapshot = [...order];
      if (previous?.records)
        Object.defineProperty(snapshot, 'records', { value: previous.records });
      getLastSavedSnapshots().set(listName, snapshot);
      saveSnapshotToStorage(listName, snapshot);

      logger.log('List reordered successfully:', listName);
    } catch (error) {
      logger.error('Error reordering list:', error);
      throw error;
    }
  }

  return {
    saveReorder,
  };
}
