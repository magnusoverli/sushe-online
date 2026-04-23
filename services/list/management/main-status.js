async function toggleMainStatus(ctx, listId, userId, isMain) {
  return ctx.db.withTransaction(async (client) => {
    const listResult = await client.query(
      `SELECT l.id, l._id, l.name, l.year, l.is_main, g.year as group_year
       FROM lists l
       LEFT JOIN list_groups g ON l.group_id = g.id
       WHERE l._id = $1 AND l.user_id = $2
       FOR UPDATE OF l`,
      [listId, userId]
    );

    if (listResult.rows.length === 0) {
      throw new ctx.TransactionAbort(404, { error: 'List not found' });
    }

    const list = listResult.rows[0];
    const listYear = list.year || list.group_year;

    if (listYear) {
      await ctx.acquireYearLocks(client, [listYear]);
    }

    try {
      await ctx.validateYearNotLocked(client, listYear, 'change main status');
    } catch (lockErr) {
      throw new ctx.TransactionAbort(403, {
        error: lockErr.body?.error || lockErr.message,
        yearLocked: true,
        year: listYear,
      });
    }

    if (isMain === false) {
      await client.query(
        `UPDATE lists SET is_main = FALSE, updated_at = NOW() WHERE id = $1`,
        [list.id]
      );
      return { list, year: listYear, isRemoval: true };
    }

    if (!listYear) {
      throw new ctx.TransactionAbort(400, {
        error: 'List must be assigned to a year to be marked as main',
      });
    }

    const previousMainResult = await client.query(
      `SELECT l._id, l.name FROM lists l
       LEFT JOIN list_groups g ON l.group_id = g.id
       WHERE l.user_id = $1
         AND (l.year = $2 OR g.year = $2)
         AND l.is_main = TRUE
         AND l._id != $3`,
      [userId, listYear, listId]
    );

    await client.query(
      `UPDATE lists SET is_main = FALSE, updated_at = NOW()
       WHERE user_id = $1
         AND id IN (
           SELECT l.id FROM lists l
           LEFT JOIN list_groups g ON l.group_id = g.id
           WHERE l.user_id = $1 AND (l.year = $2 OR g.year = $2)
         )`,
      [userId, listYear]
    );

    await client.query(
      `UPDATE lists SET is_main = TRUE, updated_at = NOW() WHERE id = $1`,
      [list.id]
    );

    return {
      list,
      year: listYear,
      isRemoval: false,
      previousMainResult: previousMainResult.rows,
    };
  });
}

async function deleteList(ctx, listId, userId) {
  return ctx.db.withTransaction(async (client) => {
    const listResult = await client.query(
      `SELECT id, _id, name, year, group_id, is_main
       FROM lists
       WHERE _id = $1 AND user_id = $2
       FOR UPDATE`,
      [listId, userId]
    );

    if (listResult.rows.length === 0) {
      throw new ctx.TransactionAbort(404, { error: 'List not found' });
    }

    const foundList = listResult.rows[0];

    if (foundList.is_main) {
      throw new ctx.TransactionAbort(403, {
        error: 'Cannot delete main list. Unset main status first.',
      });
    }

    await client.query('DELETE FROM list_items WHERE list_id = $1', [
      foundList._id,
    ]);
    await client.query('DELETE FROM lists WHERE id = $1', [foundList.id]);
    await ctx.deleteGroupIfEmptyAutoGroup(client, foundList.group_id);

    return foundList;
  });
}

module.exports = {
  toggleMainStatus,
  deleteList,
};
