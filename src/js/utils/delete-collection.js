/**
 * Shared collection (list group) deletion flow for the desktop and mobile menus.
 *
 * The caller passes the locally-known `listCount` for the collection, so when we
 * already know it is non-empty we prompt for confirmation and delete with
 * `force=true` directly — never firing a plain delete request we expect the
 * server to reject with a 409. If our local count is stale (e.g. another device
 * moved a list in), the 409 the server returns is still handled as a fallback.
 *
 * @param {Object} params
 * @param {string} params.id - Collection (group) external id
 * @param {string} params.name - Collection name (for messages)
 * @param {number} params.listCount - Locally-known number of lists in the collection
 * @param {Function} params.apiCall - Authenticated API helper
 * @param {Function} params.showConfirmation - Confirmation modal
 * @param {Function} params.showToast - Toast notification
 * @param {Function} [params.refresh] - Refresh sidebar/lists after deletion
 * @param {Object} [params.logger] - Logger (defaults to console)
 * @returns {Promise<boolean>} Whether the collection was deleted
 */
export async function deleteCollection({
  id,
  name,
  listCount = 0,
  apiCall,
  showConfirmation,
  showToast,
  refresh = async () => {},
  logger = console,
}) {
  const confirmAndForceDelete = async (count) => {
    const listWord = count === 1 ? 'list' : 'lists';
    const confirmed = await showConfirmation(
      'Delete Collection',
      `The collection "${name}" contains ${count} ${listWord}.`,
      `Deleting this collection will move the ${listWord} to "Uncategorized". This action cannot be undone.`,
      'Delete Collection',
      null,
      {
        checkboxLabel: `I understand that ${count} ${listWord} will be moved to "Uncategorized"`,
      }
    );
    if (!confirmed) return false;
    await apiCall(`/api/groups/${encodeURIComponent(id)}?force=true`, {
      method: 'DELETE',
    });
    return true;
  };

  try {
    let deleted;
    if (listCount > 0) {
      // Known to be non-empty: confirm first, then force-delete. No doomed probe.
      deleted = await confirmAndForceDelete(listCount);
    } else {
      // Believed empty: delete directly. If the local count was stale and the
      // server reports lists (409), fall back to confirm + force-delete.
      try {
        await apiCall(`/api/groups/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        deleted = true;
      } catch (error) {
        if (error.requiresConfirmation && error.listCount > 0) {
          deleted = await confirmAndForceDelete(error.listCount);
        } else {
          throw error;
        }
      }
    }

    if (deleted) {
      showToast(`Collection "${name}" deleted`);
      await refresh();
    }
    return deleted;
  } catch (error) {
    logger.error('Error deleting collection:', error);
    showToast(error.message || 'Failed to delete collection', 'error');
    return false;
  }
}
