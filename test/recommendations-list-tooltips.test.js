const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('recommendation list tooltip helpers', () => {
  let formatInUserListsTooltip;
  let formatInUserListsAriaLabel;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/recommendations-list-tooltips.js');
    formatInUserListsTooltip = module.formatInUserListsTooltip;
    formatInUserListsAriaLabel = module.formatInUserListsAriaLabel;
  });

  it('formats tooltip html with escaped list names', () => {
    const html = formatInUserListsTooltip(['Favorites', '<Danger>'], (value) =>
      value.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    );

    assert.ok(html.includes('In your lists:'));
    assert.ok(html.includes('&bull; Favorites'));
    assert.ok(html.includes('&bull; &lt;Danger&gt;'));
  });

  it('returns empty tooltip output for empty list collection', () => {
    assert.strictEqual(
      formatInUserListsTooltip([], (value) => value),
      ''
    );
    assert.strictEqual(formatInUserListsAriaLabel([]), '');
  });

  it('formats aria label text for list names', () => {
    const label = formatInUserListsAriaLabel(['List A', 'List B']);
    assert.strictEqual(label, 'In your lists: List A, List B');
  });
});
