// Only return attribution fields; authentication material must never leave this query.
/**
 * @param {import('../types').DbFacade | import('pg').PoolClient} queryable
 * @param {number} telegramUserId
 * @param {number | null} [chatId] - Set only inside an action transaction.
 */
async function findLinkedAdmin(queryable, telegramUserId, chatId = null) {
  const query =
    'query' in queryable
      ? queryable.query.bind(queryable)
      : queryable.raw.bind(queryable);
  const lockContext = chatId !== null;
  const result = await query(
    `SELECT u._id, u.username FROM users u
     JOIN telegram_admins ta ON u._id = ta.user_id
     ${lockContext ? 'JOIN telegram_config tc ON tc.chat_id = $2 AND tc.enabled = true' : ''}
     WHERE ta.telegram_user_id = $1
       AND u.role = 'admin' AND u.approval_status = 'approved'
     ${lockContext ? 'FOR SHARE OF u, ta, tc' : ''}`,
    lockContext ? [telegramUserId, chatId] : [telegramUserId]
  );
  return result.rows[0] || null;
}

/** @param {import('pg').PoolClient} queryable @param {string} userId */
async function findWebAdmin(queryable, userId) {
  if (typeof userId !== 'string' || !userId) return null;
  const result = await queryable.query(
    `SELECT u._id, u.username FROM users u
     WHERE u._id = $1 AND u.role = 'admin' AND u.approval_status = 'approved'
     FOR SHARE OF u`,
    [userId]
  );
  return result.rows[0] || null;
}

module.exports = { findLinkedAdmin, findWebAdmin };
