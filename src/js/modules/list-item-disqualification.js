export function canManageListItemDisqualification(
  listMeta,
  currentUser = {},
  isYearLocked = () => false
) {
  if (!listMeta) return false;
  if (
    listMeta.isAggregate === true ||
    listMeta.aggregate === true ||
    listMeta.readOnly === true ||
    listMeta.readonly === true ||
    listMeta.isReadOnly === true ||
    listMeta.canEdit === false ||
    listMeta.isOwner === false
  ) {
    return false;
  }

  const listYear = listMeta.year ?? listMeta.groupYear ?? listMeta.group_year;
  const isMain = listMeta.isMain === true || listMeta.is_main === true;
  if (isMain && isYearLocked(listYear)) return false;

  const ownerId =
    listMeta.ownerId ||
    listMeta.owner_id ||
    listMeta.userId ||
    listMeta.user_id;
  return !ownerId || ownerId === currentUser?._id;
}

export async function updateListItemDisqualification(
  {
    apiCall,
    getListData,
    setListData,
    displayAlbums,
    showDisqualificationReasonModal,
    showToast,
    refreshLockedYearStatus = () => {},
  },
  { listId, album }
) {
  if (!listId || !album?._id) {
    showToast('Cannot update ranking eligibility', 'error');
    return false;
  }

  const disqualified = !album.is_disqualified;
  let reason = null;
  if (disqualified) {
    const result = await showDisqualificationReasonModal(album);
    if (result.cancelled) return false;
    reason = result.reason;
  }

  try {
    const response = await apiCall(
      `/api/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(album._id)}/disqualification`,
      {
        method: 'PATCH',
        body: JSON.stringify({ disqualified, reason }),
      }
    );
    const albums = getListData(listId) || [];
    const itemIndex = albums.findIndex((item) => item._id === album._id);
    if (itemIndex < 0) {
      throw new Error('List item is no longer available');
    }

    const nextAlbums = [...albums];
    nextAlbums[itemIndex] = {
      ...nextAlbums[itemIndex],
      is_disqualified: response.is_disqualified,
      disqualification_reason: response.disqualification_reason ?? null,
    };
    setListData(listId, nextAlbums);
    displayAlbums(nextAlbums);
    showToast(
      response.is_disqualified
        ? 'Album disqualified from ranking'
        : 'Album restored to ranking eligibility',
      'success'
    );
    return true;
  } catch (error) {
    if (error?.code === 'YEAR_LOCKED') {
      showToast(
        error.error || error.message || `Year ${error.year} is locked.`,
        'info'
      );
      await refreshLockedYearStatus();
      return false;
    }
    console.error('Error updating ranking eligibility:', error);
    showToast('Error updating ranking eligibility', 'error');
    return false;
  }
}
