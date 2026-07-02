const { describe, it } = require('node:test');
const assert = require('node:assert');
const { escapeHtml } = require('../utils/escape-html');

describe('escape-html (canonical shared escaper)', () => {
  it('returns empty string for nullish/empty input', () => {
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(undefined), '');
    assert.strictEqual(escapeHtml(''), '');
  });

  it('escapes all five HTML-significant characters, quotes included', () => {
    assert.strictEqual(escapeHtml('<b>"\'&'), '&lt;b&gt;&quot;&#39;&amp;');
  });

  it('escapes ampersand first so entities are not double-encoded', () => {
    assert.strictEqual(escapeHtml('a & <b>'), 'a &amp; &lt;b&gt;');
  });

  it('neutralises a script-injection album title', () => {
    assert.strictEqual(
      escapeHtml('<img src=x onerror=alert(1)>'),
      '&lt;img src=x onerror=alert(1)&gt;'
    );
  });

  it('coerces non-string input via String()', () => {
    assert.strictEqual(escapeHtml(123), '123');
  });

  it('leaves normal and unicode text unchanged', () => {
    assert.strictEqual(
      escapeHtml('Café ñ 日本 — Track 1'),
      'Café ñ 日本 — Track 1'
    );
  });
});
