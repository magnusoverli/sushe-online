/**
 * List import flow extracted from app list operations.
 */
export function createListImporter(deps = {}) {
  const {
    apiCall,
    showToast,
    getLists,
    getCurrentListId,
    win = typeof window !== 'undefined' ? window : null,
    logger = console,
  } = deps;

  function sanitizeImportedAlbums(albums) {
    return albums.map((album) => {
      const cleaned = { ...album };
      delete cleaned.points;
      delete cleaned.rank;
      delete cleaned._id;
      return cleaned;
    });
  }

  function extractImportMetadata(metadata = null) {
    let year;
    let groupId = null;

    if (!metadata) {
      return { year, groupId };
    }

    if (metadata.year !== null && metadata.year !== undefined) {
      year = metadata.year;
    }

    if (metadata.group_id) {
      groupId = metadata.group_id;
    }

    return { year, groupId };
  }

  function buildAlbumToListItemMap(savedList) {
    const map = new Map();
    for (const item of savedList) {
      if (item.album_id && item._id) {
        map.set(item.album_id, item._id);
      }
    }
    return map;
  }

  async function importTrackPicksAndSummaries(albums, albumToListItemMap) {
    let trackPicksImported = 0;
    let summariesImported = 0;

    for (const album of albums) {
      const albumId = album.album_id;
      if (!albumId) continue;

      const listItemId = albumToListItemMap.get(albumId);
      if (listItemId && (album.primary_track || album.secondary_track)) {
        try {
          if (album.primary_track) {
            await apiCall(`/api/track-picks/${listItemId}`, {
              method: 'POST',
              body: JSON.stringify({
                trackIdentifier: album.primary_track,
                priority: 1,
              }),
            });
            trackPicksImported++;
          }

          if (album.secondary_track) {
            await apiCall(`/api/track-picks/${listItemId}`, {
              method: 'POST',
              body: JSON.stringify({
                trackIdentifier: album.secondary_track,
                priority: 2,
              }),
            });
            trackPicksImported++;
          }
        } catch (error) {
          logger.warn(
            'Failed to import track picks for list item',
            listItemId,
            error
          );
        }
      }

      if (album.summary || album.summary_source) {
        try {
          await apiCall(`/api/albums/${albumId}/summary`, {
            method: 'PUT',
            body: JSON.stringify({
              summary: album.summary || '',
              summary_source: album.summary_source || '',
            }),
          });
          summariesImported++;
        } catch (error) {
          logger.warn('Failed to import summary for album', albumId, error);
        }
      }
    }

    return { trackPicksImported, summariesImported };
  }

  return async function importList(name, albums, metadata = null) {
    try {
      const { year, groupId } = extractImportMetadata(metadata);
      const cleanedAlbums = sanitizeImportedAlbums(albums);

      const body = { name, data: cleanedAlbums };
      if (year !== undefined) {
        body.year = year;
      }
      if (groupId) {
        body.groupId = groupId;
      }

      const createResult = await apiCall('/api/lists', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const listId = createResult._id;
      const savedList = await apiCall(
        `/api/lists/${encodeURIComponent(listId)}`
      );

      getLists()[listId] = {
        _id: listId,
        name,
        year: year || null,
        isMain: false,
        count: savedList.length,
        groupId,
        sortOrder: 0,
        _data: savedList,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      const albumToListItemMap = buildAlbumToListItemMap(savedList);
      const { trackPicksImported, summariesImported } =
        await importTrackPicksAndSummaries(albums, albumToListItemMap);

      if (listId === getCurrentListId() && win?.refreshMobileBarVisibility) {
        win.refreshMobileBarVisibility();
      }

      if (trackPicksImported > 0 || summariesImported > 0) {
        logger.log(
          `Imported ${trackPicksImported} track picks and ${summariesImported} summaries`
        );
      }

      return listId;
    } catch (error) {
      showToast('Error importing list', 'error');
      throw error;
    }
  };
}
