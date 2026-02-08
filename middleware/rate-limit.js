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

/**
 * Factory to create a rate limiter with shared defaults.
 * @param {Object} options - Rate limiter options
 * @param {number} options.windowMs - Time window in ms
 * @param {string} options.envVar - Environment variable name for max
 * @param {number} options.defaultMax - Default max requests
 * @param {string} options.handlerMessage - Message for the 429 handler
 * @param {boolean} [options.skipSuccessfulRequests=false] - Skip counting successful requests
 * @param {boolean} [options.skipFailedRequests=false] - Skip counting failed requests
 * @returns {Function} Rate limit middleware (or noop if disabled)
 */
function createRateLimiter({
  windowMs,
  envVar,
  defaultMax,
  handlerMessage,
  skipSuccessfulRequests = false,
  skipFailedRequests = false,
}) {
  if (isRateLimitingDisabled) return noopMiddleware;

  return rateLimit({
    windowMs,
    max: parseInt(process.env[envVar]) || defaultMax,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    skipFailedRequests,
    handler: createRateLimitHandler(handlerMessage),
  });
}

// Strict rate limiting for login attempts - 5 attempts per 15 minutes per IP
const loginRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  envVar: 'RATE_LIMIT_LOGIN_MAX',
  defaultMax: 5,
  handlerMessage: 'Too many login attempts. Please try again in 15 minutes.',
});

// Moderate rate limiting for registration - 10 successful attempts per hour per IP
const registerRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  envVar: 'RATE_LIMIT_REGISTER_MAX',
  defaultMax: 10,
  handlerMessage: 'Too many registration attempts. Please try again in 1 hour.',
  skipFailedRequests: true,
});

// Strict rate limiting for password reset requests - 5 attempts per hour per IP
const forgotPasswordRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  envVar: 'RATE_LIMIT_FORGOT_MAX',
  defaultMax: 5,
  handlerMessage:
    'Too many password reset requests. Please try again in 1 hour.',
  skipSuccessfulRequests: true,
});

// Very strict rate limiting for password reset token submission - 5 attempts per hour per IP
const resetPasswordRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  envVar: 'RATE_LIMIT_RESET_MAX',
  defaultMax: 5,
  handlerMessage:
    'Too many password reset attempts. Please try again in 1 hour.',
});

// Strict rate limiting for sensitive settings changes - 10 attempts per hour per IP
const sensitiveSettingsRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  envVar: 'RATE_LIMIT_SETTINGS_MAX',
  defaultMax: 10,
  handlerMessage:
    'Too many settings change attempts. Please try again in 1 hour.',
});

module.exports = {
  loginRateLimit,
  registerRateLimit,
  forgotPasswordRateLimit,
  resetPasswordRateLimit,
  sensitiveSettingsRateLimit,
  createRateLimiter,
};
