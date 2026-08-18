const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('mobile backdrop styles', () => {
  it('does not create full-screen backdrop-filter layers on mobile', () => {
    const css = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'styles', 'input.css'),
      'utf8'
    );

    assert.match(
      css,
      /@media \(max-width: 1023px\) \{\s+\.mobile-sidebar-backdrop,\s+\.settings-drawer-backdrop \{\s+backdrop-filter: none;\s+-webkit-backdrop-filter: none;\s+\}\s+\}/
    );
  });
});
