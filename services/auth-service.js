/**
 * Authentication Service
 *
 * Encapsulates business logic for user registration, password management,
 * and admin code validation. Follows the factory/DI pattern established
 * by list-service.js.
 *
 * @module services/auth-service
 */

const logger = require('../utils/logger');

// ── Constants ────────────────────────────────────────────────────────────────

const BCRYPT_SALT_ROUNDS = 12;

const SESSION_DEFAULT_MS = 24 * 60 * 60 * 1000; // 1 day
const SESSION_REMEMBER_MS = 30 * SESSION_DEFAULT_MS; // 30 days

const EXTENSION_TOKEN_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/** Default values for newly-registered users. */
const USER_DEFAULTS = {
  spotifyAuth: null,
  tidalAuth: null,
  tidalCountry: null,
  accentColor: '#dc2626',
  timeFormat: '24h',
  dateFormat: 'MM/DD/YYYY',
  approvalStatus: 'pending',
};

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create an auth service instance with injected dependencies.
 *
 * @param {Object} deps
 * @param {Object} deps.usersAsync   - Async user datastore (required)
 * @param {Object} [deps.bcrypt]     - bcrypt/bcryptjs library
 * @param {Object} [deps.logger]     - Logger instance
 * @returns {Object} Auth service methods
 */
function createAuthService(deps = {}) {
  const usersAsyncDep = deps.usersAsync;
  if (!usersAsyncDep) {
    throw new Error('usersAsync is required for AuthService');
  }

  const bcryptDep = deps.bcrypt || require('bcryptjs');
  const log = deps.logger || logger;

  // ── Registration ─────────────────────────────────────────────────────────

  /**
   * Validate registration inputs.
   * @returns {{ valid: boolean, error?: string }}
   */
  function validateRegistration(
    { email, username, password, confirmPassword },
    validators
  ) {
    const { isValidEmail, isValidUsername, isValidPassword } = validators;

    if (!email || !username || !password || !confirmPassword) {
      return { valid: false, error: 'All fields are required' };
    }
    if (password !== confirmPassword) {
      return { valid: false, error: 'Passwords do not match' };
    }
    if (!isValidEmail(email)) {
      return { valid: false, error: 'Please enter a valid email address' };
    }
    if (!isValidUsername(username)) {
      return {
        valid: false,
        error:
          'Username can only contain letters, numbers, and underscores and must be 3-30 characters',
      };
    }
    if (!isValidPassword(password)) {
      return {
        valid: false,
        error: 'Password must be at least 8 characters',
      };
    }
    return { valid: true };
  }

  /**
   * Register a new user.
   *
   * @param {Object} input - { email, username, password, confirmPassword }
   * @param {Object} validators - { isValidEmail, isValidUsername, isValidPassword }
   * @returns {Promise<{ user: Object, validation?: Object }>}
   * @throws {Error} on database / hashing errors
   */
  async function registerUser(input, validators) {
    const validation = validateRegistration(input, validators);
    if (!validation.valid) {
      return { user: null, validation };
    }

    const { email, username, password } = input;

    // Check for duplicates
    const existingEmail = await usersAsyncDep.findOne({ email });
    if (existingEmail) {
      return {
        user: null,
        validation: { valid: false, error: 'Email already registered' },
      };
    }

    const existingUsername = await usersAsyncDep.findOne({ username });
    if (existingUsername) {
      return {
        user: null,
        validation: { valid: false, error: 'Username already taken' },
      };
    }

    // Hash password
    const hash = await bcryptDep.hash(password, BCRYPT_SALT_ROUNDS);
    if (!hash) {
      throw new Error('Password hashing failed');
    }

    // Insert user
    const newUser = await usersAsyncDep.insert({
      email,
      username,
      hash,
      ...USER_DEFAULTS,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    log.info('New user registered (pending approval)', { email, username });
    return { user: newUser, validation: { valid: true } };
  }

  // ── Admin approval event ─────────────────────────────────────────────────

  /**
   * Create an admin event for new-user approval.
   * Silently logs errors — registration should not fail if this does.
   */
  async function createApprovalEvent(adminEventService, user) {
    if (!adminEventService) {
      log.warn('Admin event service not available, skipping approval event');
      return;
    }

    try {
      await adminEventService.createEvent({
        type: 'account_approval',
        title: 'New User Registration',
        description: `User "${user.username}" (${user.email}) has registered and needs approval.`,
        data: {
          userId: user._id,
          username: user.username,
          email: user.email,
        },
        priority: 'normal',
        actions: [
          { id: 'approve', label: '✅ Approve' },
          { id: 'reject', label: '❌ Reject' },
        ],
      });
      log.info('Admin event created for registration approval', {
        username: user.username,
      });
    } catch (eventError) {
      log.error('Failed to create admin event for registration', {
        error: eventError.message,
      });
    }
  }

  // ── Password change ──────────────────────────────────────────────────────

  /**
   * Change a user's password.
   *
   * @param {string} userId
   * @param {string} currentHash  - The user's current bcrypt hash
   * @param {Object} input        - { currentPassword, newPassword, confirmPassword }
   * @param {Function} isValidPassword
   * @returns {Promise<{ success: boolean, error?: string, newHash?: string }>}
   */
  async function changePassword(userId, currentHash, input, isValidPassword) {
    const { currentPassword, newPassword, confirmPassword } = input;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return { success: false, error: 'All fields are required' };
    }
    if (newPassword !== confirmPassword) {
      return { success: false, error: 'New passwords do not match' };
    }
    if (!isValidPassword(newPassword)) {
      return {
        success: false,
        error: 'New password must be at least 8 characters',
      };
    }

    const isMatch = await bcryptDep.compare(currentPassword, currentHash);
    if (!isMatch) {
      return { success: false, error: 'Current password is incorrect' };
    }

    const newHash = await bcryptDep.hash(newPassword, BCRYPT_SALT_ROUNDS);
    return { success: true, newHash };
  }

  // ── Admin code validation ────────────────────────────────────────────────

  /**
   * Validate an admin code and grant admin role.
   *
   * @param {string} code          - Submitted admin code
   * @param {string} userId        - Requesting user's ID
   * @param {Object} adminCodeState - Global admin code state
   * @returns {{ valid: boolean, error?: string }}
   */
  function validateAdminCode(code, userId, adminCodeState) {
    const submittedCode = code ? code.toUpperCase().trim() : null;
    const isExpired = new Date() > adminCodeState.adminCodeExpiry;

    log.info('Admin code validation', {
      userId,
      hasSubmittedCode: !!submittedCode,
      codeLength: submittedCode ? submittedCode.length : 0,
      isExpired,
      expiresAt: adminCodeState.adminCodeExpiry.toISOString(),
    });

    if (!code || submittedCode !== adminCodeState.adminCode || isExpired) {
      return { valid: false, error: 'Invalid or expired admin code' };
    }

    return { valid: true };
  }

  /**
   * Finalize admin code usage after the DB role update succeeds.
   * Tracks who used the code and regenerates it.
   */
  function finalizeAdminCodeUsage(adminCodeState, userEmail) {
    adminCodeState.lastCodeUsedBy = userEmail;
    adminCodeState.lastCodeUsedAt = Date.now();
    log.info('🔄 Regenerating admin code after successful use...');
    adminCodeState.generateAdminCode();
  }

  // ── Session helpers ──────────────────────────────────────────────────────

  /**
   * Compute session cookie maxAge based on "remember me" flag.
   * @param {*} rememberValue - Form value: 'on', 'true', or true
   * @returns {number} maxAge in milliseconds
   */
  function getSessionMaxAge(rememberValue) {
    const remember =
      rememberValue === 'on' ||
      rememberValue === 'true' ||
      rememberValue === true;
    return remember ? SESSION_REMEMBER_MS : SESSION_DEFAULT_MS;
  }

  // ── Extension token management ────────────────────────────────────────────

  /**
   * Generate and store a new extension token for a user.
   *
   * Historical signature accepted a pool as the first argument; it is now
   * optional and ignored (usersAsync.raw is used internally so logging,
   * metrics, and the shutdown drain flag apply).
   *
   * @param {Object} [_legacyPoolIgnored]
   * @param {string} userId
   * @param {string} userAgent - Request User-Agent string
   * @param {Function} generateToken - Token generation function
   * @returns {Promise<{ token: string, expiresAt: string }>}
   */
  async function createExtensionToken(
    _legacyPoolIgnored,
    userId,
    userAgent,
    generateToken
  ) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + EXTENSION_TOKEN_EXPIRY_MS);

    await usersAsyncDep.raw(
      `INSERT INTO extension_tokens (user_id, token, expires_at, user_agent)
       VALUES ($1, $2, $3, $4)`,
      [userId, token, expiresAt, userAgent],
      { name: 'extension-tokens-insert' }
    );

    return { token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Revoke an extension token owned by a specific user.
   *
   * @param {Object} [_legacyPoolIgnored]
   * @param {string} token
   * @param {string} userId
   * @returns {Promise<{ revoked: boolean }>}
   */
  async function revokeExtensionToken(_legacyPoolIgnored, token, userId) {
    const result = await usersAsyncDep.raw(
      `UPDATE extension_tokens
       SET is_revoked = TRUE
       WHERE token = $1 AND user_id = $2`,
      [token, userId],
      { name: 'extension-tokens-revoke' }
    );
    return { revoked: result.rowCount > 0 };
  }

  /**
   * List all extension tokens for a user.
   *
   * @param {Object} [_legacyPoolIgnored]
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  async function listExtensionTokens(_legacyPoolIgnored, userId) {
    const result = await usersAsyncDep.raw(
      `SELECT id, created_at, last_used_at, expires_at, user_agent, is_revoked
       FROM extension_tokens
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
      { name: 'extension-tokens-list', retryable: true }
    );
    return result.rows;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  return {
    registerUser,
    createApprovalEvent,
    changePassword,
    validateAdminCode,
    finalizeAdminCodeUsage,
    getSessionMaxAge,
    createExtensionToken,
    revokeExtensionToken,
    listExtensionTokens,
  };
}

module.exports = {
  createAuthService,
  // Export constants for use in routes and tests
  BCRYPT_SALT_ROUNDS,
  SESSION_DEFAULT_MS,
  SESSION_REMEMBER_MS,
  EXTENSION_TOKEN_EXPIRY_MS,
  USER_DEFAULTS,
};
