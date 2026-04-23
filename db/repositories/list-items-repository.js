const { ensureDb } = require('../postgres');

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
    comments: row.comments || '',
    comments2: row.comments_2 || '',
    tracks: row.tracks || null,
    coverImage: row.cover_image || '',
    coverImageFormat: row.cover_image_format || '',
    summary: row.summary || '',
    summarySource: row.summary_source || '',
  };
}

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

function createListItemsRepository(deps = {}) {
  const db = ensureDb(deps.db, 'list-items-repository');

  async function findByExternalId(listItemId) {
    const result = await db.raw(
      `SELECT _id, list_id, position, album_id, comments, comments_2, primary_track, secondary_track
       FROM list_items
       WHERE _id = $1
       LIMIT 1`,
      [listItemId],
      { name: 'list-items-repo-find-by-id', retryable: true }
    );
    return result.rows[0] || null;
  }

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
         a.artist,
         a.album,
         a.release_date,
         a.country,
         a.genre_1,
         a.genre_2,
         a.tracks,
         a.cover_image,
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
    findByExternalId,
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
