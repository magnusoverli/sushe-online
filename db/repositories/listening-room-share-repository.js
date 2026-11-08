const { ensureDb } = require('../postgres');

/** @param {{ db?: import('../types').DbFacade }} [deps] */
function createListeningRoomShareRepository(deps = {}) {
  const db = ensureDb(deps.db, 'listening-room-share-repository');

  /** @param {string} listId */
  async function findListOwner(listId) {
    const result = await db.raw('SELECT user_id FROM lists WHERE _id = $1', [
      listId,
    ]);
    return result.rows[0]?.user_id ?? null;
  }

  /** @param {string} listId @param {string} userId @param {string} token */
  async function createOrRenew(listId, userId, token) {
    // ON CONFLICT serializes concurrent shares of the same list. The second
    // caller keeps the first caller's live token instead of publishing another.
    const result = await db.raw(
      `
      INSERT INTO listening_room_shares (token, list_id, user_id, expires_at)
      VALUES ($1, $2, $3, statement_timestamp() + INTERVAL '168 hours')
      ON CONFLICT (list_id) DO UPDATE SET
        token = CASE WHEN listening_room_shares.expires_at > statement_timestamp()
          THEN listening_room_shares.token ELSE EXCLUDED.token END,
        created_at = CASE WHEN listening_room_shares.expires_at > statement_timestamp()
          THEN listening_room_shares.created_at ELSE statement_timestamp() END,
        expires_at = EXCLUDED.expires_at
      RETURNING token, expires_at`,
      [token, listId, userId]
    );
    return result.rows[0];
  }

  /** @param {string} listId @param {string} userId */
  async function stop(listId, userId) {
    await db.raw(
      'DELETE FROM listening_room_shares WHERE list_id = $1 AND user_id = $2',
      [listId, userId]
    );
  }

  /** @param {string} token */
  async function findWorking(token) {
    const result = await db.raw(
      `
      SELECT s.list_id, s.user_id, s.expires_at
      FROM listening_room_shares s
      JOIN lists l ON l._id = s.list_id AND l.user_id = s.user_id
      JOIN users u ON u._id = s.user_id AND u.approval_status = 'approved'
      WHERE s.token = $1 AND s.expires_at > statement_timestamp()`,
      [token]
    );
    return result.rows[0] || null;
  }

  return { findListOwner, createOrRenew, stop, findWorking };
}

module.exports = { createListeningRoomShareRepository };
