/**
 * Playlist Helpers
 *
 * Shared utilities for playlist track processing across Spotify and Tidal services.
 * Eliminates duplication of track pick resolution and batch processing logic.
 */

/**
 * Resolve primary and secondary track picks from an item.
 * Handles both normalized field names (primaryTrack/secondaryTrack)
 * and legacy field names (primary_track/secondary_track, trackPick/track_pick).
 *
 * @param {Object} item - Album/list item
 * @returns {{ primaryTrack: string|null, secondaryTrack: string|null }}
 */
function resolveTrackPicks(item) {
  const primaryTrack =
    item.primaryTrack ||
    item.primary_track ||
    item.trackPick ||
    item.track_pick ||
    null;
  const secondaryTrack = item.secondaryTrack || item.secondary_track || null;
  return { primaryTrack, secondaryTrack };
}

/**
 * Process track searches in parallel batches, populating a result object.
 *
 * @param {Array<Object>} items - List items with artist, album, track picks
 * @param {Function} findTrackFn - Async function (item, trackIdentifier) => trackId/URI or null.
 *   The caller should bind auth, albumCache, countryCode etc. before passing.
 * @param {Object} result - Mutable result object with processed, successful, failed, tracks, errors
 * @param {number} [batchSize=10] - Number of items to process in parallel
 * @returns {Promise<string[]>} Array of found track IDs/URIs (in order)
 */
async function processTrackBatches(items, findTrackFn, result, batchSize = 10) {
  const trackIdentifiers = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    const batchResults = await Promise.allSettled(
      batch.map(async (item) => {
        result.processed++;

        const { primaryTrack, secondaryTrack } = resolveTrackPicks(item);
        const itemResults = [];

        // Process primary track
        if (primaryTrack && primaryTrack.trim()) {
          try {
            const trackRef = await findTrackFn(item, primaryTrack);
            if (trackRef) {
              itemResults.push({
                success: true,
                item,
                trackRef,
                trackPick: primaryTrack,
                isPrimary: true,
              });
            } else {
              itemResults.push({
                success: false,
                item,
                trackPick: primaryTrack,
                isPrimary: true,
                error: `Track not found: "${item.artist} - ${item.album}" - Primary: ${primaryTrack}`,
              });
            }
          } catch (err) {
            itemResults.push({
              success: false,
              item,
              trackPick: primaryTrack,
              isPrimary: true,
              error: `Error searching for "${item.artist} - ${item.album}" primary: ${err.message}`,
            });
          }
        } else {
          itemResults.push({
            success: false,
            item,
            isPrimary: true,
            error: `Skipped "${item.artist} - ${item.album}": no track selected`,
          });
        }

        // Process secondary track if it exists
        if (secondaryTrack && secondaryTrack.trim()) {
          try {
            const trackRef = await findTrackFn(item, secondaryTrack);
            if (trackRef) {
              itemResults.push({
                success: true,
                item,
                trackRef,
                trackPick: secondaryTrack,
                isPrimary: false,
              });
            } else {
              itemResults.push({
                success: false,
                item,
                trackPick: secondaryTrack,
                isPrimary: false,
                error: `Track not found: "${item.artist} - ${item.album}" - Secondary: ${secondaryTrack}`,
              });
            }
          } catch (err) {
            itemResults.push({
              success: false,
              item,
              trackPick: secondaryTrack,
              isPrimary: false,
              error: `Error searching for "${item.artist} - ${item.album}" secondary: ${err.message}`,
            });
          }
        }

        return itemResults;
      })
    );

    // Process batch results - flatten since each item can have multiple tracks
    for (const promiseResult of batchResults) {
      if (promiseResult.status === 'fulfilled') {
        const trackResults = promiseResult.value;
        for (const trackResult of trackResults) {
          if (trackResult.success) {
            trackIdentifiers.push(trackResult.trackRef);
            result.successful++;
            result.tracks.push({
              artist: trackResult.item.artist,
              album: trackResult.item.album,
              track: trackResult.trackPick,
              isPrimary: trackResult.isPrimary,
              found: true,
            });
          } else {
            result.failed++;
            result.errors.push(trackResult.error);
            if (trackResult.trackPick) {
              result.tracks.push({
                artist: trackResult.item.artist,
                album: trackResult.item.album,
                track: trackResult.trackPick,
                isPrimary: trackResult.isPrimary,
                found: false,
              });
            }
          }
        }
      } else {
        result.failed++;
        result.errors.push(`Unexpected error: ${promiseResult.reason}`);
      }
    }
  }

  return trackIdentifiers;
}

module.exports = { resolveTrackPicks, processTrackBatches };
