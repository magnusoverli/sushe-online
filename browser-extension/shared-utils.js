// Shared utility functions for SuShe Online extension
// These are common utilities used across multiple components

(function () {
  function normalizeApiUrl(value) {
    let url;
    try {
      url = new URL(typeof value === 'string' ? value.trim() : '');
    } catch {
      throw new Error('Enter a valid SuShe Online URL');
    }
    if (
      url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)
      )
    ) {
      throw new Error('Use HTTPS, or HTTP with localhost or 127.0.0.1');
    }
    if (
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'Enter only the instance origin, without credentials, a path, query or fragment'
      );
    }
    return url.origin;
  }

  async function sendCheckedMessage(action, data = {}) {
    const response = await chrome.runtime.sendMessage({ ...data, action });
    if (!response?.success) {
      throw new Error(
        response?.error ||
          'The extension did not complete the request. Please try again.'
      );
    }
    return response;
  }

  /**
   * Fetch with timeout wrapper to prevent hung requests
   * @param {string} url - The URL to fetch
   * @param {Object} options - Fetch options
   * @param {number} timeout - Timeout in milliseconds (default: 30000)
   * @returns {Promise<Response>}
   */
  async function fetchWithTimeout(url, options = {}, timeout = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeout / 1000} seconds`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  function fetchApiWithTimeout(url, options = {}, timeout = 30000) {
    // Chromium host permissions can attach website cookies even with
    // same-origin credentials. SuShe API calls use explicit bearer auth only.
    return fetchWithTimeout(url, { ...options, credentials: 'omit' }, timeout);
  }

  async function readApiError(response, defaultMessage = 'API request failed') {
    let data;
    try {
      data = await response.json();
    } catch {
      // Proxies may return HTML or an empty body instead of the API envelope.
    }
    const message =
      typeof data?.error === 'string' ? data.error : data?.error?.message;
    const error = new Error(
      typeof message === 'string' && message.trim()
        ? message
        : `${defaultMessage} (HTTP ${response.status})`
    );
    error.status = response.status;
    if (typeof data?.code === 'string') error.code = data.code;
    return error;
  }

  /**
   * Classify fetch errors to provide better user feedback
   * @param {Error} error - The error to classify
   * @returns {string} - Error type: 'network', 'cors', 'auth', 'server', 'client', 'timeout', 'unknown'
   */
  function classifyFetchError(error) {
    if (error.status === 401) return 'auth';
    if (error.status >= 500) return 'server';
    if (error.status >= 400) return 'client';
    const errorMsg = error.message.toLowerCase();

    // Network connectivity issues
    if (
      errorMsg.includes('failed to fetch') ||
      errorMsg.includes('network request failed') ||
      errorMsg.includes('networkerror') ||
      errorMsg.includes('network error')
    ) {
      return 'network';
    }

    // CORS issues (usually appear as fetch failures)
    if (errorMsg.includes('cors') || errorMsg.includes('cross-origin')) {
      return 'cors';
    }

    // Authentication issues
    if (
      errorMsg.includes('401') ||
      errorMsg.includes('unauthorized') ||
      errorMsg.includes('not authenticated')
    ) {
      return 'auth';
    }

    // Server errors (5xx)
    if (errorMsg.includes('500') || errorMsg.includes('50')) {
      return 'server';
    }

    // Client errors (4xx) that aren't auth
    if (errorMsg.includes('400') || errorMsg.includes('404')) {
      return 'client';
    }

    // Timeout errors
    if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
      return 'timeout';
    }

    // Unknown error
    return 'unknown';
  }

  /**
   * Show browser notification (auto-dismisses via Chrome's default behavior)
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   */
  function createNotification(options) {
    return new Promise((resolve) => {
      chrome.notifications.create(options, () => {
        resolve();
      });
    });
  }

  function showNotification(title, message) {
    return createNotification({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: title,
      message: message,
      requireInteraction: false,
      silent: true,
    });
    // Let Chrome handle auto-dismiss naturally (progress bar will match timing)
  }

  /**
   * Show browser notification with custom image (auto-dismisses via Chrome's default behavior)
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {string} imageUrl - URL for the notification icon
   * @param {string} contextMessage - Optional gray subtitle text (appears below message)
   */
  function showNotificationWithImage(title, message, imageUrl, contextMessage) {
    const options = {
      type: 'basic',
      iconUrl: imageUrl,
      title: title,
      message: message,
      requireInteraction: false,
      silent: true,
    };

    // Add contextMessage if provided (appears as gray text below main message)
    if (contextMessage) {
      options.contextMessage = contextMessage;
    }

    return createNotification(options);
    // Let Chrome handle auto-dismiss naturally (progress bar will match timing)
  }

  // Export to globalThis for use by other scripts
  globalThis.SharedUtils = {
    normalizeApiUrl,
    sendCheckedMessage,
    fetchWithTimeout,
    fetchApiWithTimeout,
    readApiError,
    classifyFetchError,
    showNotification,
    showNotificationWithImage,
  };
})();
