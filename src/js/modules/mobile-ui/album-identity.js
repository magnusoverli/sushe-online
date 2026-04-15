export function buildAlbumIdentity(album) {
  return `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
}

export function createAlbumIdentityFinder(deps = {}) {
  const { getCurrentList = () => '', getListData = () => null } = deps;

  return function findAlbumByIdentity(albumId) {
    const currentList = getCurrentList();
    const albums = getListData(currentList);
    if (!currentList || !albums) return null;

    for (let i = 0; i < albums.length; i++) {
      const album = albums[i];
      const currentId = buildAlbumIdentity(album);
      if (currentId === albumId) {
        return { album, index: i };
      }
    }

    return null;
  };
}
