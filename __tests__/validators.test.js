const { isValidEmail, isValidUsername, isValidPassword } = require('../validators');

describe('isValidEmail', () => {
  test('valid email', () => {
    expect(isValidEmail('test@example.com')).toBe(true);
  });
  test('invalid email', () => {
    expect(isValidEmail('bad@com')).toBe(false);
  });
});

describe('isValidUsername', () => {
  test('valid username with underscores', () => {
    expect(isValidUsername('user_name')).toBe(true);
  });
  test('invalid username with spaces', () => {
    expect(isValidUsername('invalid user')).toBe(false);
  });
});

describe('isValidPassword', () => {
  test('valid password length', () => {
    expect(isValidPassword('12345678')).toBe(true);
  });
  test('short password', () => {
    expect(isValidPassword('short')).toBe(false);
  });
});
