/**
 * App API client wrapper for authenticated JSON requests.
 */
import { getListRevision, rememberListRevision } from './list-revisions.js';
import { hasUnsavedLists, protectUnsavedLists } from './unsaved-lists.js';

function sessionExpiredError() {
  return Object.assign(
    new Error(
      'Your session expired. Sign in in another tab, then retry to keep your edits.'
    ),
    { code: 'SESSION_EXPIRED' }
  );
}

export function createAppApiClient(deps = {}) {
  const {
    getRealtimeSyncModuleInstance,
    fetchImpl = fetch,
    win = typeof window !== 'undefined' ? window : null,
    FormDataCtor = typeof FormData !== 'undefined' ? FormData : null,
    logger = console,
  } = deps;
  protectUnsavedLists(win);

  function redirectToLogin() {
    if (hasUnsavedLists()) return;
    if (win) {
      win.location.href = '/login';
    }
  }

  function isLoginRedirectResponse(response) {
    if (!response?.redirected || typeof response.url !== 'string') {
      return false;
    }

    try {
      const baseUrl = win?.location?.href || 'http://localhost';
      return new URL(response.url, baseUrl).pathname === '/login';
    } catch (_error) {
      return response.url.includes('/login');
    }
  }

  async function readJsonResponse(response) {
    if (isLoginRedirectResponse(response)) {
      redirectToLogin();
      throw sessionExpiredError();
    }

    const contentType = response.headers?.get?.('content-type') || '';
    if (
      contentType &&
      !contentType.toLowerCase().includes('application/json')
    ) {
      const error = new Error(
        `Expected JSON response but received ${contentType}`
      );
      error.response = response;
      error.status = response.status;
      error.code = 'NON_JSON_RESPONSE';
      throw error;
    }

    return await response.json();
  }

  function isExpectedServiceAuthError(error) {
    return error?.data?.code === 'NOT_AUTHENTICATED' && !!error.data.service;
  }

  // A 409 that asks the caller to confirm an action (e.g. deleting a collection
  // that still contains lists) is expected control flow, not a failure: the
  // caller handles it by prompting the user, so it must not be logged as an error.
  function isExpectedConfirmationError(error) {
    return error?.requiresConfirmation === true;
  }

  async function apiCall(url, options = {}, csrfRetried = false) {
    try {
      const socketId = getRealtimeSyncModuleInstance()?.getSocket?.()?.id;

      const isFormData =
        FormDataCtor !== null && options.body instanceof FormDataCtor;
      const headers = {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      };

      if (socketId) {
        headers['X-Socket-ID'] = socketId;
      }

      const method = options.method || 'GET';
      const listMatch =
        /^\/api\/lists\/([^/?]+)(?:\/(items|reorder))?(?:\?|$)/.exec(url);
      const listId = listMatch ? decodeURIComponent(listMatch[1]) : null;
      const conditionalWrite =
        listId &&
        (method === 'PUT' ||
          (method === 'PATCH' && listMatch[2] === 'items') ||
          (method === 'POST' && listMatch[2] === 'reorder'));
      if (
        conditionalWrite &&
        getListRevision(listId) !== undefined &&
        !headers['If-Match']
      ) {
        headers['If-Match'] = `"${getListRevision(listId)}"`;
      }
      const csrfToken = win?.csrfToken;
      if (
        csrfToken &&
        (method === 'POST' ||
          method === 'PUT' ||
          method === 'DELETE' ||
          method === 'PATCH')
      ) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      const response = await fetchImpl(url, {
        ...options,
        headers,
        credentials: 'same-origin',
      });

      if (!response.ok) {
        let errorData = null;
        try {
          errorData = await readJsonResponse(response);
        } catch (_parseError) {
          /* Use the HTTP status if the error body is unavailable. */
        }
        if (response.status === 401) {
          if (
            errorData &&
            (errorData.code === 'TOKEN_EXPIRED' ||
              errorData.code === 'TOKEN_REFRESH_FAILED' ||
              (errorData.code === 'NOT_AUTHENTICATED' && errorData.service))
          ) {
            const oauthError = new Error(
              errorData.error || `HTTP error! status: ${response.status}`
            );
            oauthError.response = response;
            oauthError.data = errorData;
            throw oauthError;
          }
          redirectToLogin();
          throw sessionExpiredError();
        }

        if (
          response.status === 403 &&
          errorData?.code === 'CSRF_INVALID' &&
          !csrfRetried
        ) {
          try {
            const refreshed = await fetchImpl('/api/auth/csrf', {
              credentials: 'same-origin',
            });
            if (refreshed.ok) {
              const { csrfToken } = await refreshed.json();
              if (win && typeof csrfToken === 'string' && csrfToken) {
                win.csrfToken = csrfToken;
                return apiCall(url, options, true);
              }
            }
          } catch (_error) {
            /* Keep the original mutation error and its unsaved state. */
          }
        }
        const message =
          typeof errorData?.error === 'string'
            ? errorData.error
            : errorData?.error?.message;
        const error = new Error(
          message || `HTTP error! status: ${response.status}`
        );
        error.response = response;
        error.status = response.status;

        if (errorData) {
          Object.assign(error, errorData);
        }

        throw error;
      }

      const data = await readJsonResponse(response);
      if (listId && method !== 'GET')
        rememberListRevision(
          listId,
          response.headers?.get?.('x-list-revision')
        );
      if (listId && method === 'GET' && Array.isArray(data)) {
        Object.defineProperty(data, '_listRevision', {
          value: response.headers?.get?.('x-list-revision'),
        });
      }
      if (Array.isArray(data?.selectedListItems)) {
        Object.defineProperty(data.selectedListItems, '_listRevision', {
          value: data.selectedListRevision,
        });
      }
      return data;
    } catch (error) {
      if (
        error.name !== 'AbortError' &&
        error.code !== 'SESSION_EXPIRED' &&
        !isExpectedServiceAuthError(error) &&
        !isExpectedConfirmationError(error)
      ) {
        logger.error('API call failed:', error);
      }
      throw error;
    }
  }

  return { apiCall };
}
