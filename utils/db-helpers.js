/**
 * Lightweight ORM-style query helpers
 *
 * Reduces boilerplate for common database operations.
 * Uses dependency injection for testability.
 *
 * Usage:
 *   const { createQueryBuilder } = require('../utils/db-helpers');
 *   const qb = createQueryBuilder(pool);
 *
 *   const lists = await qb.findAll('lists', { user_id: userId }, {
 *     fields: ['_id', 'name', 'year'],
 *     orderBy: 'name',
 *   });
 *
 * @module utils/db-helpers
 */

/**
 * Query builder class for simplified database operations
 */
class QueryBuilder {
  /**
   * @param {Object} pool - PostgreSQL pool (must have .query method)
   */
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Find all records matching criteria
   * @param {string} table - Table name
   * @param {Object} where - Where clause { field: value } or { clause: string, values: [] }
   * @param {Object} options - Query options
   * @param {Array<string>} [options.fields] - Fields to select (default: *)
   * @param {string} [options.orderBy] - ORDER BY clause
   * @param {number} [options.limit] - LIMIT clause
   * @returns {Promise<Array>} Array of records
   */
  async findAll(table, where = {}, options = {}) {
    const { fields = ['*'], orderBy, limit } = options;
    const fieldList = fields.join(', ');

    let query = `SELECT ${fieldList} FROM ${table}`;
    let values = [];

    if (where.clause) {
      // Custom where clause
      query += ` WHERE ${where.clause}`;
      values = where.values || [];
    } else if (Object.keys(where).length > 0) {
      // Simple field = value conditions
      const conditions = Object.keys(where).map(
        (key, idx) => `${key} = $${idx + 1}`
      );
      query += ` WHERE ${conditions.join(' AND ')}`;
      values = Object.values(where);
    }

    if (orderBy) {
      query += ` ORDER BY ${orderBy}`;
    }

    if (limit) {
      query += ` LIMIT ${limit}`;
    }

    const result = await this.pool.query(query, values);
    return result.rows;
  }

  /**
   * Find one record matching criteria
   * @param {string} table - Table name
   * @param {Object} where - Where clause
   * @param {Object} options - Query options
   * @returns {Promise<Object|null>} Record or null
   */
  async findOne(table, where, options = {}) {
    const results = await this.findAll(table, where, { ...options, limit: 1 });
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Check if record exists, throw 404 if not
   * @param {string} table - Table name
   * @param {string} column - Column name
   * @param {*} value - Value to check
   * @param {string} [errorMessage] - Custom error message
   * @throws {Error} If record doesn't exist (with statusCode 404)
   */
  async assertExists(table, column, value, errorMessage) {
    const result = await this.pool.query(
      `SELECT 1 FROM ${table} WHERE ${column} = $1`,
      [value]
    );
    if (result.rows.length === 0) {
      const err = new Error(errorMessage || `${table} not found`);
      err.statusCode = 404;
      throw err;
    }
  }

  /**
   * Check if record exists
   * @param {string} table - Table name
   * @param {Object} where - Where clause
   * @returns {Promise<boolean>} True if exists
   */
  async exists(table, where) {
    const record = await this.findOne(table, where, { fields: ['1'] });
    return record !== null;
  }

  /**
   * Insert a record
   * @param {string} table - Table name
   * @param {Object} data - Data to insert { field: value }
   * @param {Array<string>} [returning] - Fields to return
   * @returns {Promise<Object>} Inserted record
   */
  async insert(table, data, returning = ['*']) {
    const fields = Object.keys(data);
    const values = Object.values(data);
    const placeholders = fields.map((_, idx) => `$${idx + 1}`);

    const query = `
      INSERT INTO ${table} (${fields.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING ${returning.join(', ')}
    `;

    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Update records
   * @param {string} table - Table name
   * @param {Object} data - Data to update { field: value }
   * @param {Object} where - Where clause
   * @param {Array<string>} [returning] - Fields to return
   * @returns {Promise<Array>} Updated records
   */
  async update(table, data, where, returning = ['*']) {
    const fields = Object.keys(data);
    const dataValues = Object.values(data);

    const setClause = fields
      .map((field, idx) => `${field} = $${idx + 1}`)
      .join(', ');

    let query = `UPDATE ${table} SET ${setClause}`;
    let values = [...dataValues];

    if (where.clause) {
      query += ` WHERE ${where.clause}`;
      values = [...dataValues, ...(where.values || [])];
    } else {
      const conditions = Object.keys(where).map(
        (key, idx) => `${key} = $${dataValues.length + idx + 1}`
      );
      query += ` WHERE ${conditions.join(' AND ')}`;
      values = [...dataValues, ...Object.values(where)];
    }

    query += ` RETURNING ${returning.join(', ')}`;

    const result = await this.pool.query(query, values);
    return result.rows;
  }

  /**
   * Delete records
   * @param {string} table - Table name
   * @param {Object} where - Where clause
   * @returns {Promise<number>} Number of deleted records
   */
  async delete(table, where) {
    let query = `DELETE FROM ${table}`;
    let values = [];

    if (where.clause) {
      query += ` WHERE ${where.clause}`;
      values = where.values || [];
    } else {
      const conditions = Object.keys(where).map(
        (key, idx) => `${key} = $${idx + 1}`
      );
      query += ` WHERE ${conditions.join(' AND ')}`;
      values = Object.values(where);
    }

    const result = await this.pool.query(query, values);
    return result.rowCount;
  }
}

/**
 * Create a query builder instance
 * @param {Object} pool - PostgreSQL pool
 * @returns {QueryBuilder}
 */
function createQueryBuilder(pool) {
  return new QueryBuilder(pool);
}

module.exports = { QueryBuilder, createQueryBuilder };
