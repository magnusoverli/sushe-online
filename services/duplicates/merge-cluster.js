/** @param {unknown} value */
function toRowCount(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** @returns {Record<string, number>} */
function emptyDependentRemapStats() {
  return {
    recommendationsUpdated: 0,
    recommendationsConflictsRemoved: 0,
    albumMappingsUpdated: 0,
    albumMappingsConflictsRemoved: 0,
    artistAliasSourcesUpdated: 0,
    userAlbumStatsUpdated: 0,
    distinctPairsRemapped: 0,
    distinctPairsRemoved: 0,
  };
}

/** @param {Record<string, number>} target @param {Record<string, number>} source */
function sumDependentRemapStats(target, source) {
  for (const [key, value] of Object.entries(source))
    target[key] = (target[key] || 0) + toRowCount(value);
}

/** @typedef {{listItemsUpdated: number, albumsDeleted: number, collisionsResolved: number,
 * collisionRowsDeleted: number, taxonomyConflict: boolean, albumTaxonomy: unknown,
 * mappingConflicts: object[], metadataMerged: boolean, mergedFieldNames?: string[],
 * dependentRemaps?: Record<string, number>}} MergeResult */

/** The caller supplies one transaction-bound merge operation. A failed member
 * rejects the whole cluster; the caller commits and invalidates only afterwards.
 * @param {string} canonicalId @param {string[]} retireIds
 * @param {(retireId: string) => Promise<MergeResult>} merge
 */
async function mergeClusterMembers(canonicalId, retireIds, merge) {
  const aggregate = {
    canonicalAlbumId: canonicalId,
    requestedRetireIds: retireIds,
    mergedAlbums: 0,
    missingAlbums: 0,
    listItemsUpdated: 0,
    albumsDeleted: 0,
    metadataMerged: false,
    mergedFieldNames: new Set(),
    taxonomyConflict: false,
    albumTaxonomy: /** @type {unknown} */ (null),
    mappingConflicts: /** @type {object[]} */ ([]),
    collisionsResolved: 0,
    collisionRowsDeleted: 0,
    dependentRemaps: emptyDependentRemapStats(),
    results: /** @type {(MergeResult & {retireAlbumId: string})[]} */ ([]),
  };
  for (const retireId of retireIds) {
    const result = await merge(retireId);
    aggregate.results.push({ retireAlbumId: retireId, ...result });
    aggregate.listItemsUpdated += result.listItemsUpdated;
    aggregate.albumsDeleted += result.albumsDeleted;
    aggregate.collisionsResolved += result.collisionsResolved;
    aggregate.collisionRowsDeleted += result.collisionRowsDeleted;
    aggregate.taxonomyConflict ||= result.taxonomyConflict;
    aggregate.albumTaxonomy = result.albumTaxonomy;
    aggregate.mappingConflicts.push(...result.mappingConflicts);
    sumDependentRemapStats(
      aggregate.dependentRemaps,
      result.dependentRemaps || emptyDependentRemapStats()
    );
    if (result.albumsDeleted > 0) aggregate.mergedAlbums++;
    else aggregate.missingAlbums++;
    aggregate.metadataMerged ||= result.metadataMerged;
    for (const fieldName of result.mergedFieldNames || [])
      aggregate.mergedFieldNames.add(fieldName);
  }
  return {
    ...aggregate,
    mergedFieldNames: [...aggregate.mergedFieldNames].sort(),
  };
}

module.exports = {
  toRowCount,
  emptyDependentRemapStats,
  sumDependentRemapStats,
  mergeClusterMembers,
};
