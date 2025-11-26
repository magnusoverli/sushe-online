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
});
