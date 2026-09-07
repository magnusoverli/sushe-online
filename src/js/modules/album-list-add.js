import { createKeyedTaskQueue } from '../utils/keyed-task-queue.js';

export function createAlbumListAdder(deps) {
  const {
    getCurrentListId,
    getListData,
    setListData,
    resolveAndDedup,
    isAlbumInList,
    saveList,
    getListSaveState,
    apiCall,
    displayAlbums,
    closeAddAlbumModal,
    showToast,
    fetchAndDisplayPlaycounts,
  } = deps;
  const enqueueAdd = createKeyedTaskQueue();

  async function reconcileListFromServer(listId) {
    const saveState = getListSaveState(listId);
    if (saveState.pending) return;
    const expectedData = getListData(listId);
    const fingerprint = JSON.stringify(expectedData);
    const data = await apiCall(`/api/lists/${encodeURIComponent(listId)}`);
    const currentSaveState = getListSaveState(listId);
    if (
      currentSaveState.pending ||
      currentSaveState.version !== saveState.version ||
      getCurrentListId() !== listId ||
      getListData(listId) !== expectedData ||
      JSON.stringify(getListData(listId)) !== fingerprint
    ) {
      return;
    }
    setListData(listId, data);
    displayAlbums(data);
    fetchAndDisplayPlaycounts(listId).catch(() => {});
  }

  function add(album, { listId, isCurrent, manual = false }) {
    return enqueueAdd(listId, async () => {
      let addedAlbumId = null;
      try {
        if (!isCurrent()) return;
        const data = getListData(listId);
        if (!listId || !data) {
          showToast('No list selected', 'error');
          return;
        }
        const { resolved, cancelled, alreadyInList, usedExisting } =
          await resolveAndDedup(album, data);
        if (cancelled || !isCurrent()) return;

        // Similarity prompts and remote updates may have changed the list.
        const currentData = getListData(listId);
        if (!currentData) return;
        if (alreadyInList || isAlbumInList(resolved, currentData)) {
          closeAddAlbumModal();
          const label = usedExisting ? ' (metadata updated)' : '';
          showToast(
            `"${album.album}" is already in this list${label}`,
            usedExisting ? 'info' : 'error'
          );
          if (usedExisting) reconcileListFromServer(listId).catch(() => {});
          return;
        }

        const updatedData = [...currentData, resolved];
        addedAlbumId = resolved.album_id;
        setListData(listId, updatedData, false);
        displayAlbums(updatedData);
        closeAddAlbumModal();

        await saveList(listId, updatedData);
        const suffix =
          manual && usedExisting ? ' (using existing album)' : ' to the list';
        showToast(`Added "${resolved.album}" by ${resolved.artist}${suffix}`);
        reconcileListFromServer(listId).catch(() => {});
      } catch (_error) {
        // A failed preflight must not remove anything; a failed write owns only
        // its unsaved album, never the last item or a remotely persisted copy.
        if (addedAlbumId) {
          const currentData = getListData(listId);
          if (currentData) {
            const rolledBack = currentData.filter(
              (item) => item.album_id !== addedAlbumId || item._id
            );
            setListData(listId, rolledBack, false);
            if (getCurrentListId() === listId) {
              displayAlbums(rolledBack, { forceFullRebuild: true });
            }
          }
        }
        showToast('Error adding album to list', 'error');
      }
    });
  }

  return { add };
}
