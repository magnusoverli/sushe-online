/**
 * RegisterPage - Dark-themed registration form matching design spec.
 *
 * Features:
 * - Name, email, password, confirm password fields
 * - Client-side validation with field-level errors
 * - Success state showing "awaiting admin approval" message
 * - Link back to login
 */

import { useState, useCallback, useEffect, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { register, initCsrf } from '@/services/auth';
import './auth.css';

interface FieldErrors {
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export function RegisterPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Fetch CSRF token on mount so the register POST can include it.
  useEffect(() => {
    initCsrf().catch(() => {
      // Network error — CSRF will be missing but registration will show a clear error
    });
  }, []);

  const validate = useCallback((): boolean => {
    const errors: FieldErrors = {};

    if (!username.trim()) {
      errors.username = 'Name is required.';
    } else if (username.trim().length < 2) {
      errors.username = 'Name must be at least 2 characters.';
    }

    if (!email.trim()) {
      errors.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'Please enter a valid email address.';
    }

    if (!password) {
      errors.password = 'Password is required.';
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters.';
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Please confirm your password.';
    } else if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [username, email, password, confirmPassword]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setServerError('');

      if (!validate()) return;

      setIsSubmitting(true);
      try {
        await register({
          username: username.trim(),
          email: email.trim(),
          password,
          confirmPassword,
        });
        setIsSuccess(true);
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : 'Registration failed. Please try again.';
        setServerError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [username, email, password, confirmPassword, validate]
  );

  // Success state
  if (isSuccess) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-header">
            <span className="auth-header__eyebrow">Account created</span>
            <h1 className="auth-header__title">Welcome</h1>
          </div>

          <div className="auth-success-banner">
            <span className="auth-success-banner__title">
              Awaiting Approval
            </span>
            <span className="auth-success-banner__message">
              Your account has been created and is pending admin approval. You
              will be able to sign in once approved.
            </span>
          </div>

          <div className="auth-footer">
            <span className="auth-footer__text">
              <Link to="/login" className="auth-footer__link">
                Back to Sign In
              </Link>
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Header */}
        <div className="auth-header">
          <span className="auth-header__eyebrow">Get started</span>
          <h1 className="auth-header__title">Create Account</h1>
          <p className="auth-header__subtitle">
            Fill in the details below to register
          </p>
        </div>

        {/* Server Error Banner */}
        {serverError && (
          <div className="auth-error-banner" role="alert">
            {serverError}
          </div>
        )}

        {/* Form */}
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="auth-field">
            <label className="auth-field__label" htmlFor="register-username">
              Name
            </label>
            <input
              id="register-username"
              className={`auth-field__input${fieldErrors.username ? ' auth-field__input--error' : ''}`}
              type="text"
              placeholder="Your name"
              autoComplete="name"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (fieldErrors.username)
                  setFieldErrors((prev) => ({ ...prev, username: undefined }));
              }}
              disabled={isSubmitting}
            />
            {fieldErrors.username && (
              <span className="auth-field__error">{fieldErrors.username}</span>
            )}
          </div>

          <div className="auth-field">
            <label className="auth-field__label" htmlFor="register-email">
              Email
            </label>
            <input
              id="register-email"
              className={`auth-field__input${fieldErrors.email ? ' auth-field__input--error' : ''}`}
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email)
                  setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }}
              disabled={isSubmitting}
            />
            {fieldErrors.email && (
              <span className="auth-field__error">{fieldErrors.email}</span>
            )}
          </div>

          <div className="auth-field">
            <label className="auth-field__label" htmlFor="register-password">
              Password
            </label>
            <input
              id="register-password"
              className={`auth-field__input${fieldErrors.password ? ' auth-field__input--error' : ''}`}
              type="password"
              placeholder="At least 6 characters"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors.password)
                  setFieldErrors((prev) => ({ ...prev, password: undefined }));
              }}
              disabled={isSubmitting}
            />
            {fieldErrors.password && (
              <span className="auth-field__error">{fieldErrors.password}</span>
            )}
          </div>

          <div className="auth-field">
            <label
              className="auth-field__label"
              htmlFor="register-confirm-password"
            >
              Confirm Password
            </label>
            <input
              id="register-confirm-password"
              className={`auth-field__input${fieldErrors.confirmPassword ? ' auth-field__input--error' : ''}`}
              type="password"
              placeholder="Repeat your password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (fieldErrors.confirmPassword)
                  setFieldErrors((prev) => ({
                    ...prev,
                    confirmPassword: undefined,
                  }));
              }}
              disabled={isSubmitting}
            />
            {fieldErrors.confirmPassword && (
              <span className="auth-field__error">
                {fieldErrors.confirmPassword}
              </span>
            )}
          </div>

          <button type="submit" className="auth-submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating Account...' : 'Create Account'}
          </button>
        </form>

        <div className="auth-divider" />

        {/* Footer */}
        <div className="auth-footer">
          <span className="auth-footer__text">
            Already have an account?{' '}
            <Link to="/login" className="auth-footer__link">
              Sign in
            </Link>
          </span>
        </div>
      </div>
    </div>
  );
}
