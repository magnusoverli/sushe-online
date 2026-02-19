/**
 * LoginPage - Dark-themed login form matching design spec typography and colors.
 *
 * Features:
 * - Email/password fields with validation
 * - "Remember me" checkbox
 * - Error handling for invalid credentials, pending approval, rejected accounts
 * - Post-login redirect to Library
 * - Link to registration and forgot password
 */

import { useState, useCallback, useEffect, type FormEvent } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { login, initCsrf } from '@/services/auth';
import { useAppStore } from '@/stores/app-store';
import './auth.css';

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setUser = useAppStore((s) => s.setUser);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch CSRF token on mount so the login POST can include it.
  // initCsrf() calls GET /api/auth/session and extracts the csrfToken
  // regardless of auth status (the server returns it even for 401 responses).
  useEffect(() => {
    initCsrf().catch(() => {
      // Network error — CSRF will be missing but login will show a clear error
    });
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError('');

      if (!email.trim() || !password) {
        setError('Email and password are required.');
        return;
      }

      setIsSubmitting(true);
      try {
        const response = await login({
          email: email.trim(),
          password,
          remember,
        });
        setUser(response.user);
        // Invalidate session query so auth guards pick up the new state
        await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
        navigate({ to: '/' });
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : 'Login failed. Please try again.';
        setError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [email, password, remember, setUser, queryClient, navigate]
  );

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Header */}
        <div className="auth-header">
          <h1 className="auth-header__title">Sign In</h1>
          <p className="auth-header__subtitle">
            Enter your credentials to continue
          </p>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="auth-error-banner" role="alert">
            {error}
          </div>
        )}

        {/* Form */}
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="auth-field">
            <label className="auth-field__label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className={`auth-field__input${error && !email.trim() ? ' auth-field__input--error' : ''}`}
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="auth-field">
            <label className="auth-field__label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              className={`auth-field__input${error && !password ? ' auth-field__input--error' : ''}`}
              type="password"
              placeholder="Your password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <a href="/forgot-password" className="auth-forgot-link">
            Forgot password?
          </a>

          {/* Remember Me */}
          <div
            className="auth-remember"
            role="checkbox"
            aria-checked={remember}
            tabIndex={0}
            onClick={() => setRemember((r) => !r)}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                setRemember((r) => !r);
              }
            }}
          >
            <div
              className={`auth-remember__checkbox${remember ? ' auth-remember__checkbox--checked' : ''}`}
            >
              {remember && (
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <polyline points="2,6 5,9 10,3" />
                </svg>
              )}
            </div>
            <span className="auth-remember__label">Remember me</span>
          </div>

          <button type="submit" className="auth-submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="auth-divider" />

        {/* Footer */}
        <div className="auth-footer">
          <span className="auth-footer__text">
            Don&apos;t have an account?{' '}
            <Link to="/register" className="auth-footer__link">
              Create one
            </Link>
          </span>
        </div>
      </div>
    </div>
  );
}
