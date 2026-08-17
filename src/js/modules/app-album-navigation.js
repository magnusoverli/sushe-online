export function createAppAlbumNavigation(deps = {}) {
  const { getLists, getListData, getCurrentListId, selectList, focusAlbum } =
    deps;

  async function openAlbum(target = {}) {
    const listId = String(target.listId || '').trim();
    const albumId = String(target.albumId || '').trim();
    if (!listId || !albumId) {
      return { handled: false, reason: 'invalid-target' };
    }

    if (!Object.prototype.hasOwnProperty.call(getLists(), listId)) {
      return { handled: false, reason: 'list-not-found' };
    }

    if (getCurrentListId() !== listId) {
      await selectList(listId);
    }
    if (getCurrentListId() !== listId) {
      return { handled: false, reason: 'selection-failed' };
    }

    const albumExists = (getListData(listId) || []).some(
      (album) => (album?.album_id || album?.albumId) === albumId
    );
    if (!albumExists) {
      return { handled: false, reason: 'album-not-found' };
    }

    focusAlbum(listId, albumId);
    return { handled: true, highlighted: true };
  }

  return { openAlbum };
}
