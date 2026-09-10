const { TransactionAbort } = require('../../../db/transaction');

async function validateAndCompactOrder(client, listId) {
  const { rows } = await client.query(
    'SELECT _id, position FROM list_items WHERE list_id = $1 ORDER BY position, _id',
    [listId]
  );
  const positions = new Set();
  for (const item of rows) {
    if (
      !Number.isSafeInteger(item.position) ||
      item.position < 1 ||
      positions.has(item.position)
    ) {
      throw new TransactionAbort(409, {
        error:
          'List positions must be positive and unique. Reload the list before retrying.',
        code: 'INVALID_LIST_ORDER',
      });
    }
    positions.add(item.position);
  }
  if (rows.some((item, index) => item.position !== index + 1)) {
    await client.query(
      `UPDATE list_items AS li SET position = ranked.position, updated_at = NOW()
      FROM UNNEST($1::text[], $2::int[]) AS ranked(id, position)
      WHERE li._id = ranked.id AND li.list_id = $3`,
      [rows.map((row) => row._id), rows.map((_, index) => index + 1), listId]
    );
  }
}

module.exports = { validateAndCompactOrder };
