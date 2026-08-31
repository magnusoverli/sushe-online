const MAX_REASON_LENGTH = 1000;

function normalizeReason(reason, disqualified, TransactionAbort) {
  if (!disqualified) return null;
  if (reason === null || reason === undefined || reason === '') return null;
  if (typeof reason !== 'string') {
    throw new TransactionAbort(400, {
      error: 'Disqualification reason must be a string or null',
    });
  }
  const normalized = reason.trim();
  if (normalized.length > MAX_REASON_LENGTH) {
    throw new TransactionAbort(400, {
      error: `Disqualification reason cannot exceed ${MAX_REASON_LENGTH} characters`,
    });
  }
  return normalized || null;
}

function createItemDisqualification(deps) {
  const { db, TransactionAbort, findListByIdOrThrow } = deps;

  async function updateItemDisqualification(
    listId,
    userId,
    itemId,
    disqualified,
    reason
  ) {
    if (typeof disqualified !== 'boolean') {
      throw new TransactionAbort(400, {
        error: 'disqualified must be a boolean',
      });
    }
    const normalizedReason = normalizeReason(
      reason,
      disqualified,
      TransactionAbort
    );
    const timestamp = new Date();
    let list;

    await db.withTransaction(async (client) => {
      list = await findListByIdOrThrow(
        listId,
        userId,
        'change ranking eligibility',
        client
      );
      const result = await client.query(
        `UPDATE list_items
         SET is_disqualified = $1,
             disqualification_reason = $2,
             updated_at = $3
         WHERE list_id = $4 AND _id = $5
         RETURNING is_disqualified, disqualification_reason`,
        [disqualified, normalizedReason, timestamp, list._id, itemId]
      );
      if (result.rows.length === 0) {
        throw new TransactionAbort(404, { error: 'List item not found' });
      }
      await client.query('UPDATE lists SET updated_at = $1 WHERE _id = $2', [
        timestamp,
        list._id,
      ]);
    });

    return {
      list,
      is_disqualified: disqualified,
      disqualification_reason: normalizedReason,
    };
  }

  return { updateItemDisqualification };
}

module.exports = { createItemDisqualification, MAX_REASON_LENGTH };
