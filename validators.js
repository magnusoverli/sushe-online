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

module.exports = {
  isValidEmail,
  isValidUsername,
  isValidPassword,
  validateYear,
  validateListId,
  validateListName,
};
