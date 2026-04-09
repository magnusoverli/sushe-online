/**
 * List reorder persistence flow.
 *
 * Persists drag/drop ordering with stable item identity fallback.
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
      const order = list.map((album) => {
        const id = album.album_id || album.albumId;
        if (id) return id;
        if (album._id) return { _id: album._id };
        return null;
      });

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
