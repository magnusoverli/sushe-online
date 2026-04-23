const { ensureDb } = require('../../db/postgres');

function basicNormalizeAlbumKey(artist, album) {
  const normalizedArtist = String(artist || '')
    .toLowerCase()
    .trim();
  const normalizedAlbum = String(album || '')
    .toLowerCase()
    .trim();
  return `${normalizedArtist}::${normalizedAlbum}`;
}

async function applyFixTransaction(ctx, year, preview) {
  const { db, log } = ctx;
  let totalUpdated = 0;

  await db.withTransaction(async (client) => {
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

async function findDuplicates(ctx, year) {
  const { db, log, normalizeAlbumKey } = ctx;
  log.info(`Running aggregate audit for year ${year}`);

  const result = await db.raw(
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
    [year],
    { name: 'aggregate-audit-find-duplicates', retryable: true }
  );

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

async function diagnoseNormalization(ctx, year) {
  const { db, log, normalizeAlbumKey } = ctx;
  log.info(`Running normalization diagnostic for year ${year}`);

  const result = await db.raw(
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
    [year],
    { name: 'aggregate-audit-diagnose-normalization', retryable: true }
  );

  const basicGroups = new Map();
  const sophisticatedGroups = new Map();

  for (const item of result.rows) {
    const basicKey = basicNormalizeAlbumKey(item.artist, item.album);
    const sophisticatedKey = normalizeAlbumKey(item.artist, item.album);

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

  const missedByBasic = [];
  for (const [sophKey, sophGroup] of sophisticatedGroups) {
    if (sophGroup.basicKeys.size > 1) {
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

  const albumsWithMultipleVoters = [];
  for (const [_sophKey, sophGroup] of sophisticatedGroups) {
    if (sophGroup.entries.length > 1) {
      const uniqueVoters = new Set(
        sophGroup.entries.map((entry) => entry.username)
      ).size;
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
          (album) => album.voterCount >= 3
        ).length,
        appearsOn5PlusLists: albumsWithMultipleVoters.filter(
          (album) => album.voterCount >= 5
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

async function previewFix(ctx, year) {
  const { log, selectCanonicalAlbumId } = ctx;
  log.info(`Generating fix preview for year ${year}`);

  const auditResult = await findDuplicates(ctx, year);

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
    const canonicalId = selectCanonicalAlbumId(duplicate.albumIds);
    const entriesToUpdate = duplicate.entries.filter(
      (entry) => entry.albumId !== canonicalId && entry.albumId !== null
    );

    if (entriesToUpdate.length > 0) {
      changes.push({
        artist: duplicate.artist,
        album: duplicate.album,
        canonicalAlbumId: canonicalId,
        currentAlbumIds: duplicate.albumIds,
        affectedEntries: entriesToUpdate.map((entry) => ({
          currentAlbumId: entry.albumId,
          username: entry.username,
          position: entry.position,
        })),
      });
    }
  }

  return {
    year,
    previewedAt: new Date().toISOString(),
    changesRequired: changes.length > 0,
    totalChanges: changes.reduce((sum, change) => {
      return sum + change.affectedEntries.length;
    }, 0),
    changes,
  };
}

async function executeFix(ctx, year, dryRun = false) {
  const { log } = ctx;
  log.info(`Executing aggregate fix for year ${year} (dryRun: ${dryRun})`);

  const preview = await previewFix(ctx, year);

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

  return applyFixTransaction(ctx, year, preview);
}

async function getAuditReport(ctx, year) {
  const duplicates = await findDuplicates(ctx, year);
  const preview = await previewFix(ctx, year);

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

function createDuplicateAuditService(deps = {}) {
  const db = ensureDb(deps.db, 'duplicate-audit');

  const context = {
    db,
    log: deps.log,
    normalizeAlbumKey: deps.normalizeAlbumKey,
    selectCanonicalAlbumId: deps.selectCanonicalAlbumId,
  };

  return {
    diagnoseNormalization: (year) => diagnoseNormalization(context, year),
    executeFix: (year, dryRun = false) => executeFix(context, year, dryRun),
    findDuplicates: (year) => findDuplicates(context, year),
    getAuditReport: (year) => getAuditReport(context, year),
    previewFix: (year) => previewFix(context, year),
  };
}

module.exports = {
  basicNormalizeAlbumKey,
  createDuplicateAuditService,
};
