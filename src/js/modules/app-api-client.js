/**
 * App API client wrapper for authenticated JSON requests.
 */
export function createAppApiClient(deps = {}) {
  const {
    getRealtimeSyncModuleInstance,
    fetchImpl = fetch,
    win = typeof window !== 'undefined' ? window : null,
    FormDataCtor = typeof FormData !== 'undefined' ? FormData : null,
    logger = console,
  } = deps;

  function redirectToLogin() {
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
      return undefined;
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

  async function apiCall(url, options = {}) {
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
        if (response.status === 401) {
          try {
            const errorData = await readJsonResponse(response);

            if (!errorData) {
              return;
            }

            if (
              errorData.code === 'TOKEN_EXPIRED' ||
              errorData.code === 'TOKEN_REFRESH_FAILED' ||
              (errorData.code === 'NOT_AUTHENTICATED' && errorData.service)
            ) {
              const oauthError = new Error(
                errorData.error || `HTTP error! status: ${response.status}`
              );
              oauthError.response = response;
              oauthError.data = errorData;
              throw oauthError;
            }

            redirectToLogin();
            return;
          } catch (parseError) {
            if (parseError.data) {
              throw parseError;
            }
            redirectToLogin();
            return;
          }
        }

        let errorData = null;
        try {
          errorData = await readJsonResponse(response);
        } catch (_parseError) {
          // Ignore parse failure and throw generic error below.
        }

        const error = new Error(
          errorData?.error || `HTTP error! status: ${response.status}`
        );
        error.response = response;
        error.status = response.status;

        if (errorData) {
          Object.assign(error, errorData);
        }

        throw error;
      }

      return await readJsonResponse(response);
    } catch (error) {
      if (
        error.name !== 'AbortError' &&
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
