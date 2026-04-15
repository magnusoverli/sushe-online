/**
 * List reorder persistence flow.
 *
 * Persists drag/drop ordering using canonical album identity.
 */

export function createListReorder(deps = {}) {
  const apiCall = deps.apiCall;
  const logger = deps.logger || console;

  async function saveReorder(listName, list) {
    if (!list || !Array.isArray(list)) {
      logger.error('List data not found:', listName);
      return;
    }

    try {
      const order = list.map(
        (album) => album.album_id || album.albumId || null
      );

      await apiCall(`/api/lists/${encodeURIComponent(listName)}/reorder`, {
        method: 'POST',
        body: JSON.stringify({ order }),
      });

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
