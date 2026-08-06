// services/album-summary-store.js
// Persistence policy for a fetched album summary.

/**
 * Persist the result of a summary fetch.
 *
 * When the fetch produced nothing and the caller asked to keep what is already
 * stored, only the attempt timestamp moves. That is what stops a deliberate
 * single-album regeneration from costing an album the summary it already had
 * when the retry happens to come back empty.
 *
 * The batch path deliberately does not ask for that: there, an empty result is
 * the accurate outcome of a sweep and should be written through.
 *
 * @param {Object} db - Datastore with .raw()
 * @param {string} albumId
 * @param {string|null} summary
 * @param {string|null} source
 * @param {boolean} keepExistingOnEmpty
 */
async function storeSummaryResult(
  db,
  albumId,
  summary,
  source,
  keepExistingOnEmpty
) {
  if (!summary && keepExistingOnEmpty) {
    await db.raw(
      `UPDATE albums SET summary_fetched_at = NOW() WHERE album_id = $1`,
      [albumId]
    );
    return;
  }

  await db.raw(
    `UPDATE albums SET summary = $1, summary_source = $2, summary_fetched_at = NOW() WHERE album_id = $3`,
    [summary, source, albumId]
  );
}

module.exports = { storeSummaryResult };
