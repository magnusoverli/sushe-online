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
            const errorData = await response.json();

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

            if (win) {
              win.location.href = '/login';
            }
            return;
          } catch (parseError) {
            if (parseError.data) {
              throw parseError;
            }
            if (win) {
              win.location.href = '/login';
            }
            return;
          }
        }

        let errorData = null;
        try {
          errorData = await response.json();
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

      return await response.json();
    } catch (error) {
      if (error.name !== 'AbortError') {
        logger.error('API call failed:', error);
      }
      throw error;
    }
  }

  return { apiCall };
}
