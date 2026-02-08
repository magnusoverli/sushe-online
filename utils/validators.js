// validators.js

// Validate email format
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Validate username: 3-30 chars, letters, numbers, underscores
function isValidUsername(username) {
  if (!username) return false;
  if (username.length < 3 || username.length > 30) return false;
  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  return usernameRegex.test(username);
}

// Validate password length (>=8 chars)
function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

// Validate list year (4-digit integer 1000-9999)
// Returns { valid: boolean, value: number | null, error?: string }
function validateYear(year) {
  // null/undefined = no year (valid for optional cases)
  if (year === null || year === undefined || year === '') {
    return { valid: true, value: null };
  }

  // Convert to number if string
  const numYear = typeof year === 'string' ? parseInt(year, 10) : year;

  // Must be a valid integer
  if (!Number.isInteger(numYear)) {
    return { valid: false, value: null, error: 'Year must be a valid integer' };
  }

  // Must be 4-digit year (1000-9999)
  if (numYear < 1000 || numYear > 9999) {
    return {
      valid: false,
      value: null,
      error: 'Year must be between 1000 and 9999',
    };
  }

  return { valid: true, value: numYear };
}

// Validate list ID format (24-char hex string)
// Returns { valid: boolean, error?: string }
function validateListId(listId) {
  if (!listId || typeof listId !== 'string') {
    return { valid: false, error: 'List ID is required' };
  }

  // List IDs are 24-character hex strings (12 random bytes encoded as hex)
  const hexRegex = /^[a-f0-9]{24}$/;
  if (!hexRegex.test(listId)) {
    return { valid: false, error: 'Invalid list ID format' };
  }

  return { valid: true };
}

// Validate list name for creation/renaming
// Returns { valid: boolean, error?: string }
function validateListName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'List name is required' };
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'List name cannot be empty' };
  }

  if (trimmed.length > 200) {
    return {
      valid: false,
      error: 'List name is too long (max 200 characters)',
    };
  }

  return { valid: true, value: trimmed };
}

/**
 * Validate optional string field
 * @param {*} value - Value to validate
 * @param {string} fieldName - Field name for error messages
 * @param {Object} options - Validation options
 * @param {number} [options.maxLength] - Max length
 * @param {number} [options.minLength] - Min length
 * @returns {{valid: boolean, value: string|null, error?: string}}
 */
function validateOptionalString(value, fieldName, options = {}) {
  if (value === null || value === undefined || value === '') {
    return { valid: true, value: null };
  }

  if (typeof value !== 'string') {
    return {
      valid: false,
      value: null,
      error: `${fieldName} must be a string`,
    };
  }

  const { maxLength, minLength } = options;

  if (maxLength && value.length > maxLength) {
    return {
      valid: false,
      value: null,
      error: `${fieldName} exceeds max length of ${maxLength}`,
    };
  }

  if (minLength && value.length < minLength) {
    return {
      valid: false,
      value: null,
      error: `${fieldName} must be at least ${minLength} characters`,
    };
  }

  return { valid: true, value };
}

/**
 * Validate required string field
 * @param {*} value - Value to validate
 * @param {string} fieldName - Field name for error messages
 * @param {Object} options - Validation options
 * @returns {{valid: boolean, value: string|null, error?: string}}
 */
function validateRequiredString(value, fieldName, options = {}) {
  if (!value || typeof value !== 'string') {
    return {
      valid: false,
      value: null,
      error: `${fieldName} is required and must be a string`,
    };
  }

  return validateOptionalString(value, fieldName, options);
}

/**
 * Validate array field
 * @param {*} value - Value to validate
 * @param {string} fieldName - Field name for error messages
 * @param {Object} options - Validation options
 * @param {number} [options.minLength] - Min array length
 * @param {number} [options.maxLength] - Max array length
 * @param {boolean} [options.required] - Is array required
 * @returns {{valid: boolean, value: Array|null, error?: string}}
 */
function validateArray(value, fieldName, options = {}) {
  const { required = false, minLength, maxLength } = options;

  if (value === null || value === undefined) {
    if (required) {
      return { valid: false, value: null, error: `${fieldName} is required` };
    }
    return { valid: true, value: [] };
  }

  if (!Array.isArray(value)) {
    return {
      valid: false,
      value: null,
      error: `${fieldName} must be an array`,
    };
  }

  if (minLength !== undefined && value.length < minLength) {
    return {
      valid: false,
      value: null,
      error: `${fieldName} must have at least ${minLength} items`,
    };
  }

  if (maxLength !== undefined && value.length > maxLength) {
    return {
      valid: false,
      value: null,
      error: `${fieldName} must have at most ${maxLength} items`,
    };
  }

  return { valid: true, value };
}

/**
 * Validate enum value
 * @param {*} value - Value to validate
 * @param {Array} allowedValues - Allowed values
 * @param {string} fieldName - Field name for error messages
 * @param {Object} options - Validation options
 * @param {boolean} [options.required] - Is value required
 * @returns {{valid: boolean, value: *|null, error?: string}}
 */
function validateEnum(value, allowedValues, fieldName, options = {}) {
  const { required = false } = options;

  if (value === null || value === undefined || value === '') {
    if (required) {
      return { valid: false, value: null, error: `${fieldName} is required` };
    }
    return { valid: true, value: null };
  }

  if (!allowedValues.includes(value)) {
    return {
      valid: false,
      value: null,
      error: `Invalid ${fieldName}. Valid values: ${allowedValues.join(', ')}`,
    };
  }

  return { valid: true, value };
}

/**
 * Validate integer field
 * @param {*} value - Value to validate
 * @param {string} fieldName - Field name for error messages
 * @param {Object} options - Validation options
 * @param {number} [options.min] - Minimum value
 * @param {number} [options.max] - Maximum value
 * @param {boolean} [options.required] - Is value required
 * @returns {{valid: boolean, value: number|null, error?: string}}
 */
function validateInteger(value, fieldName, options = {}) {
  const { required = false, min, max } = options;

  if (value === null || value === undefined || value === '') {
    if (required) {
      return { valid: false, value: null, error: `${fieldName} is required` };
    }
    return { valid: true, value: null };
  }

  const numValue = typeof value === 'string' ? parseInt(value, 10) : value;

  if (!Number.isInteger(numValue)) {
    return {
      valid: false,
      value: null,
      error: `${fieldName} must be an integer`,
    };
  }

  if (min !== undefined && numValue < min) {
    return {
      valid: false,
      value: null,
      error: `${fieldName} must be at least ${min}`,
    };
  }

  if (max !== undefined && numValue > max) {
    return {
      valid: false,
      value: null,
      error: `${fieldName} must be at most ${max}`,
    };
  }

  return { valid: true, value: numValue };
}

/**
 * Express middleware factory that checks for required fields in req.body.
 * Returns 400 with a descriptive error message if any field is missing/empty.
 *
 * @param {...string} fields - Field names to require in req.body
 * @returns {Function} Express middleware
 *
 * @example
 *   app.post('/api/foo', requireFields('artist', 'album'), async (req, res) => { ... });
 */
function requireFields(...fields) {
  return (req, res, next) => {
    const missing = fields.filter((f) => !req.body[f]);
    if (missing.length > 0) {
      const label =
        missing.length === 1
          ? `${missing[0]} is required`
          : `${missing.join(' and ')} are required`;
      return res.status(400).json({ error: label });
    }
    next();
  };
}

module.exports = {
  // Existing validators
  isValidEmail,
  isValidUsername,
  isValidPassword,
  validateYear,
  validateListId,
  validateListName,
  // New validators
  validateOptionalString,
  validateRequiredString,
  validateArray,
  validateEnum,
  validateInteger,
  // Middleware
  requireFields,
};
