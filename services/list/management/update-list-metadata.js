const { checkDuplicateListName } = require('./check-duplicate-list-name');

async function updateListMetadata(ctx, listId, userId, updates) {
  const { name: newName, year, groupId: newGroupId } = updates;

  return ctx.db.withTransaction(async (client) => {
    const listResult = await client.query(
      `SELECT l.id, l._id, l.name, l.year, l.group_id, l.is_main, g.year as group_year
       FROM lists l
       LEFT JOIN list_groups g ON l.group_id = g.id
       WHERE l._id = $1 AND l.user_id = $2`,
      [listId, userId]
    );

    if (listResult.rows.length === 0) {
      throw new ctx.TransactionAbort(404, { error: 'List not found' });
    }

    const list = listResult.rows[0];
    const fields = [];
    let targetGroupId = list.group_id;
    let targetYear = list.year;

    if (newGroupId !== undefined) {
      if (newGroupId === null) {
        throw new ctx.TransactionAbort(400, {
          error: 'Lists must belong to a category',
        });
      }

      const groupResult = await client.query(
        `SELECT id, year FROM list_groups WHERE _id = $1 AND user_id = $2`,
        [newGroupId, userId]
      );

      if (groupResult.rows.length === 0) {
        throw new ctx.TransactionAbort(400, { error: 'Invalid group' });
      }

      targetGroupId = groupResult.rows[0].id;
      targetYear = groupResult.rows[0].year;
      fields.push({ column: 'group_id', value: targetGroupId });
      fields.push({ column: 'year', value: targetYear });
    } else if (year !== undefined) {
      const yearValidation = ctx.validateYear(year);
      if (year !== null && !yearValidation.valid) {
        throw new ctx.TransactionAbort(400, { error: yearValidation.error });
      }
      targetYear = year === null ? null : yearValidation.value;
      fields.push({ column: 'year', value: targetYear });
    }

    try {
      await ctx.validateMainListNotLocked(
        ctx.db,
        list.year,
        list.is_main,
        'update list'
      );
      if (targetYear !== list.year) {
        await ctx.validateMainListNotLocked(
          ctx.db,
          targetYear,
          list.is_main,
          'update list'
        );
      }
    } catch (lockErr) {
      throw new ctx.TransactionAbort(403, {
        error: lockErr.body?.error || lockErr.message,
        yearLocked: true,
      });
    }

    if (newName !== undefined) {
      if (typeof newName !== 'string' || newName.trim().length === 0) {
        throw new ctx.TransactionAbort(400, {
          error: 'List name cannot be empty',
        });
      }

      const trimmedName = newName.trim();
      if (trimmedName !== list.name) {
        await checkDuplicateListName(
          client,
          ctx.TransactionAbort,
          userId,
          trimmedName,
          targetGroupId,
          listId
        );
      }

      fields.push({ column: 'name', value: trimmedName });
    }

    if (fields.length === 0) {
      throw new ctx.TransactionAbort(400, { error: 'No updates provided' });
    }

    const update = ctx.buildPartialUpdate('lists', 'id', list.id, fields);
    await client.query(update.query, update.values);

    return {
      list: {
        _id: list._id,
        name: list.name,
        year: list.year,
        is_main: list.is_main,
      },
      targetYear,
    };
  });
}

module.exports = {
  updateListMetadata,
};
