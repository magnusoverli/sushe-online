const { ensureDb } = require('../postgres');

/**
 * Raw `lists` row as selected by this repository. Column types follow the
 * schema: `id` SERIAL, `_id`/`user_id`/`name` TEXT NOT NULL, `year` INTEGER
 * (nullable), `is_main` BOOLEAN DEFAULT FALSE, `group_id` INTEGER referencing
 * list_groups(id) (nullable), `sort_order` INTEGER DEFAULT 0, and the two
 * TIMESTAMPTZ audit columns (returned by pg as Date).
 *
 * @typedef {Object} ListRow
 * @property {number} id
 * @property {string} _id
 * @property {string} user_id
 * @property {string} name
 * @property {number|null} year
 * @property {boolean|null} is_main
 * @property {number|null} group_id
 * @property {number|null} sort_order
 * @property {Date|null} created_at
 * @property {Date|null} updated_at
 */

/**
 * Camel-cased view of a `lists` row, as consumed by services/list-service.js.
 *
 * @typedef {Object} MappedList
 * @property {number} id
 * @property {string} _id
 * @property {string} userId
 * @property {string} name
 * @property {number|null} year
 * @property {boolean|null} isMain
 * @property {number|null} groupId
 * @property {number|null} sortOrder
 * @property {Date|null} createdAt
 * @property {Date|null} updatedAt
 */

/**
 * Lightweight list summary (external id, name, year) used by list pickers.
 *
 * @typedef {Object} ListSummary
 * @property {string} id - the list's external `_id`
 * @property {string} name
 * @property {number|null} year
 */

/**
 * @param {ListRow|null|undefined} row
 * @returns {MappedList|null}
 */
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

/** @param {{ db?: * }} [deps] - `db` is validated by ensureDb, which types the result. */
function createListsRepository(deps = {}) {
  // ensureDb only guarantees `.raw` is callable; the cast pins the canonical
  // facade shape so query results carry pg's QueryResult type.
  const db = /** @type {import('../types').DbFacade} */ (
    ensureDb(deps.db, 'lists-repository')
  );

  /**
   * @param {string} userId - `users._id` (TEXT).
   * @param {string} listId - the list's external `_id` (TEXT).
   * @returns {Promise<MappedList|null>}
   */
  async function findByUserAndExternalId(userId, listId) {
    const result = /** @type {import('pg').QueryResult<ListRow>} */ (
      await db.raw(
        `SELECT id, _id, user_id, name, year, is_main, group_id, sort_order, created_at, updated_at
       FROM lists
       WHERE user_id = $1 AND _id = $2
       LIMIT 1`,
        [userId, listId],
        { name: 'lists-repo-find-by-user-and-id', retryable: true }
      )
    );
    return mapListRow(result.rows[0] || null);
  }

  /**
   * @param {string} userId - `users._id` (TEXT).
   * @returns {Promise<ListSummary[]>}
   */
  async function listSummariesByUser(userId) {
    const result =
      /** @type {import('pg').QueryResult<Pick<ListRow, '_id' | 'name' | 'year'>>} */ (
        await db.raw(
          `SELECT _id, name, year
       FROM lists
       WHERE user_id = $1
       ORDER BY name`,
          [userId],
          { name: 'lists-repo-list-summaries', retryable: true }
        )
      );

    return result.rows.map((row) => ({
      id: row._id,
      name: row.name,
      year: row.year,
    }));
  }

  return {
    findByUserAndExternalId,
    listSummariesByUser,
  };
}

module.exports = {
  createListsRepository,
  mapListRow,
};
