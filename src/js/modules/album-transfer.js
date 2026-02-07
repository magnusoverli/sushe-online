/**
 * Album Transfer Module
 *
 * Shared logic for moving and copying albums between lists.
 * Eliminates duplication between context-menus.js and mobile-ui.js.
 *
 * @module album-transfer
 */

/**
 * Check if an album already exists in a list (case-insensitive by artist::album key)
 * @param {Object} album - Album to check
 * @param {Array} list - List to check against
 * @returns {boolean} True if album exists in list
 */
function isAlbumInList(album, list) {
  const key = `${album.artist}::${album.album}`.toLowerCase();
  return list.some(
    (item) => `${item.artist}::${item.album}`.toLowerCase() === key
  );
}

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
 * @param {Function} deps.selectList - Select/refresh a list in the UI
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
    selectList,
    showToast,
    apiCall,
    findAlbumByIdentity,
  } = deps;

  const { index, albumId, targetListId, mode } = options;

  const currentListId = getCurrentList();
  const lists = getLists();

  if (
    !currentListId ||
    !lists[currentListId] ||
    !targetListId ||
    !lists[targetListId]
  ) {
    throw new Error('Invalid source or target list');
  }

  const sourceAlbums = getListData(currentListId);
  if (!sourceAlbums) throw new Error('Source list data not loaded');

  let album = sourceAlbums[index];
  let indexToTransfer = index;

  // Verify the album at the given index matches the expected identity
  if (album && albumId) {
    const expectedId =
      `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
    if (expectedId !== albumId) {
      const result = findAlbumByIdentity(albumId);
      if (result) {
        album = result.album;
        indexToTransfer = result.index;
      } else {
        throw new Error('Album not found');
      }
    }
  } else if (!album) {
    throw new Error('Album not found');
  }

  const albumToTransfer = { ...album };

  // Get target list name for user-facing messages
  const targetListMeta = getListMetadata(targetListId);
  const targetListName = targetListMeta?.name || 'Unknown';

  // Check for duplicate in target list
  const targetAlbums = getListData(targetListId);
  if (isAlbumInList(albumToTransfer, targetAlbums || [])) {
    showToast(
      `"${albumToTransfer.album}" already exists in "${targetListName}"`,
      'error'
    );
    return;
  }

  // For move: remove from source list
  if (mode === 'move') {
    sourceAlbums.splice(indexToTransfer, 1);
  }

  // Add to target list
  let targetData = targetAlbums;
  if (!targetData) {
    targetData = await apiCall(
      `/api/lists/${encodeURIComponent(targetListId)}`
    );
    if (setListData) {
      setListData(targetListId, targetData);
    }
  }
  targetData.push(albumToTransfer);

  // Save the affected lists
  try {
    if (mode === 'move') {
      await Promise.all([
        saveList(currentListId, sourceAlbums),
        saveList(targetListId, targetData),
      ]);
    } else {
      // Copy: only save the target list
      await saveList(targetListId, targetData);
    }

    selectList(currentListId);

    const actionVerb = mode === 'move' ? 'Moved' : 'Copied';
    showToast(`${actionVerb} "${album.album}" to "${targetListName}"`);
  } catch (error) {
    console.error(`Error saving lists after ${mode}:`, error);

    // Rollback
    if (mode === 'move') {
      sourceAlbums.splice(indexToTransfer, 0, albumToTransfer);
    }
    targetData.pop();

    throw error;
  }
}
