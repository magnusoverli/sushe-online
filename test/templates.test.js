/**
 * Tests for templates.js utility functions
 * Tests formatDate, formatDateTime, and asset functions
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

describe('templates utilities', () => {
  let templates;
  let originalAssetVersion;

  before(() => {
    // Save original env value
    originalAssetVersion = process.env.ASSET_VERSION;
    // Set a known value for testing
    process.env.ASSET_VERSION = 'test-version-123';
    // Clear module cache to reload with new env
    delete require.cache[require.resolve('../templates.js')];
    templates = require('../templates.js');
  });

  after(() => {
    // Restore original env value
    if (originalAssetVersion !== undefined) {
      process.env.ASSET_VERSION = originalAssetVersion;
    } else {
      delete process.env.ASSET_VERSION;
    }
  });

  describe('formatDate', () => {
    it('should return empty string for null date', () => {
      assert.strictEqual(templates.formatDate(null), '');
    });

    it('should return empty string for undefined date', () => {
      assert.strictEqual(templates.formatDate(undefined), '');
    });

    it('should return empty string for empty string date', () => {
      assert.strictEqual(templates.formatDate(''), '');
    });

    it('should return empty string for zero', () => {
      // 0 is falsy, should return empty string
      assert.strictEqual(templates.formatDate(0), '');
    });

    it('should format date in MM/DD/YYYY format by default (US locale)', () => {
      const date = new Date('2024-03-15T12:00:00Z');
      const result = templates.formatDate(date);
      // US locale: month/day/year
      assert.ok(result.includes('3') || result.includes('03'));
      assert.ok(result.includes('15'));
      assert.ok(result.includes('2024'));
    });

    it('should format date in MM/DD/YYYY format when explicitly specified', () => {
      const date = new Date('2024-12-25T12:00:00Z');
      const result = templates.formatDate(date, 'MM/DD/YYYY');
      // Should use en-US locale
      assert.ok(result.includes('12'));
      assert.ok(result.includes('25'));
      assert.ok(result.includes('2024'));
    });

    it('should format date in DD/MM/YYYY format (UK locale)', () => {
      const date = new Date('2024-03-15T12:00:00Z');
      const result = templates.formatDate(date, 'DD/MM/YYYY');
      // UK locale: day/month/year
      assert.ok(result.includes('15'));
      assert.ok(result.includes('2024'));
    });

    it('should handle date string input', () => {
      const result = templates.formatDate('2024-06-20');
      assert.ok(result.includes('2024'));
      assert.ok(result.includes('20') || result.includes('19')); // timezone may shift day
    });

    it('should handle timestamp number input', () => {
      const timestamp = new Date('2024-01-01T00:00:00Z').getTime();
      const result = templates.formatDate(timestamp);
      assert.ok(result.includes('2024'));
    });

    it('should handle ISO string input', () => {
      const result = templates.formatDate('2024-07-04T10:30:00.000Z');
      assert.ok(result.includes('2024'));
    });
  });

  describe('formatDateTime', () => {
    it('should return empty string for null date', () => {
      assert.strictEqual(templates.formatDateTime(null, true), '');
    });

    it('should return empty string for undefined date', () => {
      assert.strictEqual(templates.formatDateTime(undefined, false), '');
    });

    it('should return empty string for empty string date', () => {
      assert.strictEqual(templates.formatDateTime('', true), '');
    });

    it('should return empty string for zero', () => {
      assert.strictEqual(templates.formatDateTime(0, true), '');
    });

    it('should format datetime with 12-hour format when hour12 is true', () => {
      const date = new Date('2024-03-15T14:30:00Z');
      const result = templates.formatDateTime(date, true);
      // 12-hour format should have AM/PM
      assert.ok(
        result.toLowerCase().includes('am') ||
          result.toLowerCase().includes('pm'),
        `Expected AM/PM in result: ${result}`
      );
    });

    it('should format datetime with 24-hour format when hour12 is false', () => {
      const date = new Date('2024-03-15T14:30:00Z');
      const result = templates.formatDateTime(date, false);
      // Should contain the time portion
      assert.ok(result.includes(':'), `Expected colon in time: ${result}`);
    });

    it('should use US locale by default (MM/DD/YYYY format)', () => {
      const date = new Date('2024-03-15T14:30:00Z');
      const result = templates.formatDateTime(date, true, 'MM/DD/YYYY');
      // US format: month comes before day
      assert.ok(result.includes('2024'));
    });

    it('should use UK locale for DD/MM/YYYY format', () => {
      const date = new Date('2024-03-15T14:30:00Z');
      const result = templates.formatDateTime(date, true, 'DD/MM/YYYY');
      // UK format
      assert.ok(result.includes('2024'));
    });

    it('should include hours and minutes', () => {
      const date = new Date('2024-03-15T09:45:00Z');
      const result = templates.formatDateTime(date, false);
      // Should have time component with colon
      assert.ok(result.includes(':'), `Expected time separator: ${result}`);
    });

    it('should handle date string input', () => {
      const result = templates.formatDateTime('2024-06-20T15:00:00Z', true);
      assert.ok(result.includes('2024'));
      assert.ok(result.includes(':'));
    });

    it('should handle timestamp number input', () => {
      const timestamp = new Date('2024-01-01T12:00:00Z').getTime();
      const result = templates.formatDateTime(timestamp, false);
      assert.ok(result.includes('2024'));
    });

    it('should default to MM/DD/YYYY format when format not specified', () => {
      const date = new Date('2024-03-15T14:30:00Z');
      // Third param defaults to 'MM/DD/YYYY'
      const result = templates.formatDateTime(date, true);
      assert.ok(result.includes('2024'));
    });
  });

  describe('asset', () => {
    it('should append version query parameter to path', () => {
      const result = templates.asset('/styles/main.css');
      assert.strictEqual(result, '/styles/main.css?v=test-version-123');
    });

    it('should work with js files', () => {
      const result = templates.asset('/js/bundle.js');
      assert.strictEqual(result, '/js/bundle.js?v=test-version-123');
    });

    it('should work with paths without leading slash', () => {
      const result = templates.asset('images/logo.png');
      assert.strictEqual(result, 'images/logo.png?v=test-version-123');
    });

    it('should handle empty path', () => {
      const result = templates.asset('');
      assert.strictEqual(result, '?v=test-version-123');
    });

    it('should handle paths with existing query params', () => {
      // Note: this appends another query param (may not be ideal but testing current behavior)
      const result = templates.asset('/file.js?existing=param');
      assert.strictEqual(result, '/file.js?existing=param?v=test-version-123');
    });

    it('should handle deep nested paths', () => {
      const result = templates.asset('/assets/icons/ui/arrow.svg');
      assert.strictEqual(
        result,
        '/assets/icons/ui/arrow.svg?v=test-version-123'
      );
    });

    it('should handle paths with dots', () => {
      const result = templates.asset('/styles/app.min.css');
      assert.strictEqual(result, '/styles/app.min.css?v=test-version-123');
    });
  });

  describe('asset with default version', () => {
    it('should use Date.now() when ASSET_VERSION not set', async () => {
      // Clear the module cache
      delete require.cache[require.resolve('../templates.js')];

      // Remove ASSET_VERSION
      const savedVersion = process.env.ASSET_VERSION;
      delete process.env.ASSET_VERSION;

      // Reload module
      const freshTemplates = require('../templates.js');

      const result = freshTemplates.asset('/test.js');

      // Should have a numeric timestamp version
      const match = result.match(/\?v=(\d+)$/);
      assert.ok(match, `Expected numeric version, got: ${result}`);

      const version = parseInt(match[1], 10);
      const now = Date.now();
      // Version should be a recent timestamp (within last minute)
      assert.ok(version > now - 60000, 'Version should be recent timestamp');
      assert.ok(version <= now, 'Version should not be in the future');

      // Restore
      process.env.ASSET_VERSION = savedVersion;
      delete require.cache[require.resolve('../templates.js')];
    });
  });

  describe('htmlTemplate', () => {
    it('should wrap content in layout', () => {
      const content = '<div>Test Content</div>';
      const result = templates.htmlTemplate(content);

      assert.ok(typeof result === 'string');
      assert.ok(result.includes('Test Content'));
      assert.ok(result.includes('<!DOCTYPE html>'));
      assert.ok(result.includes('<html'));
      assert.ok(result.includes('</html>'));
    });

    it('should use custom title', () => {
      const result = templates.htmlTemplate(
        '<div>Content</div>',
        'Custom Title'
      );

      assert.ok(result.includes('Custom Title'));
    });

    it('should use default title when not provided', () => {
      const result = templates.htmlTemplate('<div>Content</div>');

      assert.ok(result.includes('SuShe Auth'));
    });

    it('should pass user data to layout', () => {
      const user = { username: 'testuser', email: 'test@example.com' };
      const result = templates.htmlTemplate(
        '<div>Content</div>',
        'Title',
        user
      );

      // The template should have user context available
      assert.ok(typeof result === 'string');
      assert.ok(result.length > 0);
    });

    it('should include asset helper functions', () => {
      const result = templates.htmlTemplate('<div>Content</div>');

      // Should have versioned assets
      assert.ok(result.includes('?v='));
    });
  });

  describe('registerTemplate', () => {
    let mockReq;
    let mockFlash;

    before(() => {
      mockReq = {
        csrfToken: () => 'test-csrf-token-123',
      };
      mockFlash = { error: [], info: [] };
    });

    it('should render registration form', () => {
      const result = templates.registerTemplate(mockReq, mockFlash);

      assert.ok(typeof result === 'string');
      assert.ok(result.includes('Join SuShe Online'));
      assert.ok(result.includes('form'));
      assert.ok(result.includes('method="post"'));
      assert.ok(result.includes('action="/register"'));
    });

    it('should include CSRF token', () => {
      const result = templates.registerTemplate(mockReq, mockFlash);

      assert.ok(result.includes('_csrf'));
      assert.ok(result.includes('test-csrf-token-123'));
    });

    it('should include email field', () => {
      const result = templates.registerTemplate(mockReq, mockFlash);

      assert.ok(result.includes('name="email"'));
      assert.ok(result.includes('type="email"'));
      assert.ok(result.includes('Email Address'));
    });

    it('should include username field', () => {
      const result = templates.registerTemplate(mockReq, mockFlash);

      assert.ok(result.includes('name="username"'));
      assert.ok(result.includes('type="text"'));
      assert.ok(result.includes('Username'));
    });

    it('should include password field', () => {
      const result = templates.registerTemplate(mockReq, mockFlash);

      assert.ok(result.includes('name="password"'));
      assert.ok(result.includes('type="password"'));
      assert.ok(result.includes('Password'));
    });

    it('should include confirm password field', () => {
      const result = templates.registerTemplate(mockReq, mockFlash);

      assert.ok(result.includes('name="confirmPassword"'));
      assert.ok(result.includes('Confirm Password'));
    });

    it('should include submit button', () => {
      const result = templates.registerTemplate(mockReq, mockFlash);

      assert.ok(result.includes('type="submit"'));
      assert.ok(result.includes('Create Account'));
    });

    it('should display error flash message', () => {
      const flashWithError = { error: ['Registration failed'], info: [] };
      const result = templates.registerTemplate(mockReq, flashWithError);

      assert.ok(result.includes('Registration failed'));
      assert.ok(result.includes('text-red-500'));
    });

    it('should not display error when flash is empty', () => {
      const result = templates.registerTemplate(mockReq, mockFlash);

      // Should not have error message paragraph when no error
      assert.ok(!result.includes('flash-message'));
    });

    it('should include link to login', () => {
      const result = templates.registerTemplate(mockReq, mockFlash);

      assert.ok(result.includes('href="/login"'));
      assert.ok(result.includes('Return to login'));
    });
  });

  describe('loginTemplate', () => {
    let mockReq;
    let mockFlash;

    before(() => {
      mockReq = {
        csrfToken: () => 'test-csrf-token-456',
        session: {
          attemptedEmail: null,
        },
      };
      mockFlash = { error: [], info: [] };
    });

    it('should render login form', () => {
      const result = templates.loginTemplate(mockReq, mockFlash);

      assert.ok(typeof result === 'string');
      assert.ok(result.includes('form'));
      assert.ok(result.includes('action="/login"'));
    });

    it('should include CSRF token', () => {
      const result = templates.loginTemplate(mockReq, mockFlash);

      assert.ok(result.includes('test-csrf-token-456'));
    });

    it('should include email field', () => {
      const result = templates.loginTemplate(mockReq, mockFlash);

      assert.ok(result.includes('name="email"'));
      assert.ok(result.includes('type="email"'));
    });

    it('should include password field', () => {
      const result = templates.loginTemplate(mockReq, mockFlash);

      assert.ok(result.includes('name="password"'));
      assert.ok(result.includes('type="password"'));
    });

    it('should pre-fill attemptedEmail from session', () => {
      const reqWithEmail = {
        csrfToken: () => 'csrf',
        session: { attemptedEmail: 'test@example.com' },
      };
      const result = templates.loginTemplate(reqWithEmail, mockFlash);

      assert.ok(result.includes('test@example.com'));
    });

    it('should handle missing attemptedEmail in session', () => {
      const result = templates.loginTemplate(mockReq, mockFlash);

      assert.ok(typeof result === 'string');
      assert.ok(result.includes('Email'));
    });
  });

  describe('forgotPasswordTemplate', () => {
    let mockReq;
    let mockFlash;

    before(() => {
      mockReq = {
        csrfToken: () => 'test-csrf-token-789',
      };
      mockFlash = { error: [], info: [] };
    });

    it('should render forgot password form', () => {
      const result = templates.forgotPasswordTemplate(mockReq, mockFlash);

      assert.ok(typeof result === 'string');
      assert.ok(result.includes('Forgot password'));
      assert.ok(result.includes('form'));
      assert.ok(result.includes('action="/forgot"'));
    });

    it('should include CSRF token', () => {
      const result = templates.forgotPasswordTemplate(mockReq, mockFlash);

      assert.ok(result.includes('_csrf'));
      assert.ok(result.includes('test-csrf-token-789'));
    });

    it('should include email field', () => {
      const result = templates.forgotPasswordTemplate(mockReq, mockFlash);

      assert.ok(result.includes('name="email"'));
      assert.ok(result.includes('type="email"'));
      assert.ok(result.includes('Email Address'));
    });

    it('should include submit button', () => {
      const result = templates.forgotPasswordTemplate(mockReq, mockFlash);

      assert.ok(result.includes('type="submit"'));
      assert.ok(result.includes('Reset password'));
    });

    it('should display info flash message', () => {
      const flashWithInfo = {
        error: [],
        info: ['Password reset email sent'],
      };
      const result = templates.forgotPasswordTemplate(mockReq, flashWithInfo);

      assert.ok(result.includes('Password reset email sent'));
      assert.ok(result.includes('text-blue-400'));
    });

    it('should display error flash message', () => {
      const flashWithError = { error: ['Email not found'], info: [] };
      const result = templates.forgotPasswordTemplate(mockReq, flashWithError);

      assert.ok(result.includes('Email not found'));
      assert.ok(result.includes('text-red-500'));
    });

    it('should include link back to login', () => {
      const result = templates.forgotPasswordTemplate(mockReq, mockFlash);

      assert.ok(result.includes('href="/login"'));
      assert.ok(result.includes('Return to login'));
    });
  });

  describe('resetPasswordTemplate', () => {
    it('should render reset password form with token', () => {
      const token = 'reset-token-abc123';
      const result = templates.resetPasswordTemplate(token, 'csrf-token');

      assert.ok(typeof result === 'string');
      assert.ok(result.includes('Reset Your Password'));
      assert.ok(result.includes('form'));
      assert.ok(result.includes(`action="/reset/${token}"`));
    });

    it('should include CSRF token', () => {
      const result = templates.resetPasswordTemplate('token', 'csrf-123');

      assert.ok(result.includes('_csrf'));
      assert.ok(result.includes('csrf-123'));
    });

    it('should include password field', () => {
      const result = templates.resetPasswordTemplate('token', 'csrf');

      assert.ok(result.includes('name="password"'));
      assert.ok(result.includes('type="password"'));
      assert.ok(result.includes('New Password'));
    });

    it('should include submit button', () => {
      const result = templates.resetPasswordTemplate('token', 'csrf');

      assert.ok(result.includes('type="submit"'));
      assert.ok(result.includes('Reset Password'));
    });

    it('should work without CSRF token', () => {
      const result = templates.resetPasswordTemplate('token');

      assert.ok(typeof result === 'string');
      assert.ok(result.includes('Reset Your Password'));
    });
  });

  describe('invalidTokenTemplate', () => {
    it('should render invalid token message', () => {
      const result = templates.invalidTokenTemplate();

      assert.ok(typeof result === 'string');
      assert.ok(result.includes('expired or is invalid'));
      assert.ok(result.includes('text-red-500'));
    });

    it('should include link to request new reset link', () => {
      const result = templates.invalidTokenTemplate();

      assert.ok(result.includes('href="/forgot"'));
      assert.ok(result.includes('Request a new reset link'));
    });
  });

  describe('spotifyTemplate', () => {
    it('should render full Spotify app page', () => {
      const user = {
        username: 'testuser',
        email: 'test@example.com',
        accentColor: '#dc2626',
      };
      const result = templates.spotifyTemplate(user);

      assert.ok(typeof result === 'string');
      assert.ok(result.includes('<!DOCTYPE html>'));
      assert.ok(result.includes('SuShe Online'));
    });

    it('should include user data in window object', () => {
      const user = {
        username: 'testuser',
        email: 'test@example.com',
      };
      const result = templates.spotifyTemplate(user);

      assert.ok(result.includes('window.currentUser'));
      assert.ok(result.includes('testuser'));
    });

    it('should use user accent color', () => {
      const user = {
        username: 'test',
        accentColor: '#ff0000',
      };
      const result = templates.spotifyTemplate(user);

      assert.ok(result.includes('#ff0000'));
      assert.ok(result.includes('--accent-color'));
    });

    it('should use default accent color when not provided', () => {
      const user = { username: 'test' };
      const result = templates.spotifyTemplate(user);

      assert.ok(result.includes('#dc2626')); // Default red color
    });

    it('should include sidebar', () => {
      const user = { username: 'test' };
      const result = templates.spotifyTemplate(user);

      assert.ok(result.includes('sidebar'));
      assert.ok(result.includes('Lists'));
    });

    it('should include create list button', () => {
      const user = { username: 'test' };
      const result = templates.spotifyTemplate(user);

      assert.ok(result.includes('createListBtn'));
      assert.ok(result.includes('Create List'));
    });

    it('should include import button', () => {
      const user = { username: 'test' };
      const result = templates.spotifyTemplate(user);

      assert.ok(result.includes('importBtn'));
      assert.ok(result.includes('Import List'));
    });

    it('should include add album FAB', () => {
      const user = { username: 'test' };
      const result = templates.spotifyTemplate(user);

      assert.ok(result.includes('addAlbumFAB'));
      assert.ok(result.includes('fa-plus'));
    });

    it('should include mobile menu', () => {
      const user = { username: 'test' };
      const result = templates.spotifyTemplate(user);

      assert.ok(result.includes('mobileMenu'));
      assert.ok(result.includes('mobileMenuDrawer'));
    });

    it('should include all modals', () => {
      const user = { username: 'test' };
      const result = templates.spotifyTemplate(user);

      assert.ok(result.includes('createListModal'));
      assert.ok(result.includes('renameListModal'));
      assert.ok(result.includes('addAlbumModal'));
      assert.ok(result.includes('confirmationModal'));
    });

    it('should include lastSelectedList in window object', () => {
      const user = {
        username: 'test',
        lastSelectedList: 'My Favorite Albums',
      };
      const result = templates.spotifyTemplate(user);

      assert.ok(result.includes('window.lastSelectedList'));
      assert.ok(result.includes('My Favorite Albums'));
    });

    it('should handle null lastSelectedList', () => {
      const user = { username: 'test', lastSelectedList: null };
      const result = templates.spotifyTemplate(user);

      assert.ok(result.includes('window.lastSelectedList'));
      assert.ok(result.includes('null'));
    });

    it('should include bundle.js script', () => {
      const user = { username: 'test' };
      const result = templates.spotifyTemplate(user);

      assert.ok(result.includes('/js/bundle.js'));
      assert.ok(result.includes('type="module"'));
    });

    it('should include CSS files', () => {
      const user = { username: 'test' };
      const result = templates.spotifyTemplate(user);

      assert.ok(result.includes('/styles/output.css'));
      assert.ok(result.includes('/styles/spotify-app.css'));
    });
  });

  describe('headerComponent', () => {
    it('should render header with user info', () => {
      const user = { username: 'testuser', email: 'test@example.com' };
      const result = templates.headerComponent(user);

      assert.ok(typeof result === 'string');
      assert.ok(result.includes('<header'));
      assert.ok(result.includes('testuser'));
    });

    it('should include SuShe logo link', () => {
      const user = { username: 'test' };
      const result = templates.headerComponent(user);

      assert.ok(result.includes('SuShe'));
      assert.ok(result.includes('href="/"'));
    });

    it('should include settings button', () => {
      const user = { username: 'test' };
      const result = templates.headerComponent(user);

      // Settings is now a button that opens a drawer, not a direct link
      assert.ok(result.includes('openSettingsDrawer'));
      assert.ok(result.includes('fa-sliders-h'));
    });

    it('should include logout link in header', () => {
      const user = { username: 'test' };
      const result = templates.headerComponent(user);

      assert.ok(result.includes('href="/logout"'));
      assert.ok(result.includes('fa-sign-out-alt'));
    });

    it('should show username when provided', () => {
      const user = { username: 'john_doe' };
      const result = templates.headerComponent(user);

      assert.ok(result.includes('john_doe'));
    });

    it('should show email when username not provided', () => {
      const user = { email: 'test@example.com' };
      const result = templates.headerComponent(user);

      assert.ok(result.includes('test@example.com'));
    });

    it('should render mobile menu button for home section', () => {
      const user = { username: 'test' };
      const result = templates.headerComponent(user, 'home');

      assert.ok(result.includes('toggleMobileMenu'));
      assert.ok(result.includes('fa-bars'));
    });


    it('should default to home section', () => {
      const user = { username: 'test' };
      const result = templates.headerComponent(user);

      // Default is 'home', so should have mobile menu toggle
      assert.ok(result.includes('toggleMobileMenu'));
    });
  });
});
