

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');


const isRateLimitingDisabled = process.env.DISABLE_RATE_LIMITING === 'true';


const noopMiddleware = (_req, _res, next) => next();


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



const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: parseInt(process.env.RATE_LIMIT_LOGIN_MAX) || 5,
  message: 'Too many login attempts. Please try again later.',
  standardHeaders: true, 
  legacyHeaders: false, 
  skipSuccessfulRequests: false, 
  handler: createRateLimitHandler(
    'Too many login attempts. Please try again in 15 minutes.'
  ),
});



const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, 
  max: parseInt(process.env.RATE_LIMIT_REGISTER_MAX) || 3,
  message: 'Too many registration attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: createRateLimitHandler(
    'Too many registration attempts. Please try again in 1 hour.'
  ),
});



const forgotPasswordRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, 
  max: parseInt(process.env.RATE_LIMIT_FORGOT_MAX) || 3,
  message: 'Too many password reset requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: createRateLimitHandler(
    'Too many password reset requests. Please try again in 1 hour.'
  ),
});



const resetPasswordRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, 
  max: parseInt(process.env.RATE_LIMIT_RESET_MAX) || 5,
  message: 'Too many password reset attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: createRateLimitHandler(
    'Too many password reset attempts. Please try again in 1 hour.'
  ),
});



const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: parseInt(process.env.RATE_LIMIT_API_MAX) || 100,
  message: 'Too many requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: createRateLimitHandler(
    'Too many requests. Please try again in 15 minutes.'
  ),
});



const sensitiveSettingsRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, 
  max: parseInt(process.env.RATE_LIMIT_SETTINGS_MAX) || 10,
  message: 'Too many settings change attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: createRateLimitHandler(
    'Too many settings change attempts. Please try again in 1 hour.'
  ),
});



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
  apiRateLimit: isRateLimitingDisabled ? noopMiddleware : apiRateLimit,
  sensitiveSettingsRateLimit: isRateLimitingDisabled
    ? noopMiddleware
    : sensitiveSettingsRateLimit,
};
