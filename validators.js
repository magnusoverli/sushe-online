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

module.exports = { isValidEmail, isValidUsername, isValidPassword };
