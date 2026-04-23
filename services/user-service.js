/**
 * User Service
 *
 * Encapsulates business logic for user profile/settings updates.
 * Provides reusable patterns for simple setting updates and
 * uniqueness-checked field updates (email, username).
 *
 * @module services/user-service
 */

const logger = require('../utils/logger');
const { ensureDb } = require('../db/postgres');

// ── Constants ────────────────────────────────────────────────────────────────

/** Allowed values for user settings. Used for validation. */
const ALLOWED_TIME_FORMATS = ['12h', '24h'];
const ALLOWED_DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY'];
const ALLOWED_MUSIC_SERVICES = ['spotify', 'tidal', 'qobuz'];
const ALLOWED_GRID_COLUMNS = [
  'country',
  'genre_1',
  'genre_2',
  'track',
  'comment',
  'comment_2',
];

const HEX_COLOR_REGEX = /^#[0-9A-F]{6}$/i;

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a user service instance with injected dependencies.
 *
 * @param {Object} deps
 * @param {Object} deps.users       - Callback-style user datastore (required)
 * @param {Object} deps.usersAsync  - Promise-style user datastore (required)
 * @param {Object} [deps.logger]    - Logger instance
 * @returns {Object} User service methods
 */
// eslint-disable-next-line max-lines-per-function -- User service keeps closely related settings/admin mutations in one injected module
function createUserService(deps = {}) {
  const usersDep = deps.users;
  const usersAsyncDep = deps.usersAsync;
  const db = deps.db ? ensureDb(deps.db, 'UserService') : null;
  const invalidateUserCacheDep =
    typeof deps.invalidateUserCache === 'function'
      ? deps.invalidateUserCache
      : () => {};

  if (!db && !usersDep) {
    throw new Error('users (callback-style) is required for UserService');
  }
  if (!db && !usersAsyncDep) {
    throw new Error('usersAsync is required for UserService');
  }

  const log = deps.logger || logger;

  // ── Simple setting update ──────────────────────────────────────────────

  /**
   * Update a single user setting field.
   *
   * @param {string} userId    - User ID
   * @param {string} field     - Field name to update
   * @param {*}      value     - New value
   * @returns {Promise<void>}
   */
  async function updateSetting(userId, field, value) {
    if (db) {
      await db.raw(
        `UPDATE users SET ${camelToSnake(field)} = $1, updated_at = $2 WHERE _id = $3`,
        [value, new Date(), userId]
      );
    } else {
      await usersAsyncDep.update(
        { _id: userId },
        { $set: { [field]: value, updatedAt: new Date() } }
      );
    }
    invalidateUserCacheDep(userId);
    log.info(`User setting updated`, { userId, field, value });
  }

  /**
   * Update a unique-constrained field (email or username).
   * Checks that no other user already has the value.
   *
   * @param {string} userId - User ID
   * @param {string} field  - 'email' or 'username'
   * @param {string} value  - New value (will be trimmed)
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async function updateUniqueField(userId, field, value) {
    const trimmed = value.trim();

    // Check uniqueness
    let existing;
    if (db) {
      const result = await db.raw(
        `SELECT _id FROM users WHERE ${camelToSnake(field)} = $1 AND _id <> $2 LIMIT 1`,
        [trimmed, userId],
        { name: `user-service-check-${field}`, retryable: true }
      );
      existing = result.rows[0] || null;
    } else {
      existing = await usersAsyncDep.findOne({
        [field]: trimmed,
        _id: { $ne: userId },
      });
    }

    if (existing) {
      const label =
        field === 'email'
          ? 'Email already in use'
          : `${capitalize(field)} already taken`;
      return { success: false, error: label };
    }

    if (db) {
      await db.raw(
        `UPDATE users SET ${camelToSnake(field)} = $1, updated_at = $2 WHERE _id = $3`,
        [trimmed, new Date(), userId]
      );
    } else {
      await usersAsyncDep.update(
        { _id: userId },
        { $set: { [field]: trimmed, updatedAt: new Date() } }
      );
    }

    invalidateUserCacheDep(userId);
    log.info(`User ${field} updated`, { userId, field });
    return { success: true };
  }

  /**
   * Update the user's last selected list.
   *
   * @param {string} userId - User ID
   * @param {string} listId - List ID
   * @returns {Promise<void>}
   */
  async function updateLastSelectedList(userId, listId) {
    if (db) {
      await db.raw(
        `UPDATE users SET last_selected_list = $1, updated_at = $2 WHERE _id = $3`,
        [listId, new Date(), userId]
      );
    } else {
      await usersAsyncDep.update(
        { _id: userId },
        { $set: { lastSelectedList: listId, updatedAt: new Date() } }
      );
    }
    invalidateUserCacheDep(userId);
  }

  async function updatePasswordHash(userId, newHash) {
    if (db) {
      const result = await db.raw(
        `UPDATE users SET hash = $1, updated_at = $2 WHERE _id = $3 RETURNING _id`,
        [newHash, new Date(), userId]
      );
      invalidateUserCacheDep(userId);
      return result.rows.length > 0;
    }

    const updated = await usersAsyncDep.update(
      { _id: userId },
      { $set: { hash: newHash, updatedAt: new Date() } }
    );
    invalidateUserCacheDep(userId);
    return updated > 0;
  }

  async function setAdminRole(userId, isAdmin) {
    if (db) {
      const result = await db.raw(
        isAdmin
          ? `UPDATE users SET role = 'admin', admin_granted_at = $1, updated_at = $1 WHERE _id = $2 RETURNING _id`
          : `UPDATE users SET role = NULL, admin_granted_at = NULL, updated_at = $1 WHERE _id = $2 RETURNING _id`,
        [new Date(), userId]
      );
      invalidateUserCacheDep(userId);
      return result.rows.length > 0;
    }

    const updated = await usersAsyncDep.update(
      { _id: userId },
      isAdmin
        ? { $set: { role: 'admin', adminGrantedAt: new Date() } }
        : { $unset: { role: true, adminGrantedAt: true } }
    );
    invalidateUserCacheDep(userId);
    return updated > 0;
  }

  async function deleteUser(userId) {
    if (db) {
      const deleted = await db.withTransaction(async (client) => {
        const result = await client.query(
          'DELETE FROM users WHERE _id = $1 RETURNING _id',
          [userId]
        );
        return result.rows.length > 0;
      });
      if (deleted) {
        invalidateUserCacheDep(userId);
      }
      return deleted;
    }

    return new Promise((resolve, reject) => {
      usersDep.remove({ _id: userId }, {}, (err, numRemoved) => {
        if (err) return reject(err);
        if (numRemoved > 0) {
          invalidateUserCacheDep(userId);
        }
        resolve(numRemoved > 0);
      });
    });
  }

  async function getUserLists(userId) {
    if (!db) {
      throw new Error('getUserLists requires db');
    }

    const result = await db.raw(
      `SELECT l.name,
              COUNT(li._id)::int AS album_count,
              l.created_at,
              l.updated_at
       FROM lists l
       LEFT JOIN list_items li ON li.list_id = l._id
       WHERE l.user_id = $1
       GROUP BY l.id
       ORDER BY l.sort_order, l.name`,
      [userId],
      { name: 'user-service-user-lists', retryable: true }
    );

    return result.rows.map((row) => ({
      name: row.name,
      albumCount: row.album_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // ── Validation helpers ─────────────────────────────────────────────────

  /**
   * Validate a simple setting value.
   *
   * @param {string} field - Field name
   * @param {*}      value - Value to validate
   * @returns {{ valid: boolean, value?: *, error?: string }}
   */
  function validateSetting(field, value) {
    switch (field) {
      case 'accentColor':
        if (!HEX_COLOR_REGEX.test(value)) {
          return {
            valid: false,
            error: 'Invalid color format. Please use hex format (#RRGGBB)',
          };
        }
        return { valid: true, value };

      case 'timeFormat':
        if (!ALLOWED_TIME_FORMATS.includes(value)) {
          return { valid: false, error: 'Invalid time format' };
        }
        return { valid: true, value };

      case 'dateFormat':
        if (!ALLOWED_DATE_FORMATS.includes(value)) {
          return { valid: false, error: 'Invalid date format' };
        }
        return { valid: true, value };

      case 'musicService':
        if (value && !ALLOWED_MUSIC_SERVICES.includes(value)) {
          return { valid: false, error: 'Invalid music service' };
        }
        return { valid: true, value: value || null };

      case 'columnVisibility':
        // null resets to default (all columns visible)
        if (value === null) {
          return { valid: true, value: null };
        }
        if (typeof value !== 'object' || Array.isArray(value)) {
          return {
            valid: false,
            error: 'Column visibility must be an object or null',
          };
        }
        for (const key of Object.keys(value)) {
          if (!ALLOWED_GRID_COLUMNS.includes(key)) {
            return {
              valid: false,
              error: `Unknown column: ${key}`,
            };
          }
          if (typeof value[key] !== 'boolean') {
            return {
              valid: false,
              error: `Column visibility values must be booleans`,
            };
          }
        }
        return { valid: true, value };

      default:
        return { valid: false, error: `Unknown setting: ${field}` };
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  return {
    updateSetting,
    updateUniqueField,
    updateLastSelectedList,
    updatePasswordHash,
    setAdminRole,
    deleteUser,
    getUserLists,
    validateSetting,
  };
}

// ── Utility ──────────────────────────────────────────────────────────────────

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function camelToSnake(field) {
  const fieldMap = {
    accentColor: 'accent_color',
    timeFormat: 'time_format',
    dateFormat: 'date_format',
    musicService: 'music_service',
    columnVisibility: 'column_visibility',
    lastSelectedList: 'last_selected_list',
    email: 'email',
    username: 'username',
  };

  return fieldMap[field] || field;
}

module.exports = {
  createUserService,
  // Export constants for tests and reuse
  ALLOWED_TIME_FORMATS,
  ALLOWED_DATE_FORMATS,
  ALLOWED_MUSIC_SERVICES,
  ALLOWED_GRID_COLUMNS,
  HEX_COLOR_REGEX,
};
