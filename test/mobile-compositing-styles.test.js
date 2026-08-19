const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('mobile compositing styles', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'styles', 'app.css'),
    'utf8'
  );

  it('keeps the app header out of sticky viewport compositing', () => {
    assert.doesNotMatch(
      css,
      /\.app-layout\s*>\s*header\s*\{[^}]*position:\s*sticky/s
    );
  });

  it('positions toasts below the iPhone safe area', () => {
    assert.match(
      css,
      /\.toast\s*\{[^}]*top:\s*calc\(5rem \+ env\(safe-area-inset-top, 0px\)\);/s
    );
    assert.match(css, /\.toast\s*\{[^}]*z-index:\s*var\(--z-toast, 10050\);/s);
  });
});
