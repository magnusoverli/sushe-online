/**
 * Save Optimizer - Diff-based incremental save logic
 *
 * Extracts the diff computation algorithm and debounced save factory
 * from app.js. These are pure logic functions with no DOM dependencies.
 */

import { createListSnapshot } from '../modules/app-state.js';

/**
 * Compute the diff between an old snapshot (array of album IDs) and new album data.
 * Used for incremental saves - only sending changes instead of full list.
 *
 * Returns null if:
 *  - No previous snapshot exists
 *  - Too many changes (falls back to full save)
 *
 * @param {Array<string>} oldSnapshot - Previous album_id array
 * @param {Array<Object>} newData - New album array with album_id or albumId fields
 * @returns {Object|null} Diff object { added, removed, updated, totalChanges }, or null
 */
export function computeListDiff(oldSnapshot, newData) {
  if (!oldSnapshot || oldSnapshot.length === 0) {
    // No previous snapshot - can't compute diff
    return null;
  }

  const newSnapshot = createListSnapshot(newData);
  const oldSet = new Set(oldSnapshot);
  const newSet = new Set(newSnapshot);

  // Find removed albums (in old but not in new)
  const removed = oldSnapshot.filter((id) => !newSet.has(id));

  // Find added albums (in new but not in old)
  const added = newData.filter((album) => {
    const id = album.album_id || album.albumId;
    return id && !oldSet.has(id);
  });

  // Find position changes for existing albums
  const updated = [];
  newData.forEach((album, newIndex) => {
    const id = album.album_id || album.albumId;
    if (id && oldSet.has(id)) {
      const oldIndex = oldSnapshot.indexOf(id);
      if (oldIndex !== newIndex) {
        updated.push({
          album_id: id,
          position: newIndex + 1,
        });
      }
    }
  });

  // Calculate total changes
  const totalChanges = removed.length + added.length + updated.length;

  // If too many changes, fall back to full save
  // Threshold: more than 50% of list changed or more than 20 individual changes
  const threshold = Math.max(20, Math.floor(oldSnapshot.length * 0.5));
  if (totalChanges > threshold) {
    return null;
  }

  // Prepare added items with position
  const addedWithPosition = added.map((album) => {
    const newIndex = newData.findIndex(
      (a) => (a.album_id || a.albumId) === (album.album_id || album.albumId)
    );
    return {
      ...album,
      position: newIndex + 1,
    };
  });

  return {
    added: addedWithPosition,
    removed,
    updated,
    totalChanges,
  };
}

/**
 * Create a debounced save function that batches rapid changes.
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.saveList - The save function to debounce (listId, data) => Promise
 * @param {Function} deps.showToast - Toast notification function
 * @returns {Function} debouncedSaveList(listId, listData, delay?)
 */
export function createDebouncedSave(deps = {}) {
  const { saveList, showToast } = deps;
  let saveTimeout = null;

  return function debouncedSaveList(listId, listData, delay = 300) {
    clearTimeout(saveTimeout);

    saveTimeout = setTimeout(async () => {
      try {
        await saveList(listId, listData);
      } catch (error) {
        console.error('Error saving list:', error);
        if (showToast) {
          showToast('Error saving list order', 'error');
        }
      }
    }, delay);
  };
}
