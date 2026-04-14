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

module.exports = {
  checkDuplicateListName,
};
