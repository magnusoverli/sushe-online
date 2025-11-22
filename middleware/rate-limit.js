/**
 * Rate Limiting Middleware
 *
 * Implements production-grade rate limiting for authentication and sensitive endpoints.
 * Uses express-rate-limit with configurable limits based on endpoint sensitivity.
 *
 * Best practices:
 * - Strict limits on auth endpoints to prevent brute force
 * - Clear error messages with retry-after headers
 * - Environment-based configuration for flexibility
 * - Backward compatible: works out of the box with sensible defaults
 * - Can be disabled entirely by setting DISABLE_RATE_LIMITING=true
 */

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

// Check if rate limiting is disabled globally
const isRateLimitingDisabled = process.env.DISABLE_RATE_LIMITING === 'true';

// No-op middleware for when rate limiting is disabled
const noopMiddleware = (_req, _res, next) => next();

// Helper to create standardized rate limit handler
function createRateLimitHandler(message) {
  return (_req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: _req.ip,
      path: _req.path,
      message,
    });
    res.status(429).json({
      error: message,
      retryAfter: res.getHeader('Retry-After'),
    });
  };
}

// Strict rate limiting for login attempts
// 5 attempts per 15 minutes per IP
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_LOGIN_MAX) || 5,
  message: 'Too many login attempts. Please try again later.',
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  skipSuccessfulRequests: false, // Count successful requests
  handler: createRateLimitHandler(
    'Too many login attempts. Please try again in 15 minutes.'
  ),
});

// Moderate rate limiting for registration
// 3 attempts per hour per IP (prevents spam registrations)
const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.RATE_LIMIT_REGISTER_MAX) || 3,
  message: 'Too many registration attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: createRateLimitHandler(
    'Too many registration attempts. Please try again in 1 hour.'
  ),
});

// Strict rate limiting for password reset requests
// 5 attempts per hour per IP (prevents email bombing while allowing legitimate typos)
const forgotPasswordRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.RATE_LIMIT_FORGOT_MAX) || 5,
  message: 'Too many password reset requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests - only failed attempts
  handler: createRateLimitHandler(
    'Too many password reset requests. Please try again in 1 hour.'
  ),
});

// Very strict rate limiting for password reset token submission
// 5 attempts per hour per IP (prevents token brute forcing)
const resetPasswordRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.RATE_LIMIT_RESET_MAX) || 5,
  message: 'Too many password reset attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: createRateLimitHandler(
    'Too many password reset attempts. Please try again in 1 hour.'
  ),
});

// Strict rate limiting for sensitive settings changes
// 10 attempts per hour per IP
const sensitiveSettingsRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.RATE_LIMIT_SETTINGS_MAX) || 10,
  message: 'Too many settings change attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: createRateLimitHandler(
    'Too many settings change attempts. Please try again in 1 hour.'
  ),
});

// Export no-op middleware if rate limiting is disabled
// This ensures backward compatibility for existing deployments
module.exports = {
  loginRateLimit: isRateLimitingDisabled ? noopMiddleware : loginRateLimit,
  registerRateLimit: isRateLimitingDisabled
    ? noopMiddleware
    : registerRateLimit,
  forgotPasswordRateLimit: isRateLimitingDisabled
    ? noopMiddleware
    : forgotPasswordRateLimit,
  resetPasswordRateLimit: isRateLimitingDisabled
    ? noopMiddleware
    : resetPasswordRateLimit,
  sensitiveSettingsRateLimit: isRateLimitingDisabled
    ? noopMiddleware
    : sensitiveSettingsRateLimit,
};
