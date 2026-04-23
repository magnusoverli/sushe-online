const { triggerPlaycountRefresh } = require('./item-playcount-refresh');

function buildBatchInsertPayload(itemsToInsert, listId, timestamp) {
  const payload = {
    itemIds: [],
    listIds: [],
    albumIds: [],
    positions: [],
    comments: [],
    comments2: [],
    primaryTracks: [],
    secondaryTracks: [],
    createdAts: [],
    updatedAts: [],
  };

  for (const item of itemsToInsert) {
    payload.itemIds.push(item._id);
    payload.listIds.push(listId);
    payload.albumIds.push(item.album_id);
    payload.positions.push(item.position);
    payload.comments.push(item.comments);
    payload.comments2.push(item.comments_2);
    payload.primaryTracks.push(item.primary_track);
    payload.secondaryTracks.push(item.secondary_track);
    payload.createdAts.push(timestamp);
    payload.updatedAts.push(timestamp);
  }

  return payload;
}

async function insertListItems(ctx, client, listId, albums, timestamp) {
  for (let i = 0; i < albums.length; i++) {
    const album = albums[i];
    const albumId = await ctx.upsertAlbumRecord(album, timestamp, client);
    const itemId = ctx.crypto.randomBytes(12).toString('hex');

    await client.query(
      `INSERT INTO list_items (
        _id, list_id, album_id, position, comments, comments_2, primary_track, secondary_track, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        itemId,
        listId,
        albumId,
        i + 1,
        album.comments || null,
        album.comments_2 || null,
        album.primary_track || null,
        album.secondary_track || null,
        timestamp,
        timestamp,
      ]
    );
  }
}

async function processRemovals(client, listId, removed) {
  if (!removed || !Array.isArray(removed)) return 0;
  const validIds = removed.filter(Boolean);
  if (validIds.length === 0) return 0;

  const result = await client.query(
    'DELETE FROM list_items WHERE list_id = $1 AND album_id = ANY($2::text[])',
    [listId, validIds]
  );
  return result.rowCount;
}

function mapItemToInsertRecord(
  ctx,
  duplicateSet,
  upsertResults,
  item,
  nextPositionRef
) {
  const key = `${item.artist}|${item.album}`;
  const upsertResult = upsertResults.get(key);

  if (!upsertResult) {
    ctx.logger?.warn('Album not found in upsert results', {
      artist: item.artist,
      album: item.album,
    });
    return { duplicate: null, insertRecord: null, addedItem: null };
  }

  if (duplicateSet.has(upsertResult.albumId)) {
    return {
      duplicate: {
        album_id: upsertResult.albumId,
        artist: item.artist || '',
        album: item.album || '',
      },
      insertRecord: null,
      addedItem: null,
    };
  }

  const itemId = ctx.crypto.randomBytes(12).toString('hex');
  const position =
    item.position !== undefined && item.position !== null
      ? item.position
      : nextPositionRef.value++;

  return {
    duplicate: null,
    insertRecord: {
      _id: itemId,
      album_id: upsertResult.albumId,
      position,
      comments: item.comments || null,
      comments_2: item.comments_2 || null,
      primary_track: item.primary_track || null,
      secondary_track: item.secondary_track || null,
    },
    addedItem: { album_id: upsertResult.albumId, _id: itemId },
  };
}

async function processAdditions(ctx, client, list, added, timestamp) {
  const result = {
    addedItems: [],
    duplicateAlbums: [],
    changeCount: 0,
  };

  if (!added || !Array.isArray(added) || added.length === 0) {
    return result;
  }

  const maxPosResult = await client.query(
    'SELECT COALESCE(MAX(position), 0) as max_pos FROM list_items WHERE list_id = $1',
    [list._id]
  );
  const nextPositionRef = { value: maxPosResult.rows[0].max_pos + 1 };

  const validItems = added.filter((item) => item);
  if (validItems.length === 0) return result;

  const upsertResults = await ctx.batchUpsertAlbumRecords(
    validItems,
    timestamp,
    client
  );
  const albumIds = Array.from(upsertResults.values()).map(
    (item) => item.albumId
  );

  const duplicateCheck = await client.query(
    `SELECT album_id, _id FROM list_items
     WHERE list_id = $1 AND album_id = ANY($2::text[])`,
    [list._id, albumIds]
  );
  const duplicateSet = new Set(duplicateCheck.rows.map((row) => row.album_id));

  const itemsToInsert = [];
  for (const item of validItems) {
    const mapped = mapItemToInsertRecord(
      ctx,
      duplicateSet,
      upsertResults,
      item,
      nextPositionRef
    );

    if (mapped.duplicate) result.duplicateAlbums.push(mapped.duplicate);
    if (mapped.insertRecord) itemsToInsert.push(mapped.insertRecord);
    if (mapped.addedItem) result.addedItems.push(mapped.addedItem);
  }

  if (itemsToInsert.length === 0) return result;

  const payload = buildBatchInsertPayload(itemsToInsert, list._id, timestamp);
  await client.query(
    `INSERT INTO list_items (
      _id, list_id, album_id, position, comments, comments_2, primary_track, secondary_track,
      created_at, updated_at
    )
    SELECT * FROM UNNEST(
      $1::text[], $2::text[], $3::text[], $4::int[], $5::text[], $6::text[],
      $7::text[], $8::text[], $9::timestamptz[], $10::timestamptz[]
    ) AS t(_id, list_id, album_id, position, comments, comments_2, primary_track, secondary_track, created_at, updated_at)`,
    [
      payload.itemIds,
      payload.listIds,
      payload.albumIds,
      payload.positions,
      payload.comments,
      payload.comments2,
      payload.primaryTracks,
      payload.secondaryTracks,
      payload.createdAts,
      payload.updatedAts,
    ]
  );

  result.changeCount = itemsToInsert.length;
  ctx.logger?.debug('Batch insert list items', {
    listId: list._id,
    count: itemsToInsert.length,
  });
  return result;
}

async function processPositionUpdates(client, listId, updated, timestamp) {
  if (!updated || !Array.isArray(updated)) return 0;
  const validItems = updated.filter((item) => item && item.album_id);
  if (validItems.length === 0) return 0;

  const albumIds = validItems.map((item) => item.album_id);
  const positions = validItems.map((item) => item.position);
  const result = await client.query(
    `UPDATE list_items SET position = t.position, updated_at = $1
     FROM UNNEST($2::text[], $3::int[]) AS t(album_id, position)
     WHERE list_items.list_id = $4 AND list_items.album_id = t.album_id`,
    [timestamp, albumIds, positions, listId]
  );
  return result.rowCount;
}

function createListItemOperations(deps = {}) {
  const context = {
    db: deps.db,
    crypto: deps.crypto,
    upsertAlbumRecord: deps.upsertAlbumRecord,
    batchUpsertAlbumRecords: deps.batchUpsertAlbumRecords,
    refreshPlaycountsInBackground: deps.refreshPlaycountsInBackground,
    logger: deps.logger,
  };

  if (!context.db) throw new Error('db is required');
  if (!context.crypto) throw new Error('crypto is required');
  if (typeof context.upsertAlbumRecord !== 'function') {
    throw new Error('upsertAlbumRecord is required');
  }
  if (typeof context.batchUpsertAlbumRecords !== 'function') {
    throw new Error('batchUpsertAlbumRecords is required');
  }

  return {
    insertListItems: (client, listId, albums, timestamp) =>
      insertListItems(context, client, listId, albums, timestamp),
    processRemovals,
    processAdditions: (client, list, added, timestamp) =>
      processAdditions(context, client, list, added, timestamp),
    processPositionUpdates,
    triggerPlaycountRefresh: (user, addedItems) =>
      triggerPlaycountRefresh(context, user, addedItems),
  };
}

module.exports = {
  createListItemOperations,
};
