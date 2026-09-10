const { checkDuplicateListName } = require('./check-duplicate-list-name');
const { withListTransaction } = require('../transaction');

async function destinationFields(ctx, client, userId, list, target) {
  const { groupId, year, name } = target;
  const fields = [];
  if (groupId !== list.group_id) {
    const order = await client.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM lists WHERE group_id = $1',
      [groupId]
    );
    fields.push({ column: 'sort_order', value: order.rows[0].next_order });
    await checkDuplicateListName(
      client,
      ctx.TransactionAbort,
      userId,
      name,
      groupId,
      list._id
    );
  }
  if (list.is_main && year === null)
    fields.push({ column: 'is_main', value: false });
  if (list.is_main && year && year !== (list.year || list.group_year)) {
    const existing = await client.query(
      'SELECT _id FROM lists WHERE user_id = $1 AND year = $2 AND is_main = TRUE AND _id <> $3',
      [userId, year, list._id]
    );
    if (existing.rows.length)
      throw new ctx.TransactionAbort(409, {
        error: 'Destination year already has a main list',
      });
  }
  return fields;
}

async function updateListMetadata(ctx, listId, userId, updates) {
  const { name: newName, year, groupId: newGroupId } = updates;
  if (
    newName !== undefined &&
    (typeof newName !== 'string' || !newName.trim())
  ) {
    throw new ctx.TransactionAbort(400, { error: 'List name cannot be empty' });
  }

  return withListTransaction(ctx.db, userId, async (client) => {
    const listResult = await client.query(
      `SELECT l.id, l._id, l.name, l.year, l.group_id, l.is_main, g.year as group_year
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
      targetGroupId =
        targetYear === null
          ? await ctx.findOrCreateUncategorizedGroup(client, userId)
          : (await ctx.findOrCreateYearGroup(client, userId, targetYear))
              .groupId;
      fields.push({ column: 'group_id', value: targetGroupId });
    }

    const currentYear = list.year || list.group_year;
    if (list.is_main) {
      await ctx.acquireYearLocks(client, [currentYear, targetYear]);
    }

    try {
      await ctx.validateMainListNotLocked(
        client,
        currentYear,
        list.is_main,
        'update list'
      );
      if (targetYear !== currentYear) {
        await ctx.validateMainListNotLocked(
          client,
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

    fields.push(
      ...(await destinationFields(ctx, client, userId, list, {
        groupId: targetGroupId,
        year: targetYear,
        name: newName?.trim() || list.name,
      }))
    );

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
    if (targetGroupId !== list.group_id)
      await ctx.deleteGroupIfEmptyAutoGroup(client, list.group_id);

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
