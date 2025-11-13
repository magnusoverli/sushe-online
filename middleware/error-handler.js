const logger = require('../utils/logger');


const ErrorTypes = {
  VALIDATION: 'VALIDATION_ERROR',
  AUTHENTICATION: 'AUTHENTICATION_ERROR',
  AUTHORIZATION: 'AUTHORIZATION_ERROR',
  NOT_FOUND: 'NOT_FOUND_ERROR',
  DATABASE: 'DATABASE_ERROR',
  EXTERNAL_API: 'EXTERNAL_API_ERROR',
  INTERNAL: 'INTERNAL_ERROR',
};


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


const errorHandler = (err, req, res, _next) => {
  let error = { ...err };
  error.message = err.message;

  
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

  
  if (err.code === '57P01') {
    
    error = new AppError(
      'Database temporarily unavailable',
      503,
      ErrorTypes.DATABASE
    );
  }

  if (err.code === '53300') {
    
    error = new AppError('Database overloaded', 503, ErrorTypes.DATABASE);
  }

  if (err.code === '08006' || err.code === '08001') {
    
    error = new AppError(
      'Database connection failed',
      503,
      ErrorTypes.DATABASE
    );
  }

  if (err.code === '23505') {
    
    error = new AppError('Duplicate data entry', 409, ErrorTypes.VALIDATION);
  }

  if (err.code === '23503') {
    
    error = new AppError(
      'Referenced data not found',
      400,
      ErrorTypes.VALIDATION
    );
  }

  
  if (!error.statusCode) {
    error.statusCode = 500;
    error.type = ErrorTypes.INTERNAL;
  }

  
  const response = {
    success: false,
    error: {
      type: error.type || ErrorTypes.INTERNAL,
      message: error.message || 'Internal Server Error',
      timestamp: error.timestamp || new Date().toISOString(),
    },
  };

  
  if (process.env.NODE_ENV === 'development') {
    response.error.stack = error.stack;
  }

  
  if (req.accepts('json')) {
    return res.status(error.statusCode).json(response);
  }

  
  if (req.flash) {
    req.flash('error', error.message);
    return res.redirect('back');
  }

  
  res.status(error.statusCode).send(error.message);
};


const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};


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
