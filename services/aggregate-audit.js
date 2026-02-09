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

const logger = require('../utils/logger');
const {
  findPotentialDuplicates,
  normalizeAlbumKey,
} = require('../utils/fuzzy-match');
const { withTransaction } = require('../db/transaction');

/**
 * Basic normalization (lowercase + trim only)
 * Used for comparison with sophisticated normalization to detect missed duplicates
 * @param {string|null|undefined} artist - Artist name
 * @param {string|null|undefined} album - Album name
 * @returns {string} Normalized key in format "artist::album"
 */
function basicNormalizeAlbumKey(artist, album) {
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
  let totalUpdated = 0;

  await withTransaction(pool, async (client) => {
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
  });

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
}

/**
 * Create aggregate audit utilities with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL pool instance
 * @param {Object} deps.logger - Logger instance (optional)
 */
// eslint-disable-next-line max-lines-per-function -- Cohesive utility module with multiple related functions
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
    // All album metadata comes from canonical albums table
    const result = await pool.query(
      `
      SELECT 
        li.album_id,
        a.artist,
        a.album,
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
   * Diagnose normalization effectiveness by comparing basic vs sophisticated normalization
   *
   * This helps identify albums that would be missed by simple lowercase+trim
   * but caught by the full normalization (edition suffixes, articles, punctuation, etc.)
   *
   * @param {number} year - The year to diagnose
   * @returns {Promise<Object>} Diagnostic report
   */
  async function diagnoseNormalization(year) {
    log.info(`Running normalization diagnostic for year ${year}`);

    // Find all list items from contributors for this year
    // All album metadata comes from canonical albums table
    const result = await pool.query(
      `
      SELECT 
        li.album_id,
        a.artist,
        a.album,
        li.position,
        l.user_id,
        u.username
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

    // Group by BASIC normalization (old method)
    const basicGroups = new Map();
    // Group by SOPHISTICATED normalization (new method)
    const sophisticatedGroups = new Map();

    for (const item of result.rows) {
      const basicKey = basicNormalizeAlbumKey(item.artist, item.album);
      const sophisticatedKey = normalizeAlbumKey(item.artist, item.album);

      // Track basic groups
      if (!basicGroups.has(basicKey)) {
        basicGroups.set(basicKey, {
          artist: item.artist,
          album: item.album,
          entries: [],
        });
      }
      basicGroups.get(basicKey).entries.push({
        username: item.username,
        position: item.position,
        albumId: item.album_id,
      });

      // Track sophisticated groups
      if (!sophisticatedGroups.has(sophisticatedKey)) {
        sophisticatedGroups.set(sophisticatedKey, {
          artist: item.artist,
          album: item.album,
          basicKeys: new Set(),
          entries: [],
        });
      }
      const sophGroup = sophisticatedGroups.get(sophisticatedKey);
      sophGroup.basicKeys.add(basicKey);
      sophGroup.entries.push({
        username: item.username,
        position: item.position,
        albumId: item.album_id,
        originalArtist: item.artist,
        originalAlbum: item.album,
      });
    }

    // Find albums that sophisticated normalization merges but basic doesn't
    const missedByBasic = [];
    for (const [sophKey, sophGroup] of sophisticatedGroups) {
      if (sophGroup.basicKeys.size > 1) {
        // This sophisticated key maps to multiple basic keys = albums that WOULD be duplicated with basic normalization
        const variants = [];
        for (const basicKey of sophGroup.basicKeys) {
          const basicGroup = basicGroups.get(basicKey);
          variants.push({
            basicKey,
            artist: basicGroup.artist,
            album: basicGroup.album,
            entryCount: basicGroup.entries.length,
            entries: basicGroup.entries,
          });
        }
        missedByBasic.push({
          sophisticatedKey: sophKey,
          canonicalArtist: sophGroup.artist,
          canonicalAlbum: sophGroup.album,
          totalEntries: sophGroup.entries.length,
          variantCount: sophGroup.basicKeys.size,
          variants,
        });
      }
    }

    // Calculate overlap statistics
    const albumsWithMultipleVoters = [];
    for (const [_sophKey, sophGroup] of sophisticatedGroups) {
      if (sophGroup.entries.length > 1) {
        const uniqueVoters = new Set(sophGroup.entries.map((e) => e.username))
          .size;
        if (uniqueVoters > 1) {
          albumsWithMultipleVoters.push({
            artist: sophGroup.artist,
            album: sophGroup.album,
            voterCount: uniqueVoters,
            entries: sophGroup.entries.length,
          });
        }
      }
    }

    // Sort by voter count descending
    albumsWithMultipleVoters.sort((a, b) => b.voterCount - a.voterCount);

    const report = {
      year,
      diagnosedAt: new Date().toISOString(),
      totalListEntries: result.rows.length,
      uniqueAlbumsBasic: basicGroups.size,
      uniqueAlbumsSophisticated: sophisticatedGroups.size,
      albumsMissedByBasicNormalization: missedByBasic.length,
      missedByBasic,
      overlapStats: {
        albumsAppearingOnMultipleLists: albumsWithMultipleVoters.length,
        topOverlappingAlbums: albumsWithMultipleVoters.slice(0, 20),
        distribution: {
          appearsOn1List:
            sophisticatedGroups.size - albumsWithMultipleVoters.length,
          appearsOn2PlusLists: albumsWithMultipleVoters.length,
          appearsOn3PlusLists: albumsWithMultipleVoters.filter(
            (a) => a.voterCount >= 3
          ).length,
          appearsOn5PlusLists: albumsWithMultipleVoters.filter(
            (a) => a.voterCount >= 5
          ).length,
        },
      },
    };

    log.info(
      `Normalization diagnostic for ${year}: Basic found ${basicGroups.size} unique, ` +
        `Sophisticated found ${sophisticatedGroups.size} unique, ` +
        `${missedByBasic.length} albums would be duplicated with basic normalization`
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

  /**
   * Check if a manual album is orphaned (not in albums table)
   * @param {Object} album - Album data from query
   * @returns {boolean} - True if orphaned
   */
  function isOrphanedAlbum(album) {
    return album.artist === null && album.album === null && !album.has_cover;
  }

  /**
   * Check if a manual album has missing metadata
   * @param {Object} album - Album data from query
   * @returns {boolean} - True if missing metadata
   */
  function hasMissingMetadata(album) {
    return (
      !album.artist ||
      album.artist.trim() === '' ||
      !album.album ||
      album.album.trim() === ''
    );
  }

  /**
   * Create an integrity issue object for orphaned albums
   * @param {Object} album - Album data
   * @param {Array} usedIn - List usage info
   * @returns {Object} - Integrity issue
   */
  function createOrphanedIssue(album, usedIn) {
    return {
      type: 'orphaned',
      severity: 'high',
      manualId: album.album_id,
      artist: null,
      album: null,
      description:
        'Album referenced in lists but does not exist in albums table',
      usedIn,
      fixAction: 'delete_references',
    };
  }

  /**
   * Create an integrity issue object for missing metadata
   * @param {Object} album - Album data
   * @param {Array} usedIn - List usage info
   * @returns {Object} - Integrity issue
   */
  function createMissingMetadataIssue(album, usedIn) {
    const missingFields = [];
    if (!album.artist || album.artist.trim() === '') {
      missingFields.push('artist');
    }
    if (!album.album || album.album.trim() === '') {
      missingFields.push('album');
    }

    return {
      type: 'missing_metadata',
      severity: 'medium',
      manualId: album.album_id,
      artist: album.artist || null,
      album: album.album || null,
      description: `Missing ${missingFields.join(' and ')} name`,
      usedIn,
      fixAction: 'manual_review',
    };
  }

  /**
   * Find manual albums that may match canonical albums in the database
   *
   * Scans all list_items with manual-* album_ids and finds potential
   * matches in the albums table using fuzzy matching with dynamic thresholds.
   *
   * @param {Object} options - Options
   * @param {number} options.threshold - Fuzzy match threshold (default: 0.15, high sensitivity)
   * @param {number} options.maxMatchesPerAlbum - Max matches per manual album (default: 5)
   * @returns {Promise<Object>} Manual albums with potential matches
   */
  async function findManualAlbumsForReconciliation(options = {}) {
    // Default threshold: 0.15 (high sensitivity) - human reviews all matches
    const { threshold = 0.15, maxMatchesPerAlbum = 5 } = options;

    log.info('Finding manual albums for reconciliation');

    // 1. Find all manual albums in list_items
    // All album metadata comes from canonical albums table
    const manualItemsResult = await pool.query(`
      SELECT DISTINCT ON (li.album_id)
        li.album_id,
        a.artist,
        a.album,
        a.cover_image IS NOT NULL as has_cover
      FROM list_items li
      LEFT JOIN albums a ON li.album_id = a.album_id
      WHERE li.album_id LIKE 'manual-%'
      ORDER BY li.album_id
    `);

    if (manualItemsResult.rows.length === 0) {
      log.info('No manual albums found');
      return {
        manualAlbums: [],
        totalManual: 0,
        totalWithMatches: 0,
        integrityIssues: [],
        totalIntegrityIssues: 0,
      };
    }

    // 2. Get usage info for each manual album (which lists use it)
    const usageResult = await pool.query(`
      SELECT 
        li.album_id,
        l._id as list_id,
        l.name as list_name,
        l.year,
        u._id as user_id,
        u.username
      FROM list_items li
      JOIN lists l ON li.list_id = l._id
      JOIN users u ON l.user_id = u._id
      WHERE li.album_id LIKE 'manual-%'
      ORDER BY li.album_id, l.year DESC
    `);

    // Build usage map
    const usageMap = new Map();
    for (const row of usageResult.rows) {
      if (!usageMap.has(row.album_id)) {
        usageMap.set(row.album_id, []);
      }
      usageMap.get(row.album_id).push({
        listId: row.list_id,
        listName: row.list_name,
        year: row.year,
        userId: row.user_id,
        username: row.username,
      });
    }

    // 3. Get all canonical albums (non-manual) for matching
    const canonicalResult = await pool.query(`
      SELECT 
        album_id,
        artist,
        album,
        cover_image IS NOT NULL as has_cover
      FROM albums
      WHERE album_id NOT LIKE 'manual-%'
        AND album_id NOT LIKE 'internal-%'
        AND artist IS NOT NULL AND artist != ''
        AND album IS NOT NULL AND album != ''
    `);

    const canonicalAlbums = canonicalResult.rows.map((row) => ({
      album_id: row.album_id,
      artist: row.artist,
      album: row.album,
      hasCover: row.has_cover,
    }));

    // 4. Get excluded pairs (already marked as distinct)
    const excludedResult = await pool.query(`
      SELECT album_id_1, album_id_2 FROM album_distinct_pairs
    `);

    const excludePairs = new Set();
    for (const row of excludedResult.rows) {
      excludePairs.add(`${row.album_id_1}::${row.album_id_2}`);
      excludePairs.add(`${row.album_id_2}::${row.album_id_1}`);
    }

    // 5. Detect data integrity issues and find matches for valid albums
    const manualAlbums = [];
    const integrityIssues = [];
    let totalWithMatches = 0;
    const normalizedAlbumGroups = new Map(); // For detecting duplicate manual albums

    for (const manualAlbum of manualItemsResult.rows) {
      const usedIn = usageMap.get(manualAlbum.album_id) || [];

      // DATA INTEGRITY CHECK 1: Orphaned albums (in list_items but not in albums table)
      if (isOrphanedAlbum(manualAlbum)) {
        integrityIssues.push(createOrphanedIssue(manualAlbum, usedIn));
        continue; // Skip matching for orphaned albums
      }

      // DATA INTEGRITY CHECK 2: Missing metadata
      if (hasMissingMetadata(manualAlbum)) {
        integrityIssues.push(createMissingMetadataIssue(manualAlbum, usedIn));
        continue; // Skip matching for albums with missing metadata
      }

      // Track normalized keys to detect duplicate manual albums
      const normalizedKey = normalizeAlbumKey(
        manualAlbum.artist,
        manualAlbum.album
      );
      if (!normalizedAlbumGroups.has(normalizedKey)) {
        normalizedAlbumGroups.set(normalizedKey, []);
      }
      normalizedAlbumGroups.get(normalizedKey).push({
        manualId: manualAlbum.album_id,
        artist: manualAlbum.artist,
        album: manualAlbum.album,
        usedIn,
      });

      // Find potential canonical matches for valid albums
      const matches = findPotentialDuplicates(
        {
          artist: manualAlbum.artist,
          album: manualAlbum.album,
          album_id: manualAlbum.album_id,
        },
        canonicalAlbums,
        {
          threshold,
          maxResults: maxMatchesPerAlbum,
          excludePairs,
        }
      );

      const albumEntry = {
        manualId: manualAlbum.album_id,
        artist: manualAlbum.artist,
        album: manualAlbum.album,
        hasCover: manualAlbum.has_cover,
        usedIn,
        matches: matches.map((m) => ({
          albumId: m.candidate.album_id,
          artist: m.candidate.artist,
          album: m.candidate.album,
          hasCover: m.candidate.hasCover,
          confidence: Math.round(m.confidence * 100),
        })),
      };

      manualAlbums.push(albumEntry);

      if (matches.length > 0) {
        totalWithMatches++;
      }
    }

    // DATA INTEGRITY CHECK 3: Duplicate manual albums with same normalized name
    for (const [normalizedKey, albums] of normalizedAlbumGroups) {
      if (albums.length > 1) {
        // Multiple manual albums with same artist/album name
        integrityIssues.push({
          type: 'duplicate_manual',
          severity: 'low',
          normalizedKey,
          description: `${albums.length} manual albums with same normalized name`,
          duplicates: albums.map((a) => ({
            manualId: a.manualId,
            artist: a.artist,
            album: a.album,
            usedIn: a.usedIn,
          })),
          fixAction: 'merge_manual_albums',
        });
      }
    }

    // Sort manual albums by those with matches first, then by confidence
    manualAlbums.sort((a, b) => {
      if (a.matches.length > 0 && b.matches.length === 0) return -1;
      if (a.matches.length === 0 && b.matches.length > 0) return 1;
      if (a.matches.length > 0 && b.matches.length > 0) {
        return b.matches[0].confidence - a.matches[0].confidence;
      }
      return 0;
    });

    // Sort integrity issues by severity
    const severityOrder = { high: 0, medium: 1, low: 2 };
    integrityIssues.sort(
      (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
    );

    log.info(
      `Found ${manualItemsResult.rows.length} manual albums: ${totalWithMatches} with matches, ${integrityIssues.length} with integrity issues`
    );

    return {
      manualAlbums,
      totalManual: manualItemsResult.rows.length,
      totalWithMatches,
      integrityIssues,
      totalIntegrityIssues: integrityIssues.length,
    };
  }

  /**
   * Merge a manual album into a canonical album
   *
   * Updates all list_items using the manual album_id to use the canonical album_id.
   * Optionally syncs metadata (artist/album names) from the canonical album.
   *
   * @param {string} manualAlbumId - The manual album ID to merge (source)
   * @param {string} canonicalAlbumId - The canonical album ID (target)
   * @param {Object} options - Options
   * @param {boolean} options.syncMetadata - Sync artist/album names from canonical (default: true)
   * @param {string} options.adminUserId - Admin user ID for audit log
   * @returns {Promise<Object>} Result of the merge operation
   */
  async function mergeManualAlbum(
    manualAlbumId,
    canonicalAlbumId,
    options = {}
  ) {
    const { syncMetadata = true, adminUserId = null } = options;

    log.info(`Merging manual album ${manualAlbumId} into ${canonicalAlbumId}`);

    // Validate inputs
    if (!manualAlbumId || !manualAlbumId.startsWith('manual-')) {
      throw new Error('Invalid manual album ID');
    }

    if (!canonicalAlbumId) {
      throw new Error('Canonical album ID is required');
    }

    if (manualAlbumId === canonicalAlbumId) {
      throw new Error('Cannot merge album into itself');
    }

    // Get canonical album metadata
    const canonicalResult = await pool.query(
      `SELECT artist, album FROM albums WHERE album_id = $1`,
      [canonicalAlbumId]
    );

    if (canonicalResult.rows.length === 0) {
      throw new Error(`Canonical album ${canonicalAlbumId} not found`);
    }

    const canonicalAlbum = canonicalResult.rows[0];

    // Find affected lists before merge
    const affectedResult = await pool.query(
      `
      SELECT DISTINCT 
        l._id as list_id,
        l.name as list_name,
        l.year,
        u.username
      FROM list_items li
      JOIN lists l ON li.list_id = l._id
      JOIN users u ON l.user_id = u._id
      WHERE li.album_id = $1
    `,
      [manualAlbumId]
    );

    const affectedLists = affectedResult.rows;
    const affectedYears = [...new Set(affectedLists.map((l) => l.year))];

    // Perform merge in transaction
    let updatedCount = 0;

    await withTransaction(pool, async (client) => {
      // Update list_items to use canonical album_id
      // Note: syncMetadata option is now a no-op since list_items no longer stores
      // album metadata - all metadata comes from the canonical albums table
      const updateResult = await client.query(
        `
        UPDATE list_items
        SET album_id = $1, updated_at = NOW()
        WHERE album_id = $2
      `,
        [canonicalAlbumId, manualAlbumId]
      );
      updatedCount = updateResult.rowCount;

      // Delete manual album from albums table if it exists
      await client.query(`DELETE FROM albums WHERE album_id = $1`, [
        manualAlbumId,
      ]);

      // Log admin event
      await client.query(
        `
        INSERT INTO admin_events (event_type, event_data, created_by)
        VALUES ($1, $2, $3)
      `,
        [
          'manual_album_merged',
          JSON.stringify({
            manualAlbumId,
            canonicalAlbumId,
            canonicalArtist: canonicalAlbum.artist,
            canonicalAlbum: canonicalAlbum.album,
            syncMetadata,
            updatedListItems: updatedCount,
            affectedLists: affectedLists.map((l) => l.list_name),
            affectedYears,
          }),
          adminUserId,
        ]
      );
    });

    log.info(
      `Merged manual album: ${updatedCount} list_items updated, ` +
        `${affectedLists.length} lists affected, years: ${affectedYears.join(', ')}`
    );

    return {
      success: true,
      manualAlbumId,
      canonicalAlbumId,
      updatedListItems: updatedCount,
      affectedLists: affectedLists.map((l) => ({
        listId: l.list_id,
        listName: l.list_name,
        year: l.year,
        username: l.username,
      })),
      affectedYears,
      syncedMetadata: syncMetadata
        ? {
            artist: canonicalAlbum.artist,
            album: canonicalAlbum.album,
          }
        : null,
    };
  }

  /**
   * Delete orphaned album references from list_items.
   * An orphaned reference is a manual-* album_id in list_items that
   * does not exist in the albums table.
   *
   * @param {string} albumId - The orphaned manual album ID to clean up
   * @param {string} adminUserId - Admin user ID for audit log
   * @returns {Promise<Object>} Result with deletedListItems, affectedLists, affectedYears
   */
  async function deleteOrphanedReferences(albumId, adminUserId) {
    if (!albumId || !albumId.startsWith('manual-')) {
      throw new Error('albumId must be a manual album (manual-* prefix)');
    }

    // Verify the album doesn't exist in albums table
    const albumCheck = await pool.query(
      'SELECT album_id FROM albums WHERE album_id = $1',
      [albumId]
    );

    if (albumCheck.rows.length > 0) {
      throw new Error('Album exists in albums table - not orphaned');
    }

    // Get affected lists before deletion
    const affectedResult = await pool.query(
      `
      SELECT DISTINCT
        l._id as list_id,
        l.name as list_name,
        l.year,
        u.username
      FROM list_items li
      JOIN lists l ON li.list_id = l._id
      JOIN users u ON l.user_id = u._id
      WHERE li.album_id = $1
    `,
      [albumId]
    );

    const affectedLists = affectedResult.rows;
    const affectedYears = [...new Set(affectedLists.map((l) => l.year))];

    // Delete the orphaned references
    const deleteResult = await pool.query(
      'DELETE FROM list_items WHERE album_id = $1',
      [albumId]
    );

    const deletedCount = deleteResult.rowCount;

    // Log admin event
    await pool.query(
      `
      INSERT INTO admin_events (event_type, event_data, created_by)
      VALUES ($1, $2, $3)
    `,
      [
        'orphaned_album_deleted',
        JSON.stringify({
          albumId,
          deletedListItems: deletedCount,
          affectedLists: affectedLists.map((l) => l.list_name),
          affectedYears,
        }),
        adminUserId,
      ]
    );

    log.info('Orphaned album references deleted', {
      albumId,
      deletedCount,
      affectedYears,
    });

    return {
      albumId,
      deletedListItems: deletedCount,
      affectedLists: affectedLists.map((l) => ({
        listId: l.list_id,
        listName: l.list_name,
        year: l.year,
        username: l.username,
      })),
      affectedYears,
    };
  }

  return {
    findDuplicates,
    diagnoseNormalization,
    previewFix,
    executeFix,
    getAuditReport,
    findManualAlbumsForReconciliation,
    mergeManualAlbum,
    deleteOrphanedReferences,
    // Export for testing
    normalizeAlbumKey,
    basicNormalizeAlbumKey,
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
  basicNormalizeAlbumKey,
};
