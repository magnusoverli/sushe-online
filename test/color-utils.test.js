const test = require('node:test');
const assert = require('node:assert');
const { adjustColor, colorWithOpacity } = require('../color-utils.js');

// =============================================================================
// adjustColor tests
// =============================================================================

test('adjustColor should lighten a color with positive amount', () => {
  // Black (#000000) lightened by 50% should be gray
  const result = adjustColor('#000000', 50);
  assert.strictEqual(result, '#7f7f7f');
});

test('adjustColor should darken a color with negative amount', () => {
  // White (#ffffff) darkened by 50% should be gray
  const result = adjustColor('#ffffff', -50);
  assert.strictEqual(result, '#808080');
});

test('adjustColor should handle color without hash prefix', () => {
  const result = adjustColor('000000', 50);
  assert.strictEqual(result, '#7f7f7f');
});

test('adjustColor should clamp values at 255 (white)', () => {
  // Lightening white should still be white
  const result = adjustColor('#ffffff', 50);
  assert.strictEqual(result, '#ffffff');
});

test('adjustColor should clamp values at 0 (black)', () => {
  // Darkening black should still be black
  const result = adjustColor('#000000', -50);
  assert.strictEqual(result, '#000000');
});

test('adjustColor should work with real-world colors', () => {
  // Spotify green (#1DB954)
  const lighter = adjustColor('#1DB954', 20);
  const darker = adjustColor('#1DB954', -20);

  // Should return valid hex colors
  assert.match(lighter, /^#[0-9a-f]{6}$/i);
  assert.match(darker, /^#[0-9a-f]{6}$/i);

  // Lighter should have higher RGB values
  assert.notStrictEqual(lighter, darker);
});

test('adjustColor should handle zero adjustment', () => {
  const result = adjustColor('#1DB954', 0);
  assert.strictEqual(result, '#1db954');
});

test('adjustColor should handle edge case colors', () => {
  // Pure red
  const red = adjustColor('#ff0000', 10);
  assert.match(red, /^#[0-9a-f]{6}$/i);

  // Pure green
  const green = adjustColor('#00ff00', 10);
  assert.match(green, /^#[0-9a-f]{6}$/i);

  // Pure blue
  const blue = adjustColor('#0000ff', 10);
  assert.match(blue, /^#[0-9a-f]{6}$/i);
});

// =============================================================================
// colorWithOpacity tests
// =============================================================================

test('colorWithOpacity should convert hex to rgba', () => {
  const result = colorWithOpacity('#ff0000', 0.5);
  assert.strictEqual(result, 'rgba(255, 0, 0, 0.5)');
});

test('colorWithOpacity should handle full opacity', () => {
  const result = colorWithOpacity('#00ff00', 1);
  assert.strictEqual(result, 'rgba(0, 255, 0, 1)');
});

test('colorWithOpacity should handle zero opacity', () => {
  const result = colorWithOpacity('#0000ff', 0);
  assert.strictEqual(result, 'rgba(0, 0, 255, 0)');
});

test('colorWithOpacity should handle hex without hash', () => {
  const result = colorWithOpacity('ff0000', 0.5);
  assert.strictEqual(result, 'rgba(255, 0, 0, 0.5)');
});

test('colorWithOpacity should handle complex colors', () => {
  // Spotify green
  const result = colorWithOpacity('#1DB954', 0.8);
  assert.strictEqual(result, 'rgba(29, 185, 84, 0.8)');
});

test('colorWithOpacity should return original color for invalid hex', () => {
  // Invalid hex should return the original color
  const result = colorWithOpacity('notacolor', 0.5);
  assert.strictEqual(result, 'notacolor');
});

test('colorWithOpacity should return original color for short hex', () => {
  // Short hex (3 chars) is not supported by hexToRgb
  const result = colorWithOpacity('#fff', 0.5);
  assert.strictEqual(result, '#fff');
});

test('colorWithOpacity should handle decimal opacity values', () => {
  const result = colorWithOpacity('#ffffff', 0.333);
  assert.strictEqual(result, 'rgba(255, 255, 255, 0.333)');
});
