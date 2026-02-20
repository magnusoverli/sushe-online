/**
 * Auth Service - Login, register, session management.
 *
 * Uses the JSON auth API endpoints added for the mobile SPA.
 */

import { api, setCsrfToken } from './api-client';
import type { AuthSession } from '@/lib/types';

/**
 * Check the current session status.
 * Returns user info + CSRF token if authenticated, or 401.
 */
export async function checkSession(): Promise<AuthSession> {
  const session = await api.get<AuthSession>('/api/auth/session');
  if (session.csrfToken) {
    setCsrfToken(session.csrfToken);
  }
  return session;
}

/**
 * Initialize CSRF token from the session endpoint.
 * Works for both authenticated and unauthenticated users.
 *
 * Unlike checkSession(), this does NOT throw on 401 — it always extracts
 * the csrfToken from the response body regardless of HTTP status,
 * since the server includes csrfToken even in unauthenticated 401 responses.
 */
export async function initCsrf(): Promise<void> {
  const response = await fetch('/api/auth/session', {
    credentials: 'same-origin',
  });
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    const data = await response.json();
    if (data.csrfToken) {
      setCsrfToken(data.csrfToken);
    }
  }
}

export interface LoginRequest {
  email: string;
  password: string;
  remember?: boolean;
}

export interface LoginResponse {
  success: boolean;
  user: AuthSession['user'];
  csrfToken: string;
}

/**
 * Log in with email and password.
 */
export async function login(data: LoginRequest): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/api/auth/login', data);
  if (response.csrfToken) {
    setCsrfToken(response.csrfToken);
  }
  return response;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
  adminCode?: string;
}

export interface RegisterResponse {
  success: boolean;
  message: string;
}

/**
 * Register a new account.
 */
export async function register(
  data: RegisterRequest
): Promise<RegisterResponse> {
  return api.post<RegisterResponse>('/api/auth/register', data);
}

/**
 * Log out the current session.
 */
export async function logout(): Promise<void> {
  await api.post('/api/auth/logout');
  setCsrfToken('');
}
