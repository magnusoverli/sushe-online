async function reorderItems(ctx, listId, userId, order) {
  if (!Array.isArray(order)) {
    throw new ctx.TransactionAbort(400, { error: 'Invalid order array' });
  }

  let effectivePos = 0;
  let list;

  await ctx.db.withTransaction(async (client) => {
    list = await ctx.findListByIdOrThrow(
      listId,
      userId,
      'reorder list items',
      client
    );

    const now = new Date();

    const listItemsResult = await client.query(
      'SELECT _id, album_id FROM list_items WHERE list_id = $1',
      [list._id]
    );
    const listItems = listItemsResult.rows;

    if (listItems.length === 0) {
      if (order.length > 0) {
        throw new ctx.TransactionAbort(400, {
          error: 'Order must be empty for a list with no items',
        });
      }
      effectivePos = 0;
      return;
    }

    const itemIdsByAlbumId = new Map();
    for (const item of listItems) {
      if (item.album_id) {
        itemIdsByAlbumId.set(item.album_id, item._id);
      }
    }

    const orderedItemIds = [];
    for (const entry of order) {
      if (typeof entry === 'string') {
        const resolvedItemId = itemIdsByAlbumId.get(entry);
        if (!resolvedItemId) {
          throw new ctx.TransactionAbort(400, {
            error: `Album '${entry}' is not in this list`,
          });
        }
        orderedItemIds.push(resolvedItemId);
        continue;
      }

      throw new ctx.TransactionAbort(400, {
        error: 'Order contains invalid entries',
      });
    }

    if (new Set(orderedItemIds).size !== orderedItemIds.length) {
      throw new ctx.TransactionAbort(400, {
        error: 'Order cannot contain duplicate entries',
      });
    }

    if (orderedItemIds.length !== listItems.length) {
      throw new ctx.TransactionAbort(400, {
        error: 'Order must include all list items exactly once',
      });
    }

    const positionValues = orderedItemIds.map((_, index) => index + 1);
    await client.query(
      `UPDATE list_items
       SET position = t.position, updated_at = $1
       FROM UNNEST($2::text[], $3::int[]) AS t(item_id, position)
       WHERE list_items._id = t.item_id AND list_items.list_id = $4`,
      [now, orderedItemIds, positionValues, list._id]
    );

    effectivePos = orderedItemIds.length;
  });

  ctx.logger?.info('List reordered', {
    userId,
    listId,
    listName: list.name,
    itemCount: effectivePos,
  });

  return { list, itemCount: effectivePos };
}

module.exports = {
  reorderItems,
};
