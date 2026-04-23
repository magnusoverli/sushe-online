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
const {
  createUsersRepository,
} = require('../db/repositories/users-repository');

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
 * @param {import('../db/types').DbFacade} deps.db - Canonical datastore (required)
 * @param {Object} [deps.logger]    - Logger instance
 * @returns {Object} User service methods
 */
// eslint-disable-next-line max-lines-per-function -- User service keeps closely related settings/admin mutations in one injected module
function createUserService(deps = {}) {
  const db = ensureDb(deps.db, 'UserService');
  const usersRepository = deps.usersRepository || createUsersRepository({ db });
  const invalidateUserCacheDep =
    typeof deps.invalidateUserCache === 'function'
      ? deps.invalidateUserCache
      : () => {};

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
    await db.raw(
      `UPDATE users SET ${camelToSnake(field)} = $1, updated_at = $2 WHERE _id = $3`,
      [value, new Date(), userId]
    );
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
    const result = await db.raw(
      `SELECT _id FROM users WHERE ${camelToSnake(field)} = $1 AND _id <> $2 LIMIT 1`,
      [trimmed, userId],
      { name: `user-service-check-${field}`, retryable: true }
    );
    const existing = result.rows[0] || null;

    if (existing) {
      const label =
        field === 'email'
          ? 'Email already in use'
          : `${capitalize(field)} already taken`;
      return { success: false, error: label };
    }

    await db.raw(
      `UPDATE users SET ${camelToSnake(field)} = $1, updated_at = $2 WHERE _id = $3`,
      [trimmed, new Date(), userId]
    );

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
    await db.raw(
      `UPDATE users SET last_selected_list = $1, updated_at = $2 WHERE _id = $3`,
      [listId, new Date(), userId]
    );
    invalidateUserCacheDep(userId);
  }

  async function updateLastActivity(userId, timestamp = new Date()) {
    const updated = await usersRepository.updateLastActivity(userId, timestamp);
    invalidateUserCacheDep(userId);
    return updated > 0;
  }

  async function setSpotifyAuth(userId, token) {
    const updated = await usersRepository.setSpotifyAuth(userId, token);
    invalidateUserCacheDep(userId);
    return updated > 0;
  }

  async function clearSpotifyAuth(userId) {
    const updated = await usersRepository.clearSpotifyAuth(userId);
    invalidateUserCacheDep(userId);
    return updated > 0;
  }

  async function setTidalAuth(userId, token, countryCode = null) {
    const updated = await usersRepository.setTidalAuth(
      userId,
      token,
      countryCode
    );
    invalidateUserCacheDep(userId);
    return updated > 0;
  }

  async function clearTidalAuth(userId) {
    const updated = await usersRepository.clearTidalAuth(userId);
    invalidateUserCacheDep(userId);
    return updated > 0;
  }

  async function setTidalCountry(userId, countryCode) {
    const updated = await usersRepository.setTidalCountry(userId, countryCode);
    invalidateUserCacheDep(userId);
    return updated > 0;
  }

  async function setLastfmAuth(userId, auth, username) {
    const updated = await usersRepository.setLastfmAuth(userId, auth, username);
    invalidateUserCacheDep(userId);
    return updated > 0;
  }

  async function clearLastfmAuth(userId) {
    const updated = await usersRepository.clearLastfmAuth(userId);
    invalidateUserCacheDep(userId);
    return updated > 0;
  }

  async function saveOAuthToken(userId, authField, token) {
    if (authField === 'spotifyAuth') {
      return setSpotifyAuth(userId, token);
    }
    if (authField === 'tidalAuth') {
      return setTidalAuth(userId, token, null);
    }
    throw new Error(`Unsupported auth field: ${authField}`);
  }

  async function updatePasswordHash(userId, newHash) {
    const result = await db.raw(
      `UPDATE users SET hash = $1, updated_at = $2 WHERE _id = $3 RETURNING _id`,
      [newHash, new Date(), userId]
    );
    invalidateUserCacheDep(userId);
    return result.rows.length > 0;
  }

  async function setAdminRole(userId, isAdmin) {
    const result = await db.raw(
      isAdmin
        ? `UPDATE users SET role = 'admin', admin_granted_at = $1, updated_at = $1 WHERE _id = $2 RETURNING _id`
        : `UPDATE users SET role = NULL, admin_granted_at = NULL, updated_at = $1 WHERE _id = $2 RETURNING _id`,
      [new Date(), userId]
    );
    invalidateUserCacheDep(userId);
    return result.rows.length > 0;
  }

  async function deleteUser(userId) {
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

  async function getUserLists(userId) {
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
    updateLastActivity,
    setSpotifyAuth,
    clearSpotifyAuth,
    setTidalAuth,
    clearTidalAuth,
    setTidalCountry,
    setLastfmAuth,
    clearLastfmAuth,
    saveOAuthToken,
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
