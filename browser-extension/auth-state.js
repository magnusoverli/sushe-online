// Centralized authentication state management for SuShe Online extension
// This module provides a single source of truth for authentication state
// All components should use these functions instead of maintaining their own state

(function () {
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
    'authToken',
    'tokenExpiresAt',
    'userLists',
    'userListsByYear',
    'listsLastFetched',
    'hasEverAuthenticated',
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
      'authToken',
      'tokenExpiresAt',
      'apiUrl',
    ]);

    const token = data.authToken || null;
    const expiresAt = data.tokenExpiresAt || null;
    const apiUrl = data.apiUrl || null;
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
   * Check if user is authenticated with optional API validation
   * @param {Object} options - Options for authentication check
   * @param {boolean} options.validateWithApi - If true, validates token with server (slower but more accurate)
   * @returns {Promise<{authenticated: boolean, reason?: string, token?: string}>}
   */
  async function isAuthenticated(options = { validateWithApi: false }) {
    const state = await getAuthState();

    // Step 1: Token exists?
    if (!state.token) {
      return { authenticated: false, reason: 'no_token' };
    }

    // Step 2: Token not expired?
    if (state.isExpired) {
      // Proactively clear expired token
      await clearAllAuthData();
      return { authenticated: false, reason: 'expired' };
    }

    // Step 3: API validation (optional, for high-stakes operations)
    if (options.validateWithApi && state.apiUrl) {
      try {
        const response = await fetch(`${state.apiUrl}/api/lists`, {
          headers: {
            Authorization: `Bearer ${state.token}`,
            Accept: 'application/json',
          },
        });

        if (response.status === 401) {
          await clearAllAuthData();
          return { authenticated: false, reason: 'invalid_token' };
        }
      } catch (e) {
        // Network error - trust local state, don't clear auth
        console.warn('Could not validate token with API:', e.message);
      }
    }

    return { authenticated: true, token: state.token };
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
   * Get authorization headers for API requests
   * Checks token validity before returning headers
   * @returns {Promise<{headers: Object, valid: boolean, reason?: string}>}
   */
  async function getAuthHeaders() {
    const validation = await validateAndCleanToken();

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    if (validation.valid && validation.token) {
      headers['Authorization'] = `Bearer ${validation.token}`;
      return { headers, valid: true };
    }

    return { headers, valid: false, reason: validation.reason };
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
      'apiUrl',
      'authToken',
      'tokenExpiresAt',
      'userLists',
      'userListsByYear',
      'listsLastFetched',
    ]);

    const token = data.authToken || null;
    const expiresAt = data.tokenExpiresAt || null;
    const expired = isTokenExpired(expiresAt);

    // If token is expired, don't return it as valid
    if (token && expired) {
      console.log(
        'Token expired during state load, will clear on next operation'
      );
    }

    return {
      apiUrl: data.apiUrl || null,
      authToken: expired ? null : token,
      tokenExpiresAt: expiresAt,
      userLists: Array.isArray(data.userLists) ? data.userLists : [],
      userListsByYear: data.userListsByYear || {},
      listsLastFetched: data.listsLastFetched || 0,
      isValid: !!token && !expired,
      isExpired: expired,
    };
  }

  // Export to globalThis for use by other scripts
  globalThis.AuthState = {
    getAuthState,
    isAuthenticated,
    validateAndCleanToken,
    clearAllAuthData,
    getAuthHeaders,
    handleUnauthorized,
    loadFullState,
    isTokenExpired,
    AUTH_STORAGE_KEYS,
  };
})();
