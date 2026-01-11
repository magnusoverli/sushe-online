/**
 * Aggregate List Audit Utility
 *
 * Provides tools for detecting and fixing potential duplicate albums
 * in aggregate lists. Albums can have different album_ids but represent
 * the same album (e.g., from MusicBrainz, Spotify, Tidal, or manual entry).
 *
 * While the aggregation logic now groups by normalized name (preventing
 * duplicates in the output), this audit tool helps identify data that
 * could benefit from cleanup and provides visibility into the data quality.
 *
 * Follows dependency injection pattern for testability.
 */

const logger = require('./logger');

/**
 * Normalize artist and album names for comparison
 * @param {string|null|undefined} artist - Artist name
 * @param {string|null|undefined} album - Album name
 * @returns {string} Normalized key in format "artist::album"
 */
function normalizeAlbumKey(artist, album) {
  const normalizedArtist = String(artist || '')
    .toLowerCase()
    .trim();
  const normalizedAlbum = String(album || '')
    .toLowerCase()
    .trim();
  return `${normalizedArtist}::${normalizedAlbum}`;
}

/**
 * Apply fix changes in a database transaction
 * @param {Object} pool - Database pool
 * @param {Object} log - Logger
 * @param {number} year - Year to fix
 * @param {Object} preview - Preview result with changes
 * @returns {Promise<Object>} Result of the fix
 */
async function applyFixTransaction(pool, log, year, preview) {
  const client = await pool.connect();
  let totalUpdated = 0;

  try {
    await client.query('BEGIN');

    for (const change of preview.changes) {
      for (const entry of change.affectedEntries) {
        const updateResult = await client.query(
          `
          UPDATE list_items 
          SET album_id = $1, updated_at = NOW()
          WHERE album_id = $2
            AND list_id IN (
              SELECT l._id FROM lists l
              WHERE l.year = $3 AND l.is_main = TRUE
                AND l.user_id IN (SELECT user_id FROM aggregate_list_contributors WHERE year = $3)
            )
        `,
          [change.canonicalAlbumId, entry.currentAlbumId, year]
        );
        totalUpdated += updateResult.rowCount;
      }
    }

    await client.query('COMMIT');

    log.info(`Aggregate fix for ${year}: Updated ${totalUpdated} list_items`);

    return {
      year,
      executedAt: new Date().toISOString(),
      dryRun: false,
      success: true,
      message: `Successfully updated ${totalUpdated} list_items`,
      changesApplied: totalUpdated,
      details: preview.changes,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    log.error(`Aggregate fix failed for ${year}: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Create aggregate audit utilities with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL pool instance
 * @param {Object} deps.logger - Logger instance (optional)
 */
function createAggregateAudit(deps = {}) {
  const log = deps.logger || logger;
  const pool = deps.pool;

  if (!pool) {
    throw new Error('PostgreSQL pool is required');
  }

  /**
   * Find potential duplicate albums for a year's aggregate list
   *
   * Returns albums that have the same normalized artist::album key
   * but different album_id values across contributor lists.
   *
   * @param {number} year - The year to audit
   * @returns {Promise<Object>} Audit results
   */
  async function findDuplicates(year) {
    log.info(`Running aggregate audit for year ${year}`);

    // Find all list items from contributors for this year
    const result = await pool.query(
      `
      SELECT 
        li.album_id,
        COALESCE(NULLIF(li.artist, ''), a.artist) as artist,
        COALESCE(NULLIF(li.album, ''), a.album) as album,
        li.position,
        l.user_id,
        u.username,
        l.name as list_name
      FROM list_items li
      JOIN lists l ON li.list_id = l._id
      JOIN users u ON l.user_id = u._id
      LEFT JOIN albums a ON li.album_id = a.album_id
      WHERE l.year = $1 
        AND l.is_main = TRUE
        AND li.position <= 40
        AND l.user_id IN (SELECT user_id FROM aggregate_list_contributors WHERE year = $1)
      ORDER BY li.position
    `,
      [year]
    );

    // Group by normalized key
    const normalizedGroups = new Map();

    for (const item of result.rows) {
      const normalizedKey = normalizeAlbumKey(item.artist, item.album);

      if (!normalizedGroups.has(normalizedKey)) {
        normalizedGroups.set(normalizedKey, {
          normalizedKey,
          artist: item.artist,
          album: item.album,
          albumIds: new Set(),
          entries: [],
        });
      }

      const group = normalizedGroups.get(normalizedKey);
      if (item.album_id) {
        group.albumIds.add(item.album_id);
      }
      group.entries.push({
        albumId: item.album_id,
        position: item.position,
        username: item.username,
        listName: item.list_name,
      });
    }

    // Find groups with multiple album_ids (potential duplicates)
    const duplicates = [];
    for (const [key, group] of normalizedGroups) {
      if (group.albumIds.size > 1) {
        duplicates.push({
          normalizedKey: key,
          artist: group.artist,
          album: group.album,
          albumIds: Array.from(group.albumIds),
          entryCount: group.entries.length,
          entries: group.entries,
        });
      }
    }

    // Sort by number of different album_ids (most problematic first)
    duplicates.sort((a, b) => b.albumIds.length - a.albumIds.length);

    const report = {
      year,
      auditedAt: new Date().toISOString(),
      totalAlbumsScanned: result.rows.length,
      uniqueAlbums: normalizedGroups.size,
      duplicateGroups: duplicates.length,
      duplicates,
    };

    log.info(
      `Aggregate audit for ${year}: Found ${duplicates.length} albums with multiple album_ids`
    );

    return report;
  }

  /**
   * Preview what would change if we normalized album_ids
   *
   * This shows which list_items would be updated to use a canonical album_id.
   *
   * @param {number} year - The year to preview
   * @returns {Promise<Object>} Preview of changes
   */
  async function previewFix(year) {
    log.info(`Generating fix preview for year ${year}`);

    const auditResult = await findDuplicates(year);

    if (auditResult.duplicates.length === 0) {
      return {
        year,
        previewedAt: new Date().toISOString(),
        changesRequired: false,
        message: 'No duplicates found - no changes needed',
        changes: [],
      };
    }

    const changes = [];

    for (const duplicate of auditResult.duplicates) {
      // Determine canonical album_id (prefer external IDs over manual/internal)
      const canonicalId = selectCanonicalAlbumId(duplicate.albumIds);

      // Find entries that would need updating
      const entriesToUpdate = duplicate.entries.filter(
        (e) => e.albumId !== canonicalId && e.albumId !== null
      );

      if (entriesToUpdate.length > 0) {
        changes.push({
          artist: duplicate.artist,
          album: duplicate.album,
          canonicalAlbumId: canonicalId,
          currentAlbumIds: duplicate.albumIds,
          affectedEntries: entriesToUpdate.map((e) => ({
            currentAlbumId: e.albumId,
            username: e.username,
            position: e.position,
          })),
        });
      }
    }

    return {
      year,
      previewedAt: new Date().toISOString(),
      changesRequired: changes.length > 0,
      totalChanges: changes.reduce(
        (sum, c) => sum + c.affectedEntries.length,
        0
      ),
      changes,
    };
  }

  /**
   * Execute the fix - update list_items to use canonical album_ids
   *
   * @param {number} year - The year to fix
   * @param {boolean} dryRun - If true, don't actually make changes
   * @returns {Promise<Object>} Results of the fix operation
   */
  async function executeFix(year, dryRun = false) {
    log.info(`Executing aggregate fix for year ${year} (dryRun: ${dryRun})`);

    const preview = await previewFix(year);

    if (!preview.changesRequired) {
      return {
        year,
        executedAt: new Date().toISOString(),
        dryRun,
        success: true,
        message: 'No changes needed',
        changesApplied: 0,
      };
    }

    if (dryRun) {
      return {
        year,
        executedAt: new Date().toISOString(),
        dryRun: true,
        success: true,
        message: `Dry run: Would apply ${preview.totalChanges} changes`,
        changesApplied: 0,
        wouldChange: preview.changes,
      };
    }

    // Apply the changes using the extracted helper
    return applyFixTransaction(pool, log, year, preview);
  }

  /**
   * Get a full audit report for a year
   *
   * @param {number} year - The year to audit
   * @returns {Promise<Object>} Full audit report
   */
  async function getAuditReport(year) {
    const duplicates = await findDuplicates(year);
    const preview = await previewFix(year);

    return {
      year,
      generatedAt: new Date().toISOString(),
      summary: {
        totalAlbumsScanned: duplicates.totalAlbumsScanned,
        uniqueAlbums: duplicates.uniqueAlbums,
        albumsWithMultipleIds: duplicates.duplicateGroups,
        changesRequired: preview.changesRequired,
        totalChangesNeeded: preview.totalChanges || 0,
      },
      duplicates: duplicates.duplicates,
      proposedChanges: preview.changes,
    };
  }

  return {
    findDuplicates,
    previewFix,
    executeFix,
    getAuditReport,
    // Export for testing
    normalizeAlbumKey,
  };
}

/**
 * Select the canonical album_id from a list of IDs
 * Priority: External IDs (Spotify, MusicBrainz) > Internal IDs > Manual IDs
 *
 * @param {string[]} albumIds - Array of album IDs
 * @returns {string} The canonical album_id to use
 */
function selectCanonicalAlbumId(albumIds) {
  if (!albumIds || albumIds.length === 0) {
    return null;
  }

  // Filter out null/empty
  const validIds = albumIds.filter((id) => id && id.trim() !== '');

  if (validIds.length === 0) {
    return null;
  }

  // Priority order:
  // 1. Spotify IDs (typically alphanumeric, 22 chars)
  // 2. MusicBrainz UUIDs (36 chars with dashes)
  // 3. Internal IDs (start with "internal-")
  // 4. Manual IDs (start with "manual-")
  // 5. Any other ID

  // Check for Spotify-like ID (22 chars alphanumeric)
  const spotifyId = validIds.find((id) => /^[a-zA-Z0-9]{22}$/.test(id));
  if (spotifyId) return spotifyId;

  // Check for MusicBrainz UUID
  const mbId = validIds.find((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );
  if (mbId) return mbId;

  // Check for non-manual, non-internal IDs
  const externalId = validIds.find(
    (id) => !id.startsWith('manual-') && !id.startsWith('internal-')
  );
  if (externalId) return externalId;

  // Check for internal IDs (better than manual)
  const internalId = validIds.find((id) => id.startsWith('internal-'));
  if (internalId) return internalId;

  // Fall back to first valid ID
  return validIds[0];
}

module.exports = {
  createAggregateAudit,
  selectCanonicalAlbumId,
  normalizeAlbumKey,
};
