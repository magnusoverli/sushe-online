/** @param {{db: import('../types').DbFacade}} deps */
function createPlaylistBindingsRepository({ db }) {
  /** @param {string} userId @param {string} listId @param {string} service @param {string} accountId */
  async function get(userId, listId, service, accountId) {
    const { rows } = await db.raw(
      `SELECT playlist_id FROM playlist_bindings
      WHERE user_id = $1 AND list_id = $2 AND service = $3 AND provider_account_id = $4`,
      [userId, listId, service, accountId]
    );
    return rows[0]?.playlist_id || null;
  }
  /** @param {string} userId @param {string} listId @param {string} service @param {string} accountId @param {string} playlistId */
  async function set(userId, listId, service, accountId, playlistId) {
    await db.raw(
      `INSERT INTO playlist_bindings (user_id, list_id, service, provider_account_id, playlist_id)
      SELECT $1, _id, $3, $4, $5 FROM lists WHERE _id = $2 AND user_id = $1
      ON CONFLICT (user_id, list_id, service, provider_account_id)
      DO UPDATE SET playlist_id = EXCLUDED.playlist_id, updated_at = NOW()`,
      [userId, listId, service, accountId, playlistId]
    );
  }
  return { get, set };
}
module.exports = { createPlaylistBindingsRepository };
