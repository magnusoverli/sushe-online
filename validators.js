


function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}


function isValidUsername(username) {
  if (!username) return false;
  if (username.length < 3 || username.length > 30) return false;
  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  return usernameRegex.test(username);
}


function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

module.exports = { isValidEmail, isValidUsername, isValidPassword };
