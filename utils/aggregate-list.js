const logger = require('./logger');
const { normalizeForComparison } = require('./fuzzy-match');

/**
 * Position-based points for weighted aggregation
 * Same as user-preferences.js for consistency
 */
const POSITION_POINTS = {
  1: 60,
  2: 54,
  3: 50,
  4: 46,
  5: 43,
  6: 40,
  7: 38,
  8: 36,
  9: 34,
  10: 32,
  11: 30,
  12: 29,
  13: 28,
  14: 27,
  15: 26,
  16: 25,
  17: 24,
  18: 23,
  19: 22,
  20: 21,
  21: 20,
  22: 19,
  23: 18,
  24: 17,
  25: 16,
  26: 15,
  27: 14,
  28: 13,
  29: 12,
  30: 11,
  31: 10,
  32: 9,
  33: 8,
  34: 7,
  35: 6,
  36: 5,
  37: 4,
  38: 3,
  39: 2,
  40: 1,
};

/**
 * Get points for a position (0 points for positions beyond 40)
 * Only positions 1-40 are eligible for points
 */
function getPositionPoints(position) {
  return POSITION_POINTS[position] || 0;
}

/**
 * Normalize artist and album names for aggregate list deduplication
 * Uses sophisticated normalization from fuzzy-match to catch:
 * - Edition suffixes: "(Deluxe Edition)", "[Remastered]"
 * - Leading articles: "The", "A", "An", etc.
 * - Punctuation differences: "AC/DC" vs "ACDC"
 * - Ampersand variations: "&" vs "and"
 *
 * Only affects the key used for grouping - does not modify display values
 * @param {string|null|undefined} artist - Artist name
 * @param {string|null|undefined} album - Album name
 * @returns {string} Normalized key in format "artist::album"
 */
function normalizeAlbumKey(artist, album) {
  const normalizedArtist = normalizeForComparison(String(artist || ''));
  const normalizedAlbum = normalizeForComparison(String(album || ''));
  return `${normalizedArtist}::${normalizedAlbum}`;
}

// ============================================
// AGGREGATION HELPER FUNCTIONS
// ============================================

/**
 * Convert BYTEA cover image to base64 data URL
 * @param {Buffer|string|null} coverImage - Cover image data (Buffer from BYTEA or legacy string)
 * @param {string} format - Image format (e.g., 'JPEG', 'PNG')
 * @returns {string} - Base64 data URL or empty string
 */
function convertCoverToDataUrl(coverImage, format) {
  if (!coverImage) return '';

  // Handle both BYTEA (Buffer) and legacy TEXT (base64 string) formats
  const base64 = Buffer.isBuffer(coverImage)
    ? coverImage.toString('base64')
    : coverImage;

  const imageFormat = (format || 'jpeg').toLowerCase();
  return `data:image/${imageFormat};base64,${base64}`;
}

/**
 * Build album map from list items
 *
 * IMPORTANT: We always use normalized artist::album as the grouping key.
 * This ensures the same album is never duplicated in the aggregate list,
 * even if different users added it with different album_id values
 * (e.g., one from MusicBrainz, one from Spotify, one manual entry).
 *
 * The album_id is still stored in the result for reference, but the first
 * album_id encountered is used (typically the most complete one since
 * items are ordered by position).
 *
 * @param {Array} items - List items from database
 * @param {Map} userMap - Map of user_id -> username
 * @returns {Map} - Map of normalized album key -> album data
 */
function buildAlbumMap(items, userMap) {
  const albumMap = new Map();

  for (const item of items) {
    // Always use normalized key to prevent duplicates from different sources
    // This ensures "Radiohead - OK Computer" is grouped together regardless of
    // whether it came from MusicBrainz, Spotify, Tidal, or manual entry
    const albumKey = normalizeAlbumKey(item.artist, item.album);
    const points = getPositionPoints(item.position);
    const username = userMap.get(item.user_id);

    if (!albumMap.has(albumKey)) {
      albumMap.set(albumKey, {
        albumId: item.album_id || null,
        artist: item.artist || '',
        album: item.album || '',
        // Convert BYTEA Buffer to base64 data URL for JSON serialization
        coverImage: convertCoverToDataUrl(
          item.cover_image,
          item.cover_image_format
        ),
        releaseDate: item.release_date || '',
        country: item.country || '',
        genre1: item.genre_1 || '',
        genre2: item.genre_2 || '',
        totalPoints: 0,
        voterCount: 0,
        positions: [],
        voters: [],
      });
    }

    const albumData = albumMap.get(albumKey);
    albumData.totalPoints += points;
    albumData.voterCount += 1;
    albumData.positions.push(item.position);
    albumData.voters.push({ username, position: item.position, points });
  }

  return albumMap;
}

/**
 * Convert album map to sorted array with ranks
 * @param {Map} albumMap - Album data map
 * @returns {Array} - Sorted array of albums with ranks
 */
function sortAndRankAlbums(albumMap) {
  const albums = Array.from(albumMap.values())
    .filter((album) => album.positions && album.positions.length > 0) // Guard against empty positions
    .filter((album) => album.totalPoints > 0) // Only include albums with points (must appear in top 40)
    .map((album) => {
      const positions = album.positions;
      return {
        albumId: album.albumId,
        artist: album.artist,
        album: album.album,
        coverImage: album.coverImage,
        releaseDate: album.releaseDate,
        country: album.country,
        genre1: album.genre1,
        genre2: album.genre2,
        totalPoints: album.totalPoints,
        voterCount: album.voterCount,
        averagePosition:
          Math.round(
            (positions.reduce((a, b) => a + b, 0) / positions.length) * 100
          ) / 100,
        highestPosition: Math.min(...positions),
        lowestPosition: Math.max(...positions),
        voters: album.voters.sort((a, b) => a.position - b.position),
      };
    })
    .sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) {
        return b.totalPoints - a.totalPoints;
      }
      // Tiebreaker: highest position (lower number wins)
      return a.highestPosition - b.highestPosition;
    });

  // Assign ranks with shared positions for ties
  let currentRank = 1;
  for (let i = 0; i < albums.length; i++) {
    if (i > 0) {
      const prev = albums[i - 1];
      const curr = albums[i];
      // Check if this album is tied with the previous one (same points and highest position)
      if (
        prev.totalPoints === curr.totalPoints &&
        prev.highestPosition === curr.highestPosition
      ) {
        // Same rank as previous
        albums[i].rank = albums[i - 1].rank;
      } else {
        // New rank (skip positions for ties)
        currentRank = i + 1;
        albums[i].rank = currentRank;
      }
    } else {
      albums[0].rank = 1;
    }
  }

  return albums;
}

/**
 * Compute stats for an album list
 * @param {Array} albums - Sorted album array
 * @param {number} participantCount - Number of participants
 * @param {number} year - Year
 * @returns {Object} - Stats object
 */
function computeStats(albums, participantCount, year) {
  const albumsWith3PlusVoters = albums.filter((a) => a.voterCount >= 3).length;
  const albumsWith2Voters = albums.filter((a) => a.voterCount === 2).length;
  const albumsWith1Voter = albums.filter((a) => a.voterCount === 1).length;
  const topPointsDistribution = albums.slice(0, 20).map((a) => a.totalPoints);

  // Calculate rank distribution: which ranks exist and how many albums at each rank
  const rankDistribution = {};
  albums.forEach((album) => {
    const rank = album.rank;
    rankDistribution[rank] = (rankDistribution[rank] || 0) + 1;
  });

  return {
    year,
    participantCount,
    totalAlbums: albums.length,
    rankDistribution,
    albumsWith3PlusVoters,
    albumsWith2Voters,
    albumsWith1Voter,
    topPointsDistribution,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Create empty result for year with no data
 */
function createEmptyResult(year) {
  return {
    data: {
      year,
      generatedAt: new Date().toISOString(),
      participantCount: 0,
      albums: [],
    },
    stats: {
      year,
      participantCount: 0,
      totalAlbums: 0,
      rankDistribution: {},
      albumsWith3PlusVoters: 0,
      albumsWith2Voters: 0,
      albumsWith1Voter: 0,
      topPointsDistribution: [],
      computedAt: new Date().toISOString(),
    },
  };
}

// ============================================
// DATABASE QUERY HELPERS
// ============================================

/**
 * Fetch main lists and build user map for a year
 */
async function fetchMainListsForYear(pool, year) {
  const listsResult = await pool.query(
    `
    SELECT l._id as list_id, l.user_id, u.username
    FROM lists l
    JOIN users u ON l.user_id = u._id
    WHERE l.year = $1 AND l.is_main = TRUE
      AND l.user_id IN (SELECT user_id FROM aggregate_list_contributors WHERE year = $1)
  `,
    [year]
  );

  const mainLists = listsResult.rows;
  const userMap = new Map();
  for (const list of mainLists) {
    userMap.set(list.user_id, list.username);
  }

  return {
    mainLists,
    userMap,
    listIds: mainLists.map((l) => l.list_id),
  };
}

/**
 * Fetch all list items for given list IDs
 * Only includes items in positions 1-40 (top 40 albums per list)
 */
async function fetchListItemsForLists(pool, listIds) {
  const itemsResult = await pool.query(
    `
    SELECT 
      li.list_id,
      li.position,
      li.album_id,
      COALESCE(NULLIF(li.artist, ''), a.artist) as artist,
      COALESCE(NULLIF(li.album, ''), a.album) as album,
      COALESCE(NULLIF(li.release_date, ''), a.release_date) as release_date,
      COALESCE(NULLIF(li.country, ''), a.country) as country,
      COALESCE(NULLIF(li.genre_1, ''), a.genre_1) as genre_1,
      COALESCE(NULLIF(li.genre_2, ''), a.genre_2) as genre_2,
      COALESCE(li.cover_image, a.cover_image) as cover_image,
      COALESCE(NULLIF(li.cover_image_format, ''), a.cover_image_format) as cover_image_format,
      l.user_id
    FROM list_items li
    JOIN lists l ON li.list_id = l._id
    LEFT JOIN albums a ON li.album_id = a.album_id
    WHERE li.list_id = ANY($1) AND li.position <= 40
    ORDER BY li.position
  `,
    [listIds]
  );
  return itemsResult.rows;
}

/**
 * Save or update aggregate list in database
 */
async function saveAggregateList(pool, year, data, stats) {
  const result = await pool.query(
    `
    INSERT INTO master_lists (year, data, stats, computed_at, created_at, updated_at)
    VALUES ($1, $2, $3, NOW(), NOW(), NOW())
    ON CONFLICT (year) DO UPDATE SET
      data = $2,
      stats = $3,
      computed_at = NOW(),
      updated_at = NOW()
    RETURNING *
  `,
    [year, JSON.stringify(data), JSON.stringify(stats)]
  );
  return result.rows[0];
}

/**
 * Get aggregate list status with confirmations
 */
async function buildAggregateStatus(pool, aggregateList, year) {
  if (!aggregateList) {
    return {
      exists: false,
      revealed: false,
      confirmations: [],
      confirmationCount: 0,
      requiredConfirmations: 2,
    };
  }

  const confirmResult = await pool.query(
    `
    SELECT c.confirmed_at, u.username
    FROM master_list_confirmations c
    JOIN users u ON c.admin_user_id = u._id
    WHERE c.year = $1
    ORDER BY c.confirmed_at
  `,
    [year]
  );

  const totalAlbums = aggregateList.stats?.totalAlbums || 0;
  const rankDistribution = aggregateList.stats?.rankDistribution || {};

  return {
    exists: true,
    revealed: aggregateList.revealed,
    revealedAt: aggregateList.revealed_at,
    computedAt: aggregateList.computed_at,
    totalAlbums,
    rankDistribution,
    confirmations: confirmResult.rows.map((r) => ({
      username: r.username,
      confirmedAt: r.confirmed_at,
    })),
    confirmationCount: confirmResult.rows.length,
    requiredConfirmations: 2,
  };
}

/**
 * Query contributors for a year
 */
async function queryContributors(pool, year) {
  const result = await pool.query(
    `
    SELECT 
      c.user_id,
      c.added_at,
      u.username,
      u.email,
      a.username as added_by_username
    FROM aggregate_list_contributors c
    JOIN users u ON c.user_id = u._id
    JOIN users a ON c.added_by = a._id
    WHERE c.year = $1
    ORDER BY c.added_at DESC
  `,
    [year]
  );
  return result.rows;
}

/**
 * Query eligible users for a year
 */
async function queryEligibleUsers(pool, year) {
  const result = await pool.query(
    `
    SELECT 
      u._id as user_id,
      u.username,
      u.email,
      l._id as list_id,
      l.name as list_name,
      (SELECT COUNT(*) FROM list_items li WHERE li.list_id = l._id) as album_count,
      EXISTS(
        SELECT 1 FROM aggregate_list_contributors c 
        WHERE c.year = $1 AND c.user_id = u._id
      ) as is_contributor
    FROM lists l
    JOIN users u ON l.user_id = u._id
    WHERE l.year = $1 AND l.is_main = TRUE
    ORDER BY u.username
  `,
    [year]
  );
  return result.rows;
}

/**
 * Bulk set contributors for a year (transaction)
 */
async function setContributorsTransaction(pool, year, userIds, addedBy, log) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      'DELETE FROM aggregate_list_contributors WHERE year = $1',
      [year]
    );

    if (userIds.length > 0) {
      const values = userIds
        .map((_, i) => `($1, $${i + 2}, $${userIds.length + 2})`)
        .join(', ');
      await client.query(
        `INSERT INTO aggregate_list_contributors (year, user_id, added_by) VALUES ${values}`,
        [year, ...userIds, addedBy]
      );
    }

    await client.query('COMMIT');
    return { success: true, count: userIds.length };
  } catch (err) {
    await client.query('ROLLBACK');
    log.error(`Error setting contributors: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

// ============================================
// REVEAL VIEW TRACKING (extracted for line count)
// ============================================

/**
 * Check if a user has seen the dramatic reveal for a year
 */
async function checkHasSeen(pool, year, userId) {
  const result = await pool.query(
    'SELECT 1 FROM aggregate_list_views WHERE year = $1 AND user_id = $2',
    [year, userId]
  );
  return result.rows.length > 0;
}

/**
 * Mark that a user has seen the dramatic reveal for a year
 */
async function markAsSeen(pool, log, year, userId) {
  log.info(`Marking user ${userId} as having seen reveal for year ${year}`);
  await pool.query(
    `
    INSERT INTO aggregate_list_views (year, user_id, viewed_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (user_id, year) DO NOTHING
  `,
    [year, userId]
  );
  return { success: true };
}

/**
 * Reset a user's reveal view status for a year (admin testing)
 */
async function resetSeenStatus(pool, log, year, userId) {
  log.info(`Resetting reveal view status for user ${userId}, year ${year}`);
  const result = await pool.query(
    'DELETE FROM aggregate_list_views WHERE year = $1 AND user_id = $2',
    [year, userId]
  );
  return { success: true, deleted: result.rowCount > 0 };
}

/**
 * Get all years a user has viewed the reveal for
 */
async function queryViewedYears(pool, userId) {
  const result = await pool.query(
    `
    SELECT year, viewed_at 
    FROM aggregate_list_views 
    WHERE user_id = $1 
    ORDER BY year DESC
  `,
    [userId]
  );
  return result.rows;
}

// ============================================
// MAIN FACTORY
// ============================================

/**
 * Create aggregate list utilities with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL pool instance
 * @param {Object} deps.logger - Logger instance (optional)
 */
function createAggregateList(deps = {}) {
  const log = deps.logger || logger;
  const pool = deps.pool;

  if (!pool) {
    throw new Error('PostgreSQL pool is required');
  }

  /**
   * Aggregate all main lists for a year into an aggregate list
   */
  async function aggregateForYear(year) {
    log.info(`Aggregating list for year ${year}`);

    const { mainLists, userMap, listIds } = await fetchMainListsForYear(
      pool,
      year
    );
    log.info(`Found ${mainLists.length} main lists for year ${year}`);

    if (mainLists.length === 0) {
      return createEmptyResult(year);
    }

    const items = await fetchListItemsForLists(pool, listIds);
    const albumMap = buildAlbumMap(items, userMap);
    const albums = sortAndRankAlbums(albumMap);
    const stats = computeStats(albums, mainLists.length, year);

    const data = {
      year,
      generatedAt: new Date().toISOString(),
      participantCount: mainLists.length,
      albums,
    };

    log.info(
      `Aggregate list for ${year}: ${albums.length} albums from ${mainLists.length} participants`
    );

    return { data, stats };
  }

  /**
   * Recompute and store aggregate list for a year
   */
  async function recompute(year) {
    log.info(`Recomputing aggregate list for year ${year}`);
    const { data, stats } = await aggregateForYear(year);
    const result = await saveAggregateList(pool, year, data, stats);
    log.info(`Aggregate list for ${year} recomputed successfully`);
    return result;
  }

  /**
   * Get aggregate list for a year (from cache)
   */
  async function get(year) {
    const result = await pool.query(
      'SELECT * FROM master_lists WHERE year = $1',
      [year]
    );
    return result.rows[0] || null;
  }

  /**
   * Get reveal status and confirmations for a year
   */
  async function getStatus(year) {
    const aggregateList = await get(year);
    return buildAggregateStatus(pool, aggregateList, year);
  }

  /**
   * Add admin confirmation for reveal
   */
  async function addConfirmation(year, adminUserId) {
    log.info(`Admin ${adminUserId} confirming reveal for year ${year}`);

    let aggregateList = await get(year);
    if (!aggregateList) {
      await recompute(year);
      aggregateList = await get(year);
    }

    if (aggregateList.revealed) {
      return { alreadyRevealed: true, status: await getStatus(year) };
    }

    await pool.query(
      `
      INSERT INTO master_list_confirmations (year, admin_user_id)
      VALUES ($1, $2)
      ON CONFLICT (year, admin_user_id) DO NOTHING
    `,
      [year, adminUserId]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM master_list_confirmations WHERE year = $1',
      [year]
    );
    const confirmationCount = parseInt(countResult.rows[0].count, 10);

    if (confirmationCount >= 2) {
      log.info(
        `Aggregate list for ${year} has reached 2 confirmations - revealing!`
      );
      await pool.query(
        `
        UPDATE master_lists 
        SET revealed = TRUE, revealed_at = NOW(), updated_at = NOW()
        WHERE year = $1
      `,
        [year]
      );
    }

    return { revealed: confirmationCount >= 2, status: await getStatus(year) };
  }

  /**
   * Remove admin confirmation
   */
  async function removeConfirmation(year, adminUserId) {
    log.info(`Admin ${adminUserId} revoking confirmation for year ${year}`);

    const aggregateList = await get(year);
    if (aggregateList?.revealed) {
      return { alreadyRevealed: true, status: await getStatus(year) };
    }

    await pool.query(
      'DELETE FROM master_list_confirmations WHERE year = $1 AND admin_user_id = $2',
      [year, adminUserId]
    );

    return { status: await getStatus(year) };
  }

  /**
   * Get anonymous stats for admin preview
   */
  async function getStats(year) {
    const aggregateList = await get(year);
    return aggregateList?.stats || null;
  }

  /**
   * Get list of years that have revealed aggregate lists
   */
  async function getRevealedYears() {
    const result = await pool.query(`
      SELECT year, revealed_at 
      FROM master_lists 
      WHERE revealed = TRUE 
      ORDER BY year DESC
    `);
    return result.rows;
  }

  /**
   * Get approved contributors for a year
   */
  async function getContributors(year) {
    return queryContributors(pool, year);
  }

  /**
   * Get all users who have main lists for a year (eligible for contribution)
   */
  async function getEligibleUsers(year) {
    return queryEligibleUsers(pool, year);
  }

  /**
   * Add a user as a contributor for a year
   */
  async function addContributor(year, userId, addedBy) {
    log.info(`Adding user ${userId} as contributor for year ${year}`);

    await pool.query(
      `
      INSERT INTO aggregate_list_contributors (year, user_id, added_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (year, user_id) DO NOTHING
    `,
      [year, userId, addedBy]
    );

    return { success: true };
  }

  /**
   * Remove a user as a contributor for a year
   */
  async function removeContributor(year, userId) {
    log.info(`Removing user ${userId} as contributor for year ${year}`);

    const result = await pool.query(
      `
      DELETE FROM aggregate_list_contributors 
      WHERE year = $1 AND user_id = $2
      RETURNING *
    `,
      [year, userId]
    );

    return { success: true, removed: result.rowCount > 0 };
  }

  /**
   * Bulk update contributors for a year
   */
  async function setContributors(year, userIds, addedBy) {
    log.info(`Setting ${userIds.length} contributors for year ${year}`);
    return setContributorsTransaction(pool, year, userIds, addedBy, log);
  }

  // Reveal view tracking (delegating to extracted functions)
  const hasSeen = (year, userId) => checkHasSeen(pool, year, userId);
  const markSeen = (year, userId) => markAsSeen(pool, log, year, userId);
  const resetSeen = (year, userId) => resetSeenStatus(pool, log, year, userId);
  const getViewedYears = (userId) => queryViewedYears(pool, userId);

  return {
    aggregateForYear,
    recompute,
    get,
    getStatus,
    addConfirmation,
    removeConfirmation,
    getStats,
    getRevealedYears,
    getContributors,
    getEligibleUsers,
    addContributor,
    removeContributor,
    setContributors,
    getPositionPoints,
    POSITION_POINTS,
    // Reveal view tracking
    hasSeen,
    markSeen,
    resetSeen,
    getViewedYears,
  };
}

module.exports = { createAggregateList, getPositionPoints, POSITION_POINTS };
