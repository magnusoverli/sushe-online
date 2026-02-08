/**
 * Parameter Validation Middleware
 *
 * Reusable middleware for validating common route parameters.
 */

const { validateYear } = require('../utils/validators');

/**
 * Middleware to validate :year route parameter.
 *
 * Parses and validates req.params.year, setting req.validatedYear on success.
 * Returns 400 JSON error if the year is invalid.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 */
function validateYearParam(req, res, next) {
  const result = validateYear(req.params.year);
  if (!result.valid) {
    return res.status(400).json({ error: 'Invalid year' });
  }
  if (result.value === null) {
    return res.status(400).json({ error: 'Invalid year' });
  }
  req.validatedYear = result.value;
  next();
}

module.exports = { validateYearParam };
