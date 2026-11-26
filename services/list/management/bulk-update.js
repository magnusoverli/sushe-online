const { withListTransaction, recordAggregateYears } = require('../transaction');

async function bulkUpdate(ctx, userId, updates) {
  const results = [];
  const yearsToRecompute = new Set();

  // eslint-disable-next-line complexity -- The transaction performs a two-pass validation and lock sequence for partial bulk updates
  await withListTransaction(ctx.db, userId, async (client) => {
    const pendingUpdates = [];
    const ids = [
      ...new Set(updates.map((update) => update.listId).filter(Boolean)),
    ];
    const owned = await client.query(
      'SELECT _id, year, is_main FROM lists WHERE _id = ANY($1::text[]) AND user_id = $2',
      [ids, userId]
    );
    const byId = new Map(owned.rows.map((row) => [row._id, row]));

    for (const update of updates) {
      const { listId, year } = update;

      if (!listId) {
        results.push({ listId, success: false, error: 'Missing listId' });
        continue;
      }

      const oldList = byId.get(listId);
      if (!oldList) {
        results.push({ listId, success: false, error: 'List not found' });
        continue;
      }

      const newYear = year !== undefined ? year : oldList.year;

      if (
        newYear !== null &&
        (!Number.isInteger(newYear) || newYear < 1000 || newYear > 9999)
      ) {
        results.push({ listId, success: false, error: 'Invalid year' });
        continue;
      }

      pendingUpdates.push({ update, oldList });
    }

    const yearsToLock = new Set();
    // Repeated entries may promote a list and move it again later in the batch.
    const possibleMains = new Set(
      pendingUpdates
        .filter(
          ({ update, oldList }) => oldList.is_main || update.isMain === true
        )
        .map(({ update }) => update.listId)
    );
    for (const { update, oldList } of pendingUpdates) {
      if (possibleMains.has(update.listId)) {
        yearsToLock.add(oldList.year);
        yearsToLock.add(update.year);
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

      if (typeof newIsMain !== 'boolean' || (newIsMain && !newYear)) {
        results.push({
          listId,
          success: false,
          error: 'A main list requires a year and a boolean main status',
        });
        continue;
      }

      if (
        oldList.is_main &&
        oldYear &&
        oldYear !== newYear &&
        (await ctx.isYearLocked(client, oldYear, { failOpen: false }))
      ) {
        results.push({
          listId,
          success: false,
          error: `Cannot update main list: Year ${oldYear} is locked`,
        });
        continue;
      }

      const effectiveYear = newYear || oldYear;
      if (effectiveYear) {
        const yearLocked = await ctx.isYearLocked(client, effectiveYear, {
          failOpen: false,
        });
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

      if (oldYear === newYear && oldList.is_main === newIsMain) {
        results.push({ listId, success: true });
        continue;
      }
      if (newIsMain && newYear !== null) {
        await client.query(
          `UPDATE lists SET is_main = FALSE, updated_at = NOW()
           WHERE user_id = $1 AND year = $2 AND is_main = TRUE AND _id != $3`,
          [userId, newYear, listId]
        );
      }

      if (year !== undefined && newYear !== oldYear) {
        const groupId =
          newYear === null
            ? await ctx.findOrCreateUncategorizedGroup(client, userId)
            : (await ctx.findOrCreateYearGroup(client, userId, newYear))
                .groupId;
        const duplicate = await client.query(
          `SELECT 1 FROM lists destination JOIN lists source ON source._id = $1
          WHERE destination.group_id = $2 AND destination.name = source.name AND destination._id <> source._id`,
          [listId, groupId]
        );
        if (duplicate.rows.length)
          throw new ctx.TransactionAbort(409, {
            error: 'Destination group already has a list with this name',
          });
        await client.query(
          `UPDATE lists SET group_id = $1,
          sort_order = (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM lists WHERE group_id = $1)
          WHERE _id = $2`,
          [groupId, listId]
        );
      }

      await client.query(
        `UPDATE lists SET year = $1, is_main = $2, updated_at = NOW() WHERE _id = $3`,
        [newYear, newIsMain, listId]
      );

      results.push({ listId, success: true });
      if (oldYear !== null && oldList.is_main) yearsToRecompute.add(oldYear);
      if (newYear !== null && newIsMain) yearsToRecompute.add(newYear);
    }
    recordAggregateYears(client, ...yearsToRecompute);
  });

  return { results, yearsToRecompute };
}

module.exports = {
  bulkUpdate,
};
