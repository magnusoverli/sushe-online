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

// Error handler middleware
const errorHandler = (err, req, res, _next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error details
  logger.error('Error occurred:', {
    message: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?._id,
    timestamp: new Date().toISOString(),
  });

  // Handle specific error types
  if (err.name === 'ValidationError') {
    error = new AppError('Validation Error', 400, ErrorTypes.VALIDATION);
  }

  if (err.name === 'CastError') {
    error = new AppError('Resource not found', 404, ErrorTypes.NOT_FOUND);
  }

  if (err.code === 'EBADCSRFTOKEN') {
    error = new AppError('Invalid CSRF token', 403, ErrorTypes.AUTHENTICATION);
  }

  if (err.code === 11000) {
    error = new AppError('Duplicate field value', 400, ErrorTypes.VALIDATION);
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

// Async error wrapper to catch async errors
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// 404 handler
const notFoundHandler = (req, res, next) => {
  const error = new AppError(
    `Route ${req.originalUrl} not found`,
    404,
    ErrorTypes.NOT_FOUND
  );
  next(error);
};

module.exports = {
  AppError,
  ErrorTypes,
  errorHandler,
  asyncHandler,
  notFoundHandler,
};
