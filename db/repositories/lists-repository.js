const { ensureDb } = require('../postgres');

function mapListRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row._id,
    userId: row.user_id,
    name: row.name,
    year: row.year,
    isMain: row.is_main,
    groupId: row.group_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createListsRepository(deps = {}) {
  const db = ensureDb(deps.db, 'lists-repository');

  async function findByUserAndExternalId(userId, listId) {
    const result = await db.raw(
      `SELECT id, _id, user_id, name, year, is_main, group_id, sort_order, created_at, updated_at
       FROM lists
       WHERE user_id = $1 AND _id = $2
       LIMIT 1`,
      [userId, listId],
      { name: 'lists-repo-find-by-user-and-id', retryable: true }
    );
    return mapListRow(result.rows[0] || null);
  }

  async function findByExternalId(listId) {
    const result = await db.raw(
      `SELECT id, _id, user_id, name, year, is_main, group_id, sort_order, created_at, updated_at
       FROM lists
       WHERE _id = $1
       LIMIT 1`,
      [listId],
      { name: 'lists-repo-find-by-id', retryable: true }
    );
    return mapListRow(result.rows[0] || null);
  }

  async function listSummariesByUser(userId) {
    const result = await db.raw(
      `SELECT _id, name, year
       FROM lists
       WHERE user_id = $1
       ORDER BY name`,
      [userId],
      { name: 'lists-repo-list-summaries', retryable: true }
    );

    return result.rows.map((row) => ({
      id: row._id,
      name: row.name,
      year: row.year,
    }));
  }

  return {
    findByUserAndExternalId,
    findByExternalId,
    listSummariesByUser,
  };
}

module.exports = {
  createListsRepository,
  mapListRow,
};
