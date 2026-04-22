function isOrphanedAlbum(album) {
  return album.artist === null && album.album === null && !album.has_cover;
}

function hasMissingMetadata(album) {
  return (
    !album.artist ||
    album.artist.trim() === '' ||
    !album.album ||
    album.album.trim() === ''
  );
}

function createOrphanedIssue(album, usedIn) {
  return {
    type: 'orphaned',
    severity: 'high',
    manualId: album.album_id,
    artist: null,
    album: null,
    description: 'Album referenced in lists but does not exist in albums table',
    usedIn,
    fixAction: 'delete_references',
  };
}

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

async function loadManualReconciliationData(db) {
  const manualItemsResult = await db.raw(`
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

  const usageResult = await db.raw(`
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

  const canonicalResult = await db.raw(`
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

  const excludedResult = await db.raw(`
    SELECT album_id_1, album_id_2 FROM album_distinct_pairs
  `);

  return {
    manualItems: manualItemsResult.rows,
    usageRows: usageResult.rows,
    canonicalRows: canonicalResult.rows,
    excludedRows: excludedResult.rows,
  };
}

function buildUsageMap(usageRows) {
  const usageMap = new Map();

  for (const row of usageRows) {
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

  return usageMap;
}

function buildCanonicalAlbums(canonicalRows) {
  return canonicalRows.map((row) => ({
    album_id: row.album_id,
    artist: row.artist,
    album: row.album,
    hasCover: row.has_cover,
  }));
}

function buildExcludePairs(excludedRows) {
  const excludePairs = new Set();
  for (const row of excludedRows) {
    excludePairs.add(`${row.album_id_1}::${row.album_id_2}`);
    excludePairs.add(`${row.album_id_2}::${row.album_id_1}`);
  }
  return excludePairs;
}

function addDuplicateManualIssues(normalizedAlbumGroups, integrityIssues) {
  for (const [normalizedKey, albums] of normalizedAlbumGroups) {
    if (albums.length > 1) {
      integrityIssues.push({
        type: 'duplicate_manual',
        severity: 'low',
        normalizedKey,
        description: `${albums.length} manual albums with same normalized name`,
        duplicates: albums.map((album) => ({
          manualId: album.manualId,
          artist: album.artist,
          album: album.album,
          usedIn: album.usedIn,
        })),
        fixAction: 'merge_manual_albums',
      });
    }
  }
}

function sortManualAlbumsAndIssues(manualAlbums, integrityIssues) {
  manualAlbums.sort((a, b) => {
    if (a.matches.length > 0 && b.matches.length === 0) return -1;
    if (a.matches.length === 0 && b.matches.length > 0) return 1;
    if (a.matches.length > 0 && b.matches.length > 0) {
      return b.matches[0].confidence - a.matches[0].confidence;
    }
    return 0;
  });

  const severityOrder = { high: 0, medium: 1, low: 2 };
  integrityIssues.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );
}

function buildManualAlbumEntry(manualAlbum, usedIn, matches) {
  return {
    manualId: manualAlbum.album_id,
    artist: manualAlbum.artist,
    album: manualAlbum.album,
    hasCover: manualAlbum.has_cover,
    usedIn,
    matches: matches.map((match) => ({
      albumId: match.candidate.album_id,
      artist: match.candidate.artist,
      album: match.candidate.album,
      hasCover: match.candidate.hasCover,
      confidence: Math.round(match.confidence * 100),
    })),
  };
}

async function findManualAlbumsForReconciliation(ctx, options = {}) {
  const { db, log, normalizeAlbumKey, findPotentialDuplicates } = ctx;
  const { threshold = 0.15, maxMatchesPerAlbum = 5 } = options;

  log.info('Finding manual albums for reconciliation');

  const { manualItems, usageRows, canonicalRows, excludedRows } =
    await loadManualReconciliationData(db);

  if (manualItems.length === 0) {
    log.info('No manual albums found');
    return {
      manualAlbums: [],
      totalManual: 0,
      totalWithMatches: 0,
      integrityIssues: [],
      totalIntegrityIssues: 0,
    };
  }

  const usageMap = buildUsageMap(usageRows);
  const canonicalAlbums = buildCanonicalAlbums(canonicalRows);
  const excludePairs = buildExcludePairs(excludedRows);

  const manualAlbums = [];
  const integrityIssues = [];
  const normalizedAlbumGroups = new Map();
  let totalWithMatches = 0;

  for (const manualAlbum of manualItems) {
    const usedIn = usageMap.get(manualAlbum.album_id) || [];

    if (isOrphanedAlbum(manualAlbum)) {
      integrityIssues.push(createOrphanedIssue(manualAlbum, usedIn));
      continue;
    }

    if (hasMissingMetadata(manualAlbum)) {
      integrityIssues.push(createMissingMetadataIssue(manualAlbum, usedIn));
      continue;
    }

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

    manualAlbums.push(buildManualAlbumEntry(manualAlbum, usedIn, matches));
    if (matches.length > 0) {
      totalWithMatches++;
    }
  }

  addDuplicateManualIssues(normalizedAlbumGroups, integrityIssues);
  sortManualAlbumsAndIssues(manualAlbums, integrityIssues);

  log.info(
    `Found ${manualItems.length} manual albums: ${totalWithMatches} with matches, ${integrityIssues.length} with integrity issues`
  );

  return {
    manualAlbums,
    totalManual: manualItems.length,
    totalWithMatches,
    integrityIssues,
    totalIntegrityIssues: integrityIssues.length,
  };
}

async function mergeManualAlbum(
  ctx,
  manualAlbumId,
  canonicalAlbumId,
  options = {}
) {
  const { db, log, duplicateService } = ctx;
  const { syncMetadata = true, adminUserId = null } = options;

  log.info(`Merging manual album ${manualAlbumId} into ${canonicalAlbumId}`);

  if (!manualAlbumId || !manualAlbumId.startsWith('manual-')) {
    throw new Error('Invalid manual album ID');
  }
  if (!canonicalAlbumId) {
    throw new Error('Canonical album ID is required');
  }
  if (manualAlbumId === canonicalAlbumId) {
    throw new Error('Cannot merge album into itself');
  }
  if (!duplicateService || typeof duplicateService.mergeAlbums !== 'function') {
    throw new Error('duplicateService.mergeAlbums is required');
  }

  const canonicalResult = await db.raw(
    `SELECT artist, album FROM albums WHERE album_id = $1`,
    [canonicalAlbumId]
  );

  if (canonicalResult.rows.length === 0) {
    throw new Error(`Canonical album ${canonicalAlbumId} not found`);
  }

  const canonicalAlbum = canonicalResult.rows[0];

  const affectedResult = await db.raw(
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
  const affectedYears = [...new Set(affectedLists.map((list) => list.year))];

  const mergeResult = await duplicateService.mergeAlbums(
    canonicalAlbumId,
    manualAlbumId,
    {
      mergeMetadata: syncMetadata,
    }
  );

  const updatedCount = mergeResult.listItemsUpdated || 0;

  try {
    await db.raw(
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
          affectedLists: affectedLists.map((list) => list.list_name),
          affectedYears,
          mergeResult,
        }),
        adminUserId,
      ]
    );
  } catch (error) {
    log.warn('Manual merge completed but admin event insert failed', {
      error: error.message,
      manualAlbumId,
      canonicalAlbumId,
    });
  }

  log.info(
    `Merged manual album: ${updatedCount} list_items updated, ` +
      `${affectedLists.length} lists affected, years: ${affectedYears.join(', ')}`
  );

  return {
    success: true,
    manualAlbumId,
    canonicalAlbumId,
    updatedListItems: updatedCount,
    affectedLists: affectedLists.map((list) => ({
      listId: list.list_id,
      listName: list.list_name,
      year: list.year,
      username: list.username,
    })),
    affectedYears,
    syncedMetadata: syncMetadata
      ? {
          artist: canonicalAlbum.artist,
          album: canonicalAlbum.album,
        }
      : null,
    mergeResult,
  };
}

async function deleteOrphanedReferences(ctx, albumId, adminUserId) {
  const { db, log } = ctx;

  if (!albumId || !albumId.startsWith('manual-')) {
    throw new Error('albumId must be a manual album (manual-* prefix)');
  }

  const albumCheck = await db.raw(
    'SELECT album_id FROM albums WHERE album_id = $1',
    [albumId]
  );
  if (albumCheck.rows.length > 0) {
    throw new Error('Album exists in albums table - not orphaned');
  }

  const affectedResult = await db.raw(
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
  const affectedYears = [...new Set(affectedLists.map((list) => list.year))];

  const deleteResult = await db.raw(
    'DELETE FROM list_items WHERE album_id = $1',
    [albumId]
  );
  const deletedCount = deleteResult.rowCount;

  await db.raw(
    `
    INSERT INTO admin_events (event_type, event_data, created_by)
    VALUES ($1, $2, $3)
  `,
    [
      'orphaned_album_deleted',
      JSON.stringify({
        albumId,
        deletedListItems: deletedCount,
        affectedLists: affectedLists.map((list) => list.list_name),
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
    affectedLists: affectedLists.map((list) => ({
      listId: list.list_id,
      listName: list.list_name,
      year: list.year,
      username: list.username,
    })),
    affectedYears,
  };
}

function createManualReconciliationService(deps = {}) {
  // Accept either a datastore or a legacy pool (adapted to the .raw API).
  let db = deps.db;
  if (!db && deps.pool) {
    db = { raw: (sql, params) => deps.pool.query(sql, params) };
  }

  const context = {
    db,
    log: deps.log,
    normalizeAlbumKey: deps.normalizeAlbumKey,
    findPotentialDuplicates: deps.findPotentialDuplicates,
    duplicateService: deps.duplicateService,
  };

  return {
    deleteOrphanedReferences: (albumId, adminUserId) => {
      return deleteOrphanedReferences(context, albumId, adminUserId);
    },
    findManualAlbumsForReconciliation: (options = {}) => {
      return findManualAlbumsForReconciliation(context, options);
    },
    mergeManualAlbum: (manualAlbumId, canonicalAlbumId, options = {}) => {
      return mergeManualAlbum(
        context,
        manualAlbumId,
        canonicalAlbumId,
        options
      );
    },
  };
}

module.exports = {
  createManualReconciliationService,
};
