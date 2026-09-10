/**
 * Album Transfer Module
 *
 * Shared logic for moving and copying albums between lists.
 * Provides transferAlbumToList (core) and createTransferHelpers (convenience
 * factory that returns moveAlbumToList, copyAlbumToList, showMoveConfirmation,
 * and showCopyConfirmation).
 *
 * Used by context-menus.js and mobile-ui.js.
 *
 * @module album-transfer
 */

import { isAlbumInList } from '../utils/album-list-utils.js';
import { getListRevision } from './list-revisions.js';

/**
 * Transfer (move or copy) an album from the current list to a target list.
 *
 * @param {Object} deps - Injected dependencies
 * @param {Function} deps.getCurrentList - Get current list ID
 * @param {Function} deps.getLists - Get all lists metadata map
 * @param {Function} deps.getListData - Get album array for a list
 * @param {Function} deps.setListData - Set list data in cache (optional, used by mobile)
 * @param {Function} deps.getListMetadata - Get metadata for a list
 * @param {Function} deps.saveList - Save list to server
 * @param {Function} deps.displayAlbums - Render current list data
 * @param {Function} deps.showToast - Show toast notification
 * @param {Function} deps.apiCall - Make API call
 * @param {Function} deps.findAlbumByIdentity - Find album by identity string
 * @param {Object} options - Transfer options
 * @param {number} options.index - Album index in the source list
 * @param {string} options.albumId - Album identity string (artist::album::release_date)
 * @param {string} options.targetListId - Target list ID
 * @param {string} options.mode - Transfer mode: 'move' or 'copy'
 */
export async function transferAlbumToList(deps, options) {
  const {
    getCurrentList,
    getLists,
    getListData,
    setListData,
    getListMetadata,
    saveList,
    displayAlbums,
    showToast,
    apiCall,
    findAlbumByIdentity,
  } = deps;

  const { index, albumId, targetListId, mode } = options;

  const currentListId = getCurrentList();
  const sourceRevision = getListRevision(currentListId);
  const lists = getLists();

  if (
    !currentListId ||
    !lists[currentListId] ||
    !targetListId ||
    !lists[targetListId]
  ) {
    throw new Error('Invalid source or target list');
  }
  if (currentListId === targetListId)
    throw new Error('Choose a different destination list');

  const sourceAlbums = getListData(currentListId);
  if (!sourceAlbums) throw new Error('Source list data not loaded');

  let album = sourceAlbums[index];

  // Verify the album at the given index matches the expected identity
  if (album && albumId) {
    const expectedId =
      `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
    if (expectedId !== albumId) {
      const result = findAlbumByIdentity(albumId);
      if (result) {
        album = result.album;
      } else {
        throw new Error('Album not found');
      }
    }
  } else if (!album) {
    throw new Error('Album not found');
  }

  const albumToTransfer = { ...album };
  delete albumToTransfer._id;
  delete albumToTransfer.list_id;
  delete albumToTransfer.listId;

  // Get target list name for user-facing messages
  const targetListMeta = getListMetadata(targetListId);
  const targetListName = targetListMeta?.name || 'Unknown';

  // Check for duplicate in target list
  let targetAlbums = getListData(targetListId);
  if (!targetAlbums) {
    targetAlbums = await apiCall(
      `/api/lists/${encodeURIComponent(targetListId)}`
    );
    if (!Array.isArray(targetAlbums))
      throw new Error('Unable to load destination list');
    if (setListData) setListData(targetListId, targetAlbums);
  }
  const indexToTransfer = sourceAlbums.indexOf(album);
  if (indexToTransfer === -1)
    throw new Error('Source album changed while loading the destination');
  if (isAlbumInList(albumToTransfer, targetAlbums || [])) {
    showToast(
      `"${albumToTransfer.album}" already exists in "${targetListName}"`,
      'error'
    );
    return;
  }

  // Add to target list
  const targetData = targetAlbums;
  targetData.push(albumToTransfer);

  // Keep the source intact until the destination write is acknowledged.
  try {
    const outcome = await saveList(targetListId, targetData);
    if (outcome?.duplicates?.length)
      throw new Error('Destination reported duplicates; the source was kept.');
  } catch (error) {
    console.error(`Error saving lists after ${mode}:`, error);

    // Undo the optimistic insertion, not an unrelated item appended meanwhile.
    const pushedIndex = targetData.indexOf(albumToTransfer);
    if (pushedIndex !== -1) {
      targetData.splice(pushedIndex, 1);
    }

    throw error;
  }

  if (mode === 'move') {
    // Other saves must not observe a local removal until the destination is
    // durable. Re-read the source because realtime may have replaced its array.
    const latestSource = getListData(currentListId) || sourceAlbums;
    const sourceIndex = latestSource.findIndex(
      (candidate) =>
        candidate === album ||
        (album._id && candidate._id === album._id) ||
        (album.album_id && candidate.album_id === album.album_id)
    );
    if (sourceIndex < 0)
      throw new Error(
        'Album copied, but the source changed. Review both lists.'
      );
    const [removedAlbum] = latestSource.splice(sourceIndex, 1);
    try {
      await saveList(currentListId, latestSource, undefined, {
        expectedRevision: sourceRevision,
      });
    } catch (error) {
      console.error(`Error saving lists after ${mode}:`, error);

      // The target save already persisted, so keep the local source in sync
      // with the server: the album exists in both lists until removed again.
      latestSource.splice(sourceIndex, 0, removedAlbum);

      throw error;
    }
  }

  if (mode === 'move' && getCurrentList() === currentListId) {
    displayAlbums(getListData(currentListId) || sourceAlbums);
  } else if (getCurrentList() === targetListId) {
    displayAlbums(getListData(targetListId) || targetData);
  }

  const actionVerb = mode === 'move' ? 'Moved' : 'Copied';
  showToast(`${actionVerb} "${album.album}" to "${targetListName}"`);
}

/**
 * Create convenience helpers for album transfer with confirmation dialogs.
 * Returns moveAlbumToList, copyAlbumToList, showMoveConfirmation, showCopyConfirmation.
 *
 * @param {Object} transferDeps - Dependencies for transferAlbumToList
 * @param {Object} uiDeps - Additional UI dependencies
 * @param {Function} uiDeps.showConfirmation - Show confirmation dialog
 * @param {Function} uiDeps.showToast - Show toast notification
 * @param {Function} uiDeps.findAlbumByIdentity - Find album by identity string
 * @param {Function} uiDeps.getCurrentList - Get current list ID
 * @param {Function} uiDeps.getListMetadata - Get metadata for a list
 * @returns {Object} { moveAlbumToList, copyAlbumToList, showMoveConfirmation, showCopyConfirmation }
 */
export function createTransferHelpers(transferDeps, uiDeps) {
  const {
    showConfirmation,
    showToast,
    findAlbumByIdentity,
    getCurrentList,
    getListMetadata,
  } = uiDeps;

  async function moveAlbumToList(index, albumId, targetListId) {
    return transferAlbumToList(transferDeps, {
      index,
      albumId,
      targetListId,
      mode: 'move',
    });
  }

  async function copyAlbumToList(index, albumId, targetListId) {
    return transferAlbumToList(transferDeps, {
      index,
      albumId,
      targetListId,
      mode: 'copy',
    });
  }

  /**
   * Show confirmation modal for moving album to another list
   * @param {string} albumId - Album identity string
   * @param {string} targetListId - Target list ID
   */
  function showMoveConfirmation(albumId, targetListId) {
    if (!albumId || !targetListId) {
      console.error('Invalid albumId or targetListId');
      return;
    }

    const result = findAlbumByIdentity(albumId);
    if (!result) {
      showToast('Album not found - it may have been moved or removed', 'error');
      return;
    }

    const { album, index } = result;
    const currentListId = getCurrentList();

    const currentListMeta = getListMetadata(currentListId);
    const targetListMeta = getListMetadata(targetListId);
    const currentListName = currentListMeta?.name || 'Unknown';
    const targetListName = targetListMeta?.name || 'Unknown';

    showConfirmation(
      'Move Album',
      `Move "${album.album}" by ${album.artist} to "${targetListName}"?`,
      `This will remove the album from "${currentListName}" and add it to "${targetListName}".`,
      'Move',
      async () => {
        try {
          await moveAlbumToList(index, albumId, targetListId);
        } catch (error) {
          console.error('Error moving album:', error);
          showToast('Error moving album', 'error');
        }
      }
    );
  }

  /**
   * Show confirmation modal for copying album to another list
   * @param {string} albumId - Album identity string
   * @param {string} targetListId - Target list ID
   */
  function showCopyConfirmation(albumId, targetListId) {
    if (!albumId || !targetListId) {
      console.error('Invalid albumId or targetListId');
      return;
    }

    const result = findAlbumByIdentity(albumId);
    if (!result) {
      showToast('Album not found - it may have been moved or removed', 'error');
      return;
    }

    const { album, index } = result;
    const currentListId = getCurrentList();

    const currentListMeta = getListMetadata(currentListId);
    const targetListMeta = getListMetadata(targetListId);
    const currentListName = currentListMeta?.name || 'Unknown';
    const targetListName = targetListMeta?.name || 'Unknown';

    showConfirmation(
      'Copy Album',
      `Copy "${album.album}" by ${album.artist} to "${targetListName}"?`,
      `This will add the album to "${targetListName}" while keeping it in "${currentListName}".`,
      'Copy',
      async () => {
        try {
          await copyAlbumToList(index, albumId, targetListId);
        } catch (error) {
          console.error('Error copying album:', error);
          showToast('Error copying album', 'error');
        }
      }
    );
  }

  return {
    moveAlbumToList,
    copyAlbumToList,
    showMoveConfirmation,
    showCopyConfirmation,
  };
}
