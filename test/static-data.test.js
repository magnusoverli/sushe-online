/**
 * Tests for static-data.js utility module
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

let parseStaticList;

describe('static-data', async () => {
  const mod = await import('../src/js/utils/static-data.js');
  parseStaticList = mod.parseStaticList;

  it('should parse and sort a newline-separated list', () => {
    const text = 'Rock\nJazz\nBlues\nElectronic';
    const result = parseStaticList(text);
    assert.deepStrictEqual(result, ['Blues', 'Electronic', 'Jazz', 'Rock']);
  });

  it('should trim whitespace from entries', () => {
    const text = '  Rock  \n  Jazz  \n  Blues  ';
    const result = parseStaticList(text);
    assert.deepStrictEqual(result, ['Blues', 'Jazz', 'Rock']);
  });

  it('should remove empty lines except first', () => {
    const text = '\nRock\n\nJazz\n\nBlues';
    const result = parseStaticList(text);
    assert.deepStrictEqual(result, ['', 'Blues', 'Jazz', 'Rock']);
  });

  it('should keep empty string at top when sorted', () => {
    const text = '\nZebra\nApple';
    const result = parseStaticList(text);
    assert.strictEqual(result[0], '');
    assert.strictEqual(result[1], 'Apple');
    assert.strictEqual(result[2], 'Zebra');
  });

  it('should handle list with no empty first line', () => {
    const text = 'Rock\nJazz';
    const result = parseStaticList(text);
    assert.deepStrictEqual(result, ['Jazz', 'Rock']);
  });

  it('should handle single entry', () => {
    const text = 'Rock';
    const result = parseStaticList(text);
    assert.deepStrictEqual(result, ['Rock']);
  });

  it('should handle empty input', () => {
    const text = '';
    const result = parseStaticList(text);
    assert.deepStrictEqual(result, ['']);
  });
});
