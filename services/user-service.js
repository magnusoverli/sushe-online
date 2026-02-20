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

// ── Constants ────────────────────────────────────────────────────────────────

/** Allowed values for user settings. Used for validation. */
const ALLOWED_TIME_FORMATS = ['12h', '24h'];
const ALLOWED_DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY'];
const ALLOWED_MUSIC_SERVICES = ['spotify', 'tidal'];
const ALLOWED_UI_MODES = ['mobile', 'desktop'];

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
function createUserService(deps = {}) {
  const usersDep = deps.users;
  const usersAsyncDep = deps.usersAsync;

  if (!usersDep) {
    throw new Error('users (callback-style) is required for UserService');
  }
  if (!usersAsyncDep) {
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
    await usersAsyncDep.update(
      { _id: userId },
      { $set: { [field]: value, updatedAt: new Date() } }
    );
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
    const existing = await usersAsyncDep.findOne({
      [field]: trimmed,
      _id: { $ne: userId },
    });

    if (existing) {
      const label =
        field === 'email'
          ? 'Email already in use'
          : `${capitalize(field)} already taken`;
      return { success: false, error: label };
    }

    await usersAsyncDep.update(
      { _id: userId },
      { $set: { [field]: trimmed, updatedAt: new Date() } }
    );

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
    await usersAsyncDep.update(
      { _id: userId },
      { $set: { lastSelectedList: listId, updatedAt: new Date() } }
    );
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

      case 'preferredUi':
        if (value && !ALLOWED_UI_MODES.includes(value)) {
          return { valid: false, error: 'Invalid UI mode' };
        }
        return { valid: true, value: value || null };

      default:
        return { valid: false, error: `Unknown setting: ${field}` };
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  return {
    updateSetting,
    updateUniqueField,
    updateLastSelectedList,
    validateSetting,
  };
}

// ── Utility ──────────────────────────────────────────────────────────────────

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = {
  createUserService,
  // Export constants for tests and reuse
  ALLOWED_TIME_FORMATS,
  ALLOWED_DATE_FORMATS,
  ALLOWED_MUSIC_SERVICES,
  HEX_COLOR_REGEX,
};
