export function fetchCoreList(apiCall, listId) {
  return apiCall(`/api/lists/${encodeURIComponent(listId)}?profile=core`)
    .then((items) => ({ items, profile: 'core' }))
    .catch(() =>
      apiCall(`/api/lists/${encodeURIComponent(listId)}`).then((items) => ({
        items,
        profile: 'full',
      }))
    );
}

export async function loadListStartupData({
  apiCall,
  candidateTargetId,
  logger,
}) {
  try {
    const query = candidateTargetId
      ? `?selectedListId=${encodeURIComponent(candidateTargetId)}`
      : '';
    const bootstrap = await apiCall(`/api/app-bootstrap${query}`);
    const candidateDataPromise =
      bootstrap.selectedListId && bootstrap.selectedListItems
        ? Promise.resolve({
            items: bootstrap.selectedListItems,
            profile: bootstrap.selectedListProfile || 'core',
          })
        : null;

    return {
      candidateDataPromise,
      fetchedLists: bootstrap.lists || {},
      fetchedGroups: bootstrap.groups || [],
      recommendationYears: bootstrap.recommendationYears || [],
    };
  } catch (error) {
    logger.warn('App bootstrap failed, falling back to legacy load:', error);
    const candidateDataPromise = candidateTargetId
      ? fetchCoreList(apiCall, candidateTargetId).catch(() => null)
      : null;
    const [fetchedLists, fetchedGroups, recYearsData] = await Promise.all([
      apiCall('/api/lists'),
      apiCall('/api/groups'),
      apiCall('/api/recommendations/years').catch(() => ({ years: [] })),
    ]);

    return {
      candidateDataPromise,
      fetchedLists,
      fetchedGroups,
      recommendationYears: recYearsData.years || [],
    };
  }
}

export function buildListMetadataEntries(fetchedLists) {
  const newLists = {};
  Object.keys(fetchedLists).forEach((listId) => {
    const meta = fetchedLists[listId];
    newLists[listId] = {
      _id: listId,
      name: meta.name || 'Unknown',
      year: meta.year || null,
      isMain: meta.isMain || false,
      count: meta.count || 0,
      groupId: meta.groupId || null,
      sortOrder: meta.sortOrder || 0,
      _data: null,
      updatedAt: meta.updatedAt || null,
      createdAt: meta.createdAt || null,
    };
  });
  return newLists;
}

export function resolveLastSelectedList({
  localLastListId,
  serverLastListId,
  lists,
}) {
  const hasList = (listId) =>
    Object.prototype.hasOwnProperty.call(lists, listId);

  if (localLastListId && hasList(localLastListId)) return localLastListId;
  if (serverLastListId && hasList(serverLastListId)) return serverLastListId;
  return null;
}
