const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  createAssetHelper,
  escapeHtml,
  safeJsonStringify,
  modalShell,
  menuItem,
  formatDate,
  formatDateTime,
} = require('../utils/template-helpers');

describe('template-helpers', () => {
  it('creates versioned asset helper', () => {
    const asset = createAssetHelper('abc123');
    assert.strictEqual(asset('/styles/app.css'), '/styles/app.css?v=abc123');
  });

  it('escapes html and serializes safe json', () => {
    assert.strictEqual(
      escapeHtml(`<script>alert('x')</script>`),
      '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;'
    );

    const json = safeJsonStringify({ html: '</script><x>' });
    assert.strictEqual(json.includes('</script>'), false);
    assert.strictEqual(json.includes('\\u003c'), true);
  });

  it('renders modal shell and menu items', () => {
    const modal = modalShell({
      id: 'test-modal',
      title: 'Title',
      body: '<p>Body</p>',
      footer: '<button>Close</button>',
    });

    assert.match(modal, /id="test-modal"/);
    assert.match(modal, /Title/);
    assert.match(modal, /Body/);
    assert.match(modal, /Close/);

    const regularItem = menuItem({
      id: 'edit',
      icon: 'fa-edit',
      label: 'Edit',
    });
    const submenuItem = menuItem({
      id: 'move',
      icon: 'fa-folder',
      label: 'Move',
      hasSubmenu: true,
    });
    assert.match(regularItem, /ctx-menu-item/);
    assert.match(submenuItem, /fa-chevron-right/);
  });

  it('formats date and date time with locale options', () => {
    const date = new Date('2024-04-15T14:30:00Z');

    const usDate = formatDate(date, 'MM/DD/YYYY');
    const ukDate = formatDate(date, 'DD/MM/YYYY');
    assert.ok(usDate.includes('2024'));
    assert.ok(ukDate.includes('2024'));

    const dt12 = formatDateTime(date, true, 'MM/DD/YYYY');
    const dt24 = formatDateTime(date, false, 'DD/MM/YYYY');
    assert.ok(dt12.includes(':'));
    assert.ok(dt24.includes(':'));
  });
});
