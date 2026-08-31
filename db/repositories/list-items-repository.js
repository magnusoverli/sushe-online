const { ensureDb } = require('../postgres');

/**
 * Raw row shape produced by the `list_items LEFT JOIN albums` query in
 * findWithAlbumData(). Album-side columns are nullable because the join is a
 * LEFT JOIN (and because those columns are nullable in the schema).
 *
 * @typedef {Object} ListItemAlbumRow
 * @property {string} _id
 * @property {string} list_id
 * @property {number} position
 * @property {string|null} comments
 * @property {string|null} comments_2
 * @property {string|null} album_id
 * @property {string|null} primary_track
 * @property {string|null} secondary_track
 * @property {boolean} is_disqualified
 * @property {string|null} disqualification_reason
 * @property {string|null} artist
 * @property {string|null} album
 * @property {string|null} release_date
 * @property {string|null} country
 * @property {string|null} genre_1
 * @property {string|null} genre_2
 * @property {Object[]|null} tracks
 * @property {string|null} cover_image_format
 * @property {string|null} summary
 * @property {string|null} summary_source
 */

/**
 * Camel-cased view of a list item joined with its album, as consumed by
 * services/list-service.js and the playlist builders.
 *
 * @typedef {Object} ListItemAlbumData
 * @property {string} _id
 * @property {string} listId
 * @property {number} position
 * @property {string} artist
 * @property {string} album
 * @property {string} albumId
 * @property {string} releaseDate
 * @property {string} country
 * @property {string} genre1
 * @property {string} genre2
 * @property {string|null} primaryTrack
 * @property {string|null} secondaryTrack
 * @property {boolean} isDisqualified
 * @property {string|null} disqualificationReason
 * @property {string} comments
 * @property {string} comments2
 * @property {Object[]|null} tracks
 * @property {string} coverImageFormat
 * @property {string} summary
 * @property {string} summarySource
 */

/**
 * The two track picks stored on a list item.
 *
 * @typedef {Object} TrackPicks
 * @property {string|null} primary
 * @property {string|null} secondary
 */

/**
 * @param {ListItemAlbumRow} row
 * @returns {ListItemAlbumData}
 */
function mapAlbumDataRow(row) {
  return {
    _id: row._id,
    listId: row.list_id,
    position: row.position,
    artist: row.artist || '',
    album: row.album || '',
    albumId: row.album_id || '',
    releaseDate: row.release_date || '',
    country: row.country || '',
    genre1: row.genre_1 || '',
    genre2: row.genre_2 || '',
    primaryTrack: row.primary_track || null,
    secondaryTrack: row.secondary_track || null,
    isDisqualified: row.is_disqualified === true,
    disqualificationReason: row.disqualification_reason || null,
    comments: row.comments || '',
    comments2: row.comments_2 || '',
    tracks: row.tracks || null,
    coverImageFormat: row.cover_image_format || '',
    summary: row.summary || '',
    summarySource: row.summary_source || '',
  };
}

/**
 * Pure helper: work out the new primary/secondary track picks when
 * `trackIdentifier` is assigned to `targetPriority` on a list item that
 * currently holds `current`.
 *
 * @param {{ primary_track: string|null, secondary_track: string|null }} current
 *   Current picks, straight from the `list_items` row (snake_case columns).
 * @param {string} trackIdentifier
 * @param {number} targetPriority - 1 = primary, anything else = secondary.
 * @returns {TrackPicks}
 */
function calculateUpdatedTrackPicks(current, trackIdentifier, targetPriority) {
  const { primary_track: primaryTrack, secondary_track: secondaryTrack } =
    current;
  let newPrimary = primaryTrack;
  let newSecondary = secondaryTrack;

  if (targetPriority === 1) {
    if (primaryTrack === trackIdentifier) {
      newPrimary = null;
    } else if (secondaryTrack === trackIdentifier) {
      newPrimary = trackIdentifier;
      newSecondary = primaryTrack;
    } else {
      newSecondary = primaryTrack;
      newPrimary = trackIdentifier;
    }
  } else if (secondaryTrack === trackIdentifier) {
    newSecondary = null;
  } else if (primaryTrack === trackIdentifier) {
    newSecondary = trackIdentifier;
    newPrimary = secondaryTrack;
  } else {
    newSecondary = trackIdentifier;
  }

  return { primary: newPrimary, secondary: newSecondary };
}

/** @param {{ db?: * }} [deps] - `db` is validated by ensureDb, which types the result. */
function createListItemsRepository(deps = {}) {
  // ensureDb only guarantees `.raw` is callable; the cast pins the canonical
  // facade shape so `.raw`/`.withTransaction` callbacks are contextually typed.
  const db = /** @type {import('../types').DbFacade} */ (
    ensureDb(deps.db, 'list-items-repository')
  );

  /**
   * @param {string} listId - `lists._id` (TEXT primary key).
   * @returns {Promise<ListItemAlbumData[]>}
   */
  async function findWithAlbumData(listId) {
    const result = await db.raw(
      `SELECT
         li._id,
         li.list_id,
         li.position,
         li.comments,
         li.comments_2,
         li.album_id,
         li.primary_track,
         li.secondary_track,
         li.is_disqualified,
         li.disqualification_reason,
         a.artist,
         a.album,
         a.release_date,
         a.country,
         a.genre_1,
         a.genre_2,
         a.tracks,
         a.cover_image_format,
         a.summary,
         a.summary_source
       FROM list_items li
       LEFT JOIN albums a ON li.album_id = a.album_id
       WHERE li.list_id = $1
       ORDER BY li.position`,
      [listId],
      { name: 'list-items-repo-with-album-data', retryable: true }
    );

    return result.rows.map(mapAlbumDataRow);
  }

  /**
   * @param {string} listItemId - `list_items._id` (TEXT).
   * @returns {Promise<{ list_item_id: string, list_id: string, user_id: string }|null>}
   */
  async function findItemWithOwner(listItemId) {
    const result = await db.raw(
      `SELECT li._id AS list_item_id, li.list_id, l.user_id
       FROM list_items li
       JOIN lists l ON l._id = li.list_id
       WHERE li._id = $1
       LIMIT 1`,
      [listItemId],
      { name: 'list-items-repo-item-owner', retryable: true }
    );
    return result.rows[0] || null;
  }

  /**
   * @param {string} listItemId - `list_items._id` (TEXT).
   * @param {string} trackIdentifier
   * @param {number} targetPriority - 1 = primary, anything else = secondary.
   * @returns {Promise<TrackPicks|null>} null when the list item does not exist.
   */
  async function setTrackPick(listItemId, trackIdentifier, targetPriority) {
    return db.withTransaction(async (client) => {
      const current = await client.query(
        `SELECT primary_track, secondary_track FROM list_items WHERE _id = $1 FOR UPDATE`,
        [listItemId]
      );

      if (current.rows.length === 0) {
        return null;
      }

      const updates = calculateUpdatedTrackPicks(
        current.rows[0],
        trackIdentifier,
        targetPriority
      );

      await client.query(
        `UPDATE list_items
         SET primary_track = $1, secondary_track = $2, updated_at = NOW()
         WHERE _id = $3`,
        [updates.primary, updates.secondary, listItemId]
      );

      return updates;
    });
  }

  /**
   * Clear one or both track picks on a list item.
   *
   * @param {string} listItemId - `list_items._id` (TEXT).
   * @param {string|null} [trackIdentifier] - When null/omitted, both picks are
   *   cleared; otherwise only the pick(s) matching it are cleared.
   * @returns {Promise<TrackPicks|null>} null when the list item does not exist.
   */
  async function removeTrackPick(listItemId, trackIdentifier = null) {
    return db.withTransaction(async (client) => {
      const current = await client.query(
        `SELECT primary_track, secondary_track FROM list_items WHERE _id = $1 FOR UPDATE`,
        [listItemId]
      );

      if (current.rows.length === 0) {
        return null;
      }

      if (!trackIdentifier) {
        await client.query(
          `UPDATE list_items
           SET primary_track = NULL, secondary_track = NULL, updated_at = NOW()
           WHERE _id = $1`,
          [listItemId]
        );
        return { primary: null, secondary: null };
      }

      const { primary_track: primaryTrack, secondary_track: secondaryTrack } =
        current.rows[0];

      const updates = {
        primary: primaryTrack === trackIdentifier ? null : primaryTrack,
        secondary: secondaryTrack === trackIdentifier ? null : secondaryTrack,
      };

      await client.query(
        `UPDATE list_items
         SET primary_track = $1, secondary_track = $2, updated_at = NOW()
         WHERE _id = $3`,
        [updates.primary, updates.secondary, listItemId]
      );

      return updates;
    });
  }

  return {
    findWithAlbumData,
    findItemWithOwner,
    setTrackPick,
    removeTrackPick,
  };
}

module.exports = {
  createListItemsRepository,
  calculateUpdatedTrackPicks,
};
