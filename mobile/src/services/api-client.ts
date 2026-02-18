/**
 * API Client - Fetch wrapper with session auth and CSRF handling.
 *
 * The mobile SPA uses same-origin session cookies for auth.
 * CSRF tokens are fetched from /api/auth/session and sent via X-CSRF-Token header.
 */

import type { ApiErrorResponse } from '@/lib/types';

let csrfToken: string | null = null;

/**
 * Set the CSRF token (obtained from session check or login response).
 */
export function setCsrfToken(token: string): void {
  csrfToken = token;
}

/**
 * Get the current CSRF token.
 */
export function getCsrfToken(): string | null {
  return csrfToken;
}

/**
 * Normalized API error class.
 */
export class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

/**
 * Core fetch wrapper. Handles:
 * - Same-origin credentials (session cookies)
 * - CSRF token header on mutations
 * - JSON request/response normalization
 * - Error normalization
 */
export async function apiFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  // Add CSRF token for mutating requests
  if (
    csrfToken &&
    (method === 'POST' ||
      method === 'PUT' ||
      method === 'DELETE' ||
      method === 'PATCH')
  ) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  // Default to JSON content type for requests with body
  if (
    options.body &&
    typeof options.body === 'string' &&
    !headers['Content-Type']
  ) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    method,
    headers,
    credentials: 'same-origin',
  });

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  // Try to parse JSON response
  let data: T;
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    data = await response.json();
  } else {
    // Non-JSON response (e.g., binary image data)
    data = (await response.blob()) as T;
  }

  if (!response.ok) {
    const errorData = data as unknown as ApiErrorResponse;
    const errorField = errorData?.error;
    let message: string;
    if (typeof errorField === 'string') {
      message = errorField;
    } else if (
      errorField &&
      typeof errorField === 'object' &&
      'message' in errorField
    ) {
      message = errorField.message;
    } else {
      message = `Request failed with status ${response.status}`;
    }
    throw new ApiRequestError(message, response.status);
  }

  return data;
}

/**
 * Convenience methods for common HTTP verbs.
 */
export const api = {
  get<T>(url: string): Promise<T> {
    return apiFetch<T>(url);
  },

  post<T>(url: string, body?: unknown): Promise<T> {
    return apiFetch<T>(url, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  put<T>(url: string, body?: unknown): Promise<T> {
    return apiFetch<T>(url, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  patch<T>(url: string, body?: unknown): Promise<T> {
    return apiFetch<T>(url, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  delete<T>(url: string, body?: unknown): Promise<T> {
    return apiFetch<T>(url, {
      method: 'DELETE',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },
};
