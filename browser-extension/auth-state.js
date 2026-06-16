// Centralized authentication state management for SuShe Online extension
// This module provides a single source of truth for authentication state
// All components should use these functions instead of maintaining their own state

(function () {
  const { STORAGE_KEYS } = globalThis.ExtensionConstants;

  /**
   * Storage keys used for authentication:
   * - authToken: The bearer token for API authentication
   * - tokenExpiresAt: Timestamp when the token expires (milliseconds since epoch)
   * - userLists: Cached array of list names
   * - listsLastFetched: Timestamp when lists were last fetched
   * - hasEverAuthenticated: Flag indicating user has logged in at least once
   * - apiUrl: The configured SuShe Online instance URL
   */

  const AUTH_STORAGE_KEYS = [
    STORAGE_KEYS.AUTH_TOKEN,
    STORAGE_KEYS.TOKEN_EXPIRES_AT,
    STORAGE_KEYS.USER_LISTS,
    STORAGE_KEYS.USER_LISTS_BY_YEAR,
    STORAGE_KEYS.LISTS_LAST_FETCHED,
    STORAGE_KEYS.HAS_EVER_AUTHENTICATED,
  ];

  /**
   * Check if a token has expired based on the expiresAt timestamp
   * @param {number|null} expiresAt - Timestamp in milliseconds
   * @returns {boolean} - True if token is expired
   */
  function isTokenExpired(expiresAt) {
    if (!expiresAt) return false; // Unknown expiry, let server decide
    // Add 30 second buffer to avoid edge cases
    return Date.now() >= expiresAt - 30000;
  }

  /**
   * Get the current authentication state from storage
   * This is the primary function for checking auth state - always reads from storage
   * @returns {Promise<{token: string|null, expiresAt: number|null, apiUrl: string|null, isValid: boolean, isExpired: boolean}>}
   */
  async function getAuthState() {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.AUTH_TOKEN,
      STORAGE_KEYS.TOKEN_EXPIRES_AT,
      STORAGE_KEYS.API_URL,
    ]);

    const token = data[STORAGE_KEYS.AUTH_TOKEN] || null;
    const expiresAt = data[STORAGE_KEYS.TOKEN_EXPIRES_AT] || null;
    const apiUrl = data[STORAGE_KEYS.API_URL] || null;
    const expired = isTokenExpired(expiresAt);

    return {
      token,
      expiresAt,
      apiUrl,
      isExpired: expired,
      isValid: !!token && !expired,
    };
  }

  /**
   * Validate token and clean up if expired
   * Call this before any API operation
   * @returns {Promise<{valid: boolean, token?: string, reason?: string}>}
   */
  async function validateAndCleanToken() {
    const state = await getAuthState();

    if (!state.token) {
      return { valid: false, reason: 'no_token' };
    }

    if (state.isExpired) {
      console.log('Token expired, clearing auth data');
      await clearAllAuthData();
      return { valid: false, reason: 'expired' };
    }

    return { valid: true, token: state.token };
  }

  /**
   * Clear all authentication-related data from storage
   * This should be called on logout, token expiry, or 401 errors
   * @returns {Promise<void>}
   */
  async function clearAllAuthData() {
    console.log('Clearing all auth data');
    await chrome.storage.local.remove(AUTH_STORAGE_KEYS);
  }

  /**
   * Handle a 401 Unauthorized response from the API
   * Clears auth state and returns info for UI update
   * @returns {Promise<{cleared: boolean}>}
   */
  async function handleUnauthorized() {
    console.log('Received 401 - clearing auth data');
    await clearAllAuthData();
    return { cleared: true };
  }

  /**
   * Load all state needed by background service worker
   * Always reads from storage - never trusts in-memory state
   * @returns {Promise<{apiUrl: string|null, authToken: string|null, userLists: Array, userListsByYear: Object, listsLastFetched: number, isValid: boolean}>}
   */
  async function loadFullState() {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.API_URL,
      STORAGE_KEYS.AUTH_TOKEN,
      STORAGE_KEYS.TOKEN_EXPIRES_AT,
      STORAGE_KEYS.USER_LISTS,
      STORAGE_KEYS.USER_LISTS_BY_YEAR,
      STORAGE_KEYS.LISTS_LAST_FETCHED,
    ]);

    const token = data[STORAGE_KEYS.AUTH_TOKEN] || null;
    const expiresAt = data[STORAGE_KEYS.TOKEN_EXPIRES_AT] || null;
    const expired = isTokenExpired(expiresAt);

    // If token is expired, don't return it as valid
    if (token && expired) {
      console.log(
        'Token expired during state load, will clear on next operation'
      );
    }

    return {
      apiUrl: data[STORAGE_KEYS.API_URL] || null,
      authToken: expired ? null : token,
      tokenExpiresAt: expiresAt,
      userLists: Array.isArray(data[STORAGE_KEYS.USER_LISTS])
        ? data[STORAGE_KEYS.USER_LISTS]
        : [],
      userListsByYear: data[STORAGE_KEYS.USER_LISTS_BY_YEAR] || {},
      listsLastFetched: data[STORAGE_KEYS.LISTS_LAST_FETCHED] || 0,
      isValid: !!token && !expired,
      isExpired: expired,
    };
  }

  // Export to globalThis for use by other scripts
  globalThis.AuthState = {
    getAuthState,
    validateAndCleanToken,
    clearAllAuthData,
    handleUnauthorized,
    loadFullState,
  };
})();
