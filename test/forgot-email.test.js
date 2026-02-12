/**
 * Tests for utils/forgot-email.js
 * Tests the composeForgotPasswordEmail function
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const { composeForgotPasswordEmail } = require('../utils/forgot-email.js');

// =============================================================================
// composeForgotPasswordEmail tests
// =============================================================================

describe('composeForgotPasswordEmail', () => {
  const originalEnv = process.env.EMAIL_FROM;

  afterEach(() => {
    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.EMAIL_FROM;
    } else {
      process.env.EMAIL_FROM = originalEnv;
    }
  });

  it('should return an object with required email fields', () => {
    const result = composeForgotPasswordEmail(
      'user@example.com',
      'https://example.com/reset/abc123'
    );

    assert.strictEqual(typeof result, 'object');
    assert.ok(result.to, 'should have a "to" field');
    assert.ok(result.from, 'should have a "from" field');
    assert.ok(result.subject, 'should have a "subject" field');
    assert.ok(result.text, 'should have a "text" field');
    assert.ok(result.html, 'should have an "html" field');
  });

  it('should set "to" to the provided email address', () => {
    const email = 'test@domain.com';
    const result = composeForgotPasswordEmail(email, 'https://example.com');

    assert.strictEqual(result.to, email);
  });

  it('should use EMAIL_FROM env var for "from" when set', () => {
    process.env.EMAIL_FROM = 'noreply@myapp.com';
    const result = composeForgotPasswordEmail(
      'user@example.com',
      'https://example.com'
    );

    assert.strictEqual(result.from, 'noreply@myapp.com');
  });

  it('should use default "from" when EMAIL_FROM is not set', () => {
    delete process.env.EMAIL_FROM;
    const result = composeForgotPasswordEmail(
      'user@example.com',
      'https://example.com'
    );

    assert.strictEqual(result.from, 'magnus@overli.dev');
  });

  it('should set subject to password reset message', () => {
    const result = composeForgotPasswordEmail(
      'user@example.com',
      'https://example.com'
    );

    assert.strictEqual(result.subject, 'SuShe Online - Password Reset');
  });

  it('should include the reset URL in the text body', () => {
    const resetUrl = 'https://example.com/reset/token123';
    const result = composeForgotPasswordEmail('user@example.com', resetUrl);

    assert.ok(
      result.text.includes(resetUrl),
      'text body should contain the reset URL'
    );
  });

  it('should include the reset URL in the HTML body', () => {
    const resetUrl = 'https://example.com/reset/token456';
    const result = composeForgotPasswordEmail('user@example.com', resetUrl);

    assert.ok(
      result.html.includes(resetUrl),
      'HTML body should contain the reset URL'
    );
  });

  it('should include reset URL in an anchor tag href in HTML', () => {
    const resetUrl = 'https://example.com/reset/xyz';
    const result = composeForgotPasswordEmail('user@example.com', resetUrl);

    assert.ok(
      result.html.includes(`href="${resetUrl}"`),
      'HTML body should have the reset URL in an href attribute'
    );
  });

  it('should include a warning about ignoring the email in text body', () => {
    const result = composeForgotPasswordEmail(
      'user@example.com',
      'https://example.com'
    );

    assert.ok(
      result.text.includes('did not request'),
      'text body should warn about unsolicited resets'
    );
  });

  it('should include a warning about ignoring the email in HTML body', () => {
    const result = composeForgotPasswordEmail(
      'user@example.com',
      'https://example.com'
    );

    assert.ok(
      result.html.includes('did not request'),
      'HTML body should warn about unsolicited resets'
    );
  });

  it('should include the app name in the HTML body', () => {
    const result = composeForgotPasswordEmail(
      'user@example.com',
      'https://example.com'
    );

    assert.ok(
      result.html.includes('SuShe Online'),
      'HTML body should mention the app name'
    );
  });

  it('should include expiry information in the HTML body', () => {
    const result = composeForgotPasswordEmail(
      'user@example.com',
      'https://example.com'
    );

    assert.ok(
      result.html.includes('expire'),
      'HTML body should mention link expiry'
    );
  });

  it('should produce valid HTML structure', () => {
    const result = composeForgotPasswordEmail(
      'user@example.com',
      'https://example.com'
    );

    assert.ok(result.html.includes('<!DOCTYPE html>'), 'should have doctype');
    assert.ok(result.html.includes('<html>'), 'should have html tag');
    assert.ok(result.html.includes('</html>'), 'should close html tag');
    assert.ok(result.html.includes('<body>'), 'should have body tag');
    assert.ok(result.html.includes('</body>'), 'should close body tag');
  });

  it('should handle special characters in email address', () => {
    const email = 'user+tag@sub.domain.com';
    const result = composeForgotPasswordEmail(email, 'https://example.com');

    assert.strictEqual(result.to, email);
  });

  it('should handle long reset URLs', () => {
    const longToken = 'a'.repeat(200);
    const resetUrl = `https://example.com/reset/${longToken}`;
    const result = composeForgotPasswordEmail('user@example.com', resetUrl);

    assert.ok(result.text.includes(resetUrl));
    assert.ok(result.html.includes(resetUrl));
  });

  it('should include a URL fallback section for copy-paste', () => {
    const result = composeForgotPasswordEmail(
      'user@example.com',
      'https://example.com/reset/abc'
    );

    assert.ok(
      result.html.includes('copy and paste'),
      'HTML body should include copy-paste fallback instructions'
    );
  });

  it('should include inline CSS styling', () => {
    const result = composeForgotPasswordEmail(
      'user@example.com',
      'https://example.com'
    );

    assert.ok(
      result.html.includes('<style>'),
      'HTML body should contain inline styles'
    );
  });
});
