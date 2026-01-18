const logger = require('../utils/logger');

// Error types for better categorization
const ErrorTypes = {
  VALIDATION: 'VALIDATION_ERROR',
  AUTHENTICATION: 'AUTHENTICATION_ERROR',
  AUTHORIZATION: 'AUTHORIZATION_ERROR',
  NOT_FOUND: 'NOT_FOUND_ERROR',
  DATABASE: 'DATABASE_ERROR',
  EXTERNAL_API: 'EXTERNAL_API_ERROR',
  INTERNAL: 'INTERNAL_ERROR',
};

// Custom error class for application errors
class AppError extends Error {
  constructor(
    message,
    statusCode = 500,
    type = ErrorTypes.INTERNAL,
    isOperational = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.type = type;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();

    Error.captureStackTrace(this, this.constructor);
  }
}

// Factory function to create error handler with injected logger
function createErrorHandler(log = logger) {
  return (err, req, res, _next) => {
    let error = { ...err };
    error.message = err.message;
    error.stack = err.stack; // Stack is not enumerable, so copy explicitly

    // Log error details with structured format for Loki/Grafana
    log.error('Error occurred', {
      requestId: req.id,
      error: {
        name: err.name || 'Error',
        message: error.message,
        code: err.code,
        stack: error.stack,
      },
      http: {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      },
      user: req.user?._id
        ? { id: req.user._id, username: req.user.username }
        : undefined,
    });

    // Handle specific error types
    if (err.name === 'ValidationError') {
      error = new AppError('Validation Error', 400, ErrorTypes.VALIDATION);
    }

    if (err.name === 'CastError') {
      error = new AppError('Resource not found', 404, ErrorTypes.NOT_FOUND);
    }

    if (err.code === 'EBADCSRFTOKEN') {
      error = new AppError(
        'Invalid CSRF token',
        403,
        ErrorTypes.AUTHENTICATION
      );
    }

    if (err.code === 11000) {
      error = new AppError('Duplicate field value', 400, ErrorTypes.VALIDATION);
    }

    // PostgreSQL connection errors
    if (err.code === 'ECONNREFUSED') {
      error = new AppError(
        'Database connection refused',
        503,
        ErrorTypes.DATABASE
      );
    }

    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
      error = new AppError(
        'Database connection timeout',
        503,
        ErrorTypes.DATABASE
      );
    }

    if (err.code === 'ENOTFOUND') {
      error = new AppError('Database host not found', 503, ErrorTypes.DATABASE);
    }

    // PostgreSQL specific error codes
    if (err.code === '57P01') {
      // PostgreSQL admin shutdown
      error = new AppError(
        'Database temporarily unavailable',
        503,
        ErrorTypes.DATABASE
      );
    }

    if (err.code === '53300') {
      // PostgreSQL too many connections
      error = new AppError('Database overloaded', 503, ErrorTypes.DATABASE);
    }

    if (err.code === '08006' || err.code === '08001') {
      // Connection failure
      error = new AppError(
        'Database connection failed',
        503,
        ErrorTypes.DATABASE
      );
    }

    if (err.code === '23505') {
      // PostgreSQL unique violation
      error = new AppError('Duplicate data entry', 409, ErrorTypes.VALIDATION);
    }

    if (err.code === '23503') {
      // PostgreSQL foreign key violation
      error = new AppError(
        'Referenced data not found',
        400,
        ErrorTypes.VALIDATION
      );
    }

    // Default to 500 server error
    if (!error.statusCode) {
      error.statusCode = 500;
      error.type = ErrorTypes.INTERNAL;
    }

    // Send error response
    const response = {
      success: false,
      error: {
        type: error.type || ErrorTypes.INTERNAL,
        message: error.message || 'Internal Server Error',
        timestamp: error.timestamp || new Date().toISOString(),
      },
    };

    // Include stack trace in development
    if (process.env.NODE_ENV === 'development') {
      response.error.stack = error.stack;
    }

    // Handle different response formats
    if (req.accepts('json')) {
      return res.status(error.statusCode).json(response);
    }

    // For HTML requests, redirect with flash message
    if (req.flash) {
      req.flash('error', error.message);
      return res.redirect('back');
    }

    // Fallback to plain text
    res.status(error.statusCode).send(error.message);
  };
}

// 404 handler
const notFoundHandler = (req, res, next) => {
  const error = new AppError(
    `Route ${req.originalUrl} not found`,
    404,
    ErrorTypes.NOT_FOUND
  );
  next(error);
};

// Default error handler using the real logger
const errorHandler = createErrorHandler();

/**
 * Standard error codes for API responses
 * Used to provide machine-readable error identification
 */
const ErrorCodes = {
  // Authentication/Authorization
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  NOT_CONNECTED: 'NOT_CONNECTED',
  FORBIDDEN: 'FORBIDDEN',
  CSRF_INVALID: 'CSRF_INVALID',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MISSING_FIELD: 'MISSING_FIELD',
  INVALID_INPUT: 'INVALID_INPUT',

  // Resources
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',

  // External Services
  SPOTIFY_ERROR: 'SPOTIFY_ERROR',
  TIDAL_ERROR: 'TIDAL_ERROR',
  LASTFM_ERROR: 'LASTFM_ERROR',
  MUSICBRAINZ_ERROR: 'MUSICBRAINZ_ERROR',
  PREMIUM_REQUIRED: 'PREMIUM_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  NO_DEVICE: 'NO_DEVICE',

  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
};

/**
 * Send a standardized error response
 *
 * New error format:
 * {
 *   success: false,
 *   error: {
 *     message: "Human-readable message",
 *     code: "MACHINE_READABLE_CODE",
 *     type: "ERROR_TYPE" (optional),
 *     service: "spotify" | "tidal" | etc (optional)
 *   }
 * }
 *
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Human-readable error message
 * @param {string} code - Machine-readable error code from ErrorCodes
 * @param {Object} options - Additional options
 * @param {string} options.type - Error type from ErrorTypes
 * @param {string} options.service - Service name (spotify, tidal, etc)
 * @param {*} options.details - Additional error details (dev only)
 */
function sendErrorResponse(res, statusCode, message, code, options = {}) {
  const response = {
    success: false,
    error: {
      message,
      code: code || ErrorCodes.INTERNAL_ERROR,
    },
  };

  // Add optional fields
  if (options.type) {
    response.error.type = options.type;
  }
  if (options.service) {
    response.error.service = options.service;
  }

  // Include details in development
  if (process.env.NODE_ENV === 'development' && options.details) {
    response.error.details = options.details;
  }

  return res.status(statusCode).json(response);
}

/**
 * Create common error response helpers
 * These are convenience functions for frequent error patterns
 */
const errorResponses = {
  // 400 Bad Request
  badRequest: (
    res,
    message = 'Bad request',
    code = ErrorCodes.VALIDATION_ERROR
  ) => sendErrorResponse(res, 400, message, code),

  // 401 Unauthorized
  unauthorized: (
    res,
    message = 'Authentication required',
    code = ErrorCodes.NOT_AUTHENTICATED
  ) => sendErrorResponse(res, 401, message, code),

  // 403 Forbidden
  forbidden: (res, message = 'Access denied', code = ErrorCodes.FORBIDDEN) =>
    sendErrorResponse(res, 403, message, code),

  // 404 Not Found
  notFound: (
    res,
    message = 'Resource not found',
    code = ErrorCodes.NOT_FOUND
  ) => sendErrorResponse(res, 404, message, code),

  // 409 Conflict
  conflict: (res, message = 'Resource conflict', code = ErrorCodes.CONFLICT) =>
    sendErrorResponse(res, 409, message, code),

  // 429 Too Many Requests
  rateLimited: (
    res,
    message = 'Rate limit exceeded',
    code = ErrorCodes.RATE_LIMITED
  ) => sendErrorResponse(res, 429, message, code),

  // 500 Internal Server Error
  internal: (
    res,
    message = 'Internal server error',
    code = ErrorCodes.INTERNAL_ERROR
  ) => sendErrorResponse(res, 500, message, code),

  // 502 Bad Gateway (external API failure)
  badGateway: (res, message = 'External service error', code, options = {}) =>
    sendErrorResponse(
      res,
      502,
      message,
      code || ErrorCodes.INTERNAL_ERROR,
      options
    ),

  // 503 Service Unavailable
  unavailable: (
    res,
    message = 'Service temporarily unavailable',
    code = ErrorCodes.SERVICE_UNAVAILABLE
  ) => sendErrorResponse(res, 503, message, code),

  // Service-specific auth errors
  spotifyAuthError: (res, message, code) =>
    sendErrorResponse(res, 401, message, code, { service: 'spotify' }),

  tidalAuthError: (res, message, code) =>
    sendErrorResponse(res, 401, message, code, { service: 'tidal' }),
};

module.exports = {
  ErrorTypes,
  ErrorCodes,
  AppError,
  createErrorHandler,
  errorHandler,
  notFoundHandler,
  sendErrorResponse,
  errorResponses,
};
