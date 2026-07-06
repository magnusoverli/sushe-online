const { describe, it } = require('node:test');
const assert = require('node:assert');
const { register } = require('node:module');

register(
  'data:text/javascript,' +
    encodeURIComponent(`
  import { readFileSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';
  export function load(url, context, next) {
    if (url.endsWith('.json')) {
      const filePath = fileURLToPath(url);
      const json = readFileSync(filePath, 'utf8');
      return { format: 'module', source: 'export default ' + json, shortCircuit: true };
    }
    return next(url, context);
  }
`)
);

describe('emoji autocomplete', () => {
  it('detects a colon query before the textarea caret', async () => {
    const { findEmojiTrigger } =
      await import('../src/js/modules/emoji-autocomplete-utils.js');
    const value = 'Great record :hea';

    assert.deepStrictEqual(findEmojiTrigger(value, value.length), {
      start: 13,
      end: 17,
      query: 'hea',
    });
  });

  it('does not trigger inside URLs or plain word prefixes', async () => {
    const { findEmojiTrigger } =
      await import('../src/js/modules/emoji-autocomplete-utils.js');

    assert.strictEqual(findEmojiTrigger('https://example.com', 6), null);
    assert.strictEqual(
      findEmojiTrigger('label:value', 'label:val'.length),
      null
    );
  });

  it('replaces only the active shortcode query with the selected emoji', async () => {
    const { findEmojiTrigger, replaceEmojiTrigger } =
      await import('../src/js/modules/emoji-autocomplete-utils.js');
    const value = 'Intro :fire outro';
    const caretIndex = 'Intro :fire'.length;
    const trigger = findEmojiTrigger(value, caretIndex);

    const result = replaceEmojiTrigger(value, trigger, '🔥');

    assert.strictEqual(result.value, 'Intro 🔥 outro');
    assert.strictEqual(result.caretIndex, 'Intro 🔥'.length);
  });

  it('does not refresh suggestions after menu navigation keyup events', async () => {
    const { shouldRefreshAfterKeyup } =
      await import('../src/js/modules/emoji-autocomplete-utils.js');

    assert.strictEqual(shouldRefreshAfterKeyup('ArrowDown', true), false);
    assert.strictEqual(shouldRefreshAfterKeyup('ArrowUp', true), false);
    assert.strictEqual(shouldRefreshAfterKeyup('Enter', true), false);
    assert.strictEqual(shouldRefreshAfterKeyup('a', true), true);
    assert.strictEqual(shouldRefreshAfterKeyup('ArrowDown', false), true);
  });

  it('searches the full emoji data set by shortcode', async () => {
    const { getEmojiSuggestions } =
      await import('../src/js/modules/emoji-data.js');

    const suggestions = getEmojiSuggestions('heart', 10);

    assert.ok(suggestions.length > 0);
    assert.ok(suggestions.some((item) => item.shortNames.includes('heart')));
    assert.ok(suggestions.every((item) => item.emoji && item.shortName));
  });

  it('returns useful popular suggestions before a search query is typed', async () => {
    const { getEmojiSuggestions } =
      await import('../src/js/modules/emoji-data.js');

    const suggestions = getEmojiSuggestions('', 8);

    assert.ok(suggestions.length > 0);
    assert.ok(suggestions.some((item) => item.shortNames.includes('fire')));
  });

  it('includes searchable skin-tone variants from the full compact data', async () => {
    const { getEmojiSuggestions } =
      await import('../src/js/modules/emoji-data.js');

    const suggestions = getEmojiSuggestions('waving hand light', 10);

    assert.ok(
      suggestions.some(
        (item) => item.shortName === 'waving_hand_light_skin_tone'
      )
    );
  });
});
