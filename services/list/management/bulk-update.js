async function bulkUpdate(ctx, userId, updates) {
  const results = [];
  const yearsToRecompute = new Set();

  // eslint-disable-next-line complexity -- The transaction performs a two-pass validation and lock sequence for partial bulk updates
  await ctx.db.withTransaction(async (client) => {
    const pendingUpdates = [];

    for (const update of updates) {
      const { listId, year } = update;

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
      const newYear = year !== undefined ? year : oldList.year;

      if (newYear !== null && (newYear < 1000 || newYear > 9999)) {
        results.push({ listId, success: false, error: 'Invalid year' });
        continue;
      }

      pendingUpdates.push({ update, oldList });
    }

    const yearsToLock = new Set();
    for (const pendingUpdate of pendingUpdates) {
      const { update, oldList } = pendingUpdate;
      const oldYear = oldList.year;
      const newYear = update.year !== undefined ? update.year : oldList.year;
      const newIsMain =
        update.isMain !== undefined ? update.isMain : oldList.is_main;

      if (oldList.is_main) {
        yearsToLock.add(oldYear);
      }
      if (newIsMain) {
        yearsToLock.add(newYear);
      }
    }

    await ctx.acquireYearLocks(client, Array.from(yearsToLock));

    for (const pendingUpdate of pendingUpdates) {
      const { update } = pendingUpdate;
      const { listId, year, isMain: updateIsMain } = update;
      const listCheck = await client.query(
        `SELECT _id, year, is_main
         FROM lists
         WHERE _id = $1 AND user_id = $2
         FOR UPDATE`,
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

      const effectiveYear = newYear || oldYear;
      if (effectiveYear) {
        const yearLocked = await ctx.isYearLocked(client, effectiveYear);
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

module.exports = {
  bulkUpdate,
};
