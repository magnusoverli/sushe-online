// Shared utility functions for SuShe Online extension
// These are common utilities used across multiple components

(function () {
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

  /**
   * Classify fetch errors to provide better user feedback
   * @param {Error} error - The error to classify
   * @returns {string} - Error type: 'network', 'cors', 'auth', 'server', 'client', 'timeout', 'unknown'
   */
  function classifyFetchError(error) {
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
  function showNotification(title, message) {
    chrome.notifications.create({
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

    chrome.notifications.create(options);
    // Let Chrome handle auto-dismiss naturally (progress bar will match timing)
  }

  // Export to globalThis for use by other scripts
  globalThis.SharedUtils = {
    fetchWithTimeout,
    classifyFetchError,
    showNotification,
    showNotificationWithImage,
  };
})();
