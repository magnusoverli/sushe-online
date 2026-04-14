async function checkDuplicateListName(
  client,
  TransactionAbort,
  userId,
  name,
  groupId,
  excludeListId
) {
  const params = [userId, name, groupId];
  let query =
    'SELECT 1 FROM lists WHERE user_id = $1 AND name = $2 AND group_id = $3';

  if (excludeListId) {
    query += ' AND _id != $4';
    params.push(excludeListId);
  }

  const duplicateCheck = await client.query(query, params);
  if (duplicateCheck.rows.length > 0) {
    throw new TransactionAbort(409, {
      error: 'A list with this name already exists in this category',
    });
  }
}

async function bulkUpdate(ctx, userId, updates) {
  const results = [];
  const yearsToRecompute = new Set();

  await ctx.withTransaction(ctx.pool, async (client) => {
    for (const update of updates) {
      const { listId, year, isMain: updateIsMain } = update;

      if (!listId) {
        results.push({ listId, success: false, error: 'Missing listId' });
        continue;
      }

      const listCheck = await client.query(
        'SELECT _id, year, is_main FROM lists WHERE _id = $1 AND user_id = $2',
        [listId, userId]
      );

      if (listCheck.rows.length === 0) {
        results.push({ listId, success: false, error: 'List not found' });
        continue;
      }

      const oldList = listCheck.rows[0];
      const oldYear = oldList.year;
      const newYear = year !== undefined ? year : oldList.year;
      const newIsMain =
        updateIsMain !== undefined ? updateIsMain : oldList.is_main;

      if (newYear !== null && (newYear < 1000 || newYear > 9999)) {
        results.push({ listId, success: false, error: 'Invalid year' });
        continue;
      }

      const effectiveYear = newYear || oldYear;
      if (effectiveYear) {
        const yearLocked = await ctx.isYearLocked(ctx.pool, effectiveYear);
        if (yearLocked) {
          if (updateIsMain !== undefined && updateIsMain !== oldList.is_main) {
            results.push({
              listId,
              success: false,
              error: `Cannot change main status: Year ${effectiveYear} is locked`,
            });
            continue;
          }
          if (oldList.is_main) {
            results.push({
              listId,
              success: false,
              error: `Cannot update main list: Year ${effectiveYear} is locked`,
            });
            continue;
          }
        }
      }

      if (newIsMain && newYear !== null) {
        await client.query(
          `UPDATE lists SET is_main = FALSE, updated_at = NOW()
           WHERE user_id = $1 AND year = $2 AND is_main = TRUE AND _id != $3`,
          [userId, newYear, listId]
        );
      }

      await client.query(
        `UPDATE lists SET year = $1, is_main = $2, updated_at = NOW() WHERE _id = $3`,
        [newYear, newIsMain, listId]
      );

      results.push({ listId, success: true });
      if (oldYear !== null) yearsToRecompute.add(oldYear);
      if (newYear !== null && newIsMain) yearsToRecompute.add(newYear);
    }
  });

  return { results, yearsToRecompute };
}

async function updateListMetadata(ctx, listId, userId, updates) {
  const { name: newName, year, groupId: newGroupId } = updates;

  return ctx.withTransaction(ctx.pool, async (client) => {
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
        ctx.pool,
        list.year,
        list.is_main,
        'update list'
      );
      if (targetYear !== list.year) {
        await ctx.validateMainListNotLocked(
          ctx.pool,
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

async function toggleMainStatus(ctx, listId, userId, isMain) {
  return ctx.withTransaction(ctx.pool, async (client) => {
    const listResult = await client.query(
      `SELECT l.id, l._id, l.name, l.year, l.is_main, g.year as group_year
       FROM lists l
       LEFT JOIN list_groups g ON l.group_id = g.id
       WHERE l._id = $1 AND l.user_id = $2`,
      [listId, userId]
    );

    if (listResult.rows.length === 0) {
      throw new ctx.TransactionAbort(404, { error: 'List not found' });
    }

    const list = listResult.rows[0];
    const listYear = list.year || list.group_year;

    try {
      await ctx.validateYearNotLocked(ctx.pool, listYear, 'change main status');
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
  return ctx.withTransaction(ctx.pool, async (client) => {
    const listResult = await client.query(
      `SELECT id, _id, name, year, group_id, is_main FROM lists WHERE _id = $1 AND user_id = $2`,
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

function createListManagementOperations(deps = {}) {
  const ctx = {
    pool: deps.pool,
    withTransaction: deps.withTransaction,
    TransactionAbort: deps.TransactionAbort,
    validateYear: deps.validateYear,
    validateMainListNotLocked: deps.validateMainListNotLocked,
    validateYearNotLocked: deps.validateYearNotLocked,
    isYearLocked: deps.isYearLocked,
    buildPartialUpdate: deps.buildPartialUpdate,
    deleteGroupIfEmptyAutoGroup: deps.deleteGroupIfEmptyAutoGroup,
  };

  if (!ctx.pool) throw new Error('pool is required');
  if (typeof ctx.withTransaction !== 'function') {
    throw new Error('withTransaction is required');
  }
  if (!ctx.TransactionAbort) throw new Error('TransactionAbort is required');
  if (typeof ctx.validateYear !== 'function') {
    throw new Error('validateYear is required');
  }
  if (typeof ctx.validateMainListNotLocked !== 'function') {
    throw new Error('validateMainListNotLocked is required');
  }
  if (typeof ctx.validateYearNotLocked !== 'function') {
    throw new Error('validateYearNotLocked is required');
  }
  if (typeof ctx.isYearLocked !== 'function') {
    throw new Error('isYearLocked is required');
  }
  if (typeof ctx.buildPartialUpdate !== 'function') {
    throw new Error('buildPartialUpdate is required');
  }
  if (typeof ctx.deleteGroupIfEmptyAutoGroup !== 'function') {
    throw new Error('deleteGroupIfEmptyAutoGroup is required');
  }

  return {
    checkDuplicateListName: (client, userId, name, groupId, excludeListId) =>
      checkDuplicateListName(
        client,
        ctx.TransactionAbort,
        userId,
        name,
        groupId,
        excludeListId
      ),
    bulkUpdate: (userId, updates) => bulkUpdate(ctx, userId, updates),
    updateListMetadata: (listId, userId, updates) =>
      updateListMetadata(ctx, listId, userId, updates),
    toggleMainStatus: (listId, userId, isMain) =>
      toggleMainStatus(ctx, listId, userId, isMain),
    deleteList: (listId, userId) => deleteList(ctx, listId, userId),
  };
}

module.exports = {
  createListManagementOperations,
};
