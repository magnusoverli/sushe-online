// Shared utility functions for SuShe Online extension
// These are common utilities used across multiple components

(function () {
  const MAX_API_RESPONSE_BYTES = 16 * 1024 * 1024;

  function createSerialQueue() {
    let tail = Promise.resolve();
    return (operation) => {
      const result = tail.then(operation);
      tail = result.catch(() => {});
      return result;
    };
  }

  function sortListYears(groups) {
    return Object.keys(groups).sort((a, b) => {
      if (a === b) return 0;
      if (a === 'Uncategorized') return 1;
      if (b === 'Uncategorized') return -1;
      return Number(b) - Number(a) || a.localeCompare(b);
    });
  }

  function groupLists(lists) {
    const groups = Object.create(null);
    for (const list of lists)
      (groups[list.year || 'Uncategorized'] ||= []).push(list);
    for (const items of Object.values(groups))
      items.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }

  function buildAlbumUrl(apiBase, listId, albumId) {
    if (!apiBase || !listId || !albumId) return null;
    try {
      const url = new URL('/', normalizeApiUrl(apiBase));
      url.searchParams.set('listId', listId);
      url.searchParams.set('albumId', albumId);
      return url.href;
    } catch {
      return null;
    }
  }

  async function readBoundedBody(response, maxBytes, signal) {
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel();
      throw new Error('Response exceeds size limit');
    }
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    const cancel = () => {
      void reader.cancel(signal.reason).catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      for (;;) {
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error('Response exceeds size limit');
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    } finally {
      signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
  }
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
    const {
      signal: callerSignal,
      maxResponseBytes = MAX_API_RESPONSE_BYTES,
      ...fetchOptions
    } = options;
    const cancel = () => controller.abort(callerSignal.reason);
    if (callerSignal?.aborted) cancel();
    else callerSignal?.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);

    try {
      controller.signal.throwIfAborted();
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });
      // Buffer within the same timeout so headers alone cannot end protection.
      const bytes = await readBoundedBody(
        response,
        maxResponseBytes,
        controller.signal
      );
      const buffered = new globalThis.Response(
        [204, 205, 304].includes(response.status) ? null : bytes,
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }
      );
      Object.defineProperty(buffered, 'url', { value: response.url });
      return buffered;
    } catch (error) {
      if (timedOut) {
        throw new Error(`Request timed out after ${timeout / 1000} seconds`, {
          cause: error,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener('abort', cancel);
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
    const errorMsg = String(error.message || '').toLowerCase();
    if (errorMsg.includes('timeout') || errorMsg.includes('timed out'))
      return 'timeout';

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
    if (/\b5\d{2}\b/.test(errorMsg)) {
      return 'server';
    }

    // Client errors (4xx) that aren't auth
    if (errorMsg.includes('400') || errorMsg.includes('404')) {
      return 'client';
    }

    // Unknown error
    return 'unknown';
  }

  /**
   * Show browser notification (auto-dismisses via Chrome's default behavior)
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   */
  function createNotification(options, id) {
    return new Promise((resolve) => {
      const callback = () => {
        const error = chrome.runtime.lastError;
        if (!error) return resolve(true);
        if (options.iconUrl !== 'icons/icon128.png') {
          resolve(
            createNotification({ ...options, iconUrl: 'icons/icon128.png' }, id)
          );
        } else {
          console.warn('Could not show extension notification:', error.message);
          resolve(false);
        }
      };
      if (id) chrome.notifications.create(id, options, callback);
      else chrome.notifications.create(options, callback);
    });
  }

  function showNotification(title, message, id) {
    return createNotification(
      {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: title,
        message: message,
        requireInteraction: false,
        silent: true,
      },
      id
    );
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
  }

  // Export to globalThis for use by other scripts
  globalThis.SharedUtils = {
    createSerialQueue,
    sortListYears,
    groupLists,
    buildAlbumUrl,
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
