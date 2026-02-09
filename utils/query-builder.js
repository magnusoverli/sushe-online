/**
 * SQL Query Builder Utilities
 *
 * Pure functions for building SQL queries. No database calls or side effects.
 */

/**
 * Build a partial UPDATE query from a list of field/value pairs.
 * Automatically appends `updated_at` with a timestamp.
 *
 * This is a pure SQL builder — no database calls or side effects.
 *
 * @param {string} table - Table name (e.g. 'albums', 'lists', 'list_groups')
 * @param {string} idColumn - WHERE clause column name (e.g. 'album_id', 'id')
 * @param {*} idValue - The value to match in the WHERE clause
 * @param {Array<{column: string, value: *}>} fields - Column/value pairs to SET
 * @param {Object} [options] - Optional settings
 * @param {Date|*} [options.timestamp] - Value for updated_at (default: new Date())
 * @returns {{query: string, values: Array}|null} The query and params, or null if fields is empty
 */
function buildPartialUpdate(table, idColumn, idValue, fields, options = {}) {
  if (!fields || fields.length === 0) return null;

  const timestamp =
    options.timestamp !== undefined ? options.timestamp : new Date();
  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const { column, value } of fields) {
    setClauses.push(`${column} = $${paramIndex++}`);
    values.push(value);
  }

  setClauses.push(`updated_at = $${paramIndex++}`);
  values.push(timestamp);

  values.push(idValue);

  return {
    query: `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${idColumn} = $${paramIndex}`,
    values,
  };
}

module.exports = { buildPartialUpdate };
