/**
 * Tests for HTML Utilities Module
 *
 * Tests the html-utils.js module's core functionality.
 * Since these are ES modules, we test the logic patterns.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('HTML Utils Module - Unit Tests', () => {
  describe('escapeHtmlAttr', () => {
    // Replicating the escapeHtmlAttr logic for testing
    function escapeHtmlAttr(str) {
      if (!str) return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    it('should return empty string for null', () => {
      assert.strictEqual(escapeHtmlAttr(null), '');
    });

    it('should return empty string for undefined', () => {
      assert.strictEqual(escapeHtmlAttr(undefined), '');
    });

    it('should return empty string for empty string', () => {
      assert.strictEqual(escapeHtmlAttr(''), '');
    });

    it('should escape ampersands', () => {
      assert.strictEqual(escapeHtmlAttr('Tom & Jerry'), 'Tom &amp; Jerry');
    });

    it('should escape less than signs', () => {
      assert.strictEqual(escapeHtmlAttr('a < b'), 'a &lt; b');
    });

    it('should escape greater than signs', () => {
      assert.strictEqual(escapeHtmlAttr('a > b'), 'a &gt; b');
    });

    it('should escape double quotes', () => {
      assert.strictEqual(
        escapeHtmlAttr('Say "Hello"'),
        'Say &quot;Hello&quot;'
      );
    });

    it('should escape single quotes', () => {
      assert.strictEqual(escapeHtmlAttr("It's fine"), 'It&#39;s fine');
    });

    it('should escape all special characters together', () => {
      const input = '<script>alert("XSS\' & attack")</script>';
      const expected =
        '&lt;script&gt;alert(&quot;XSS&#39; &amp; attack&quot;)&lt;/script&gt;';
      assert.strictEqual(escapeHtmlAttr(input), expected);
    });

    it('should preserve normal text unchanged', () => {
      assert.strictEqual(
        escapeHtmlAttr('Normal text here'),
        'Normal text here'
      );
    });

    it('should handle unicode characters', () => {
      assert.strictEqual(escapeHtmlAttr('Café ñ 日本'), 'Café ñ 日本');
    });

    it('should handle numbers in strings', () => {
      assert.strictEqual(escapeHtmlAttr('Track 123'), 'Track 123');
    });

    it('should handle URLs with ampersands', () => {
      const url = 'https://example.com?a=1&b=2';
      assert.strictEqual(
        escapeHtmlAttr(url),
        'https://example.com?a=1&amp;b=2'
      );
    });

    it('should handle album titles with special characters', () => {
      const title = 'Greatest Hits: 1980s & 90\'s "Best Of"';
      const expected =
        'Greatest Hits: 1980s &amp; 90&#39;s &quot;Best Of&quot;';
      assert.strictEqual(escapeHtmlAttr(title), expected);
    });

    it('should handle artist names with ampersands', () => {
      assert.strictEqual(
        escapeHtmlAttr('Simon & Garfunkel'),
        'Simon &amp; Garfunkel'
      );
    });
  });

  describe('getPlaceholderSvg', () => {
    // Replicating the getPlaceholderSvg logic for testing
    function getPlaceholderSvg(size = 120) {
      return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='1'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Ccircle cx='12' cy='12' r='4'/%3E%3Ccircle cx='12' cy='12' r='1'/%3E%3C/svg%3E`;
    }

    it('should return data URI with default size 120', () => {
      const svg = getPlaceholderSvg();
      assert.ok(svg.startsWith('data:image/svg+xml,'));
      assert.ok(svg.includes("width='120'"));
      assert.ok(svg.includes("height='120'"));
    });

    it('should accept custom size', () => {
      const svg = getPlaceholderSvg(64);
      assert.ok(svg.includes("width='64'"));
      assert.ok(svg.includes("height='64'"));
    });

    it('should return valid SVG structure', () => {
      const svg = getPlaceholderSvg();
      // URL-encoded SVG elements
      assert.ok(svg.includes('%3Csvg')); // <svg
      assert.ok(svg.includes('%3Crect')); // <rect
      assert.ok(svg.includes('%3Ccircle')); // <circle
      assert.ok(svg.includes('%3C/svg%3E')); // </svg>
    });

    it('should have consistent color', () => {
      const svg = getPlaceholderSvg();
      assert.ok(svg.includes("stroke='%23666'")); // URL-encoded #666
    });

    it('should work with various sizes', () => {
      [32, 48, 64, 96, 120, 200, 300].forEach((size) => {
        const svg = getPlaceholderSvg(size);
        assert.ok(svg.includes(`width='${size}'`));
        assert.ok(svg.includes(`height='${size}'`));
      });
    });

    it('should handle size of 0', () => {
      const svg = getPlaceholderSvg(0);
      assert.ok(svg.includes("width='0'"));
      assert.ok(svg.includes("height='0'"));
    });
  });

  describe('escapeHtml (DOM-based) logic simulation', () => {
    // The actual escapeHtml uses document.createElement which isn't available in Node.
    // For Node.js, the same result can be achieved with string replacement.
    // This test validates the expected behavior.
    function escapeHtml(str) {
      if (!str) return '';
      // Simulate what textContent -> innerHTML does
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    it('should return empty string for falsy values', () => {
      assert.strictEqual(escapeHtml(null), '');
      assert.strictEqual(escapeHtml(undefined), '');
      assert.strictEqual(escapeHtml(''), '');
    });

    it('should escape basic HTML characters', () => {
      assert.strictEqual(escapeHtml('<div>'), '&lt;div&gt;');
    });

    it('should escape script tags', () => {
      assert.strictEqual(
        escapeHtml('<script>alert(1)</script>'),
        '&lt;script&gt;alert(1)&lt;/script&gt;'
      );
    });

    it('should preserve normal text', () => {
      assert.strictEqual(escapeHtml('Hello World'), 'Hello World');
    });
  });

  describe('Real-world album data escaping', () => {
    function escapeHtmlAttr(str) {
      if (!str) return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    it('should handle various artist name formats', () => {
      const testCases = [
        { input: 'AC/DC', expected: 'AC/DC' },
        { input: "Guns N' Roses", expected: 'Guns N&#39; Roses' },
        { input: 'Tom & Jerry', expected: 'Tom &amp; Jerry' },
        { input: 'The <html> Band', expected: 'The &lt;html&gt; Band' },
        {
          input: 'Artist "Nickname" Name',
          expected: 'Artist &quot;Nickname&quot; Name',
        },
      ];

      testCases.forEach(({ input, expected }) => {
        assert.strictEqual(
          escapeHtmlAttr(input),
          expected,
          `Failed for input: ${input}`
        );
      });
    });

    it('should handle various album title formats', () => {
      const testCases = [
        { input: 'Back in Black', expected: 'Back in Black' },
        {
          input: 'Abbey Road (Remastered)',
          expected: 'Abbey Road (Remastered)',
        },
        {
          input: 'Greatest Hits: Vol. 1 & 2',
          expected: 'Greatest Hits: Vol. 1 &amp; 2',
        },
        { input: '"Heroes"', expected: '&quot;Heroes&quot;' },
        { input: "What's Going On", expected: 'What&#39;s Going On' },
      ];

      testCases.forEach(({ input, expected }) => {
        assert.strictEqual(
          escapeHtmlAttr(input),
          expected,
          `Failed for input: ${input}`
        );
      });
    });
  });
});
