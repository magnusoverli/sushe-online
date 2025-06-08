const { adjustColor, colorWithOpacity } = require('../color-utils');

describe('adjustColor', () => {
  test('lightens black when amount is positive', () => {
    expect(adjustColor('#000000', 50)).toBe('#7f7f7f');
  });

  test('darkens white when amount is negative', () => {
    expect(adjustColor('#ffffff', -50)).toBe('#808080');
  });
});

describe('colorWithOpacity', () => {
  test('converts hex to rgba string', () => {
    expect(colorWithOpacity('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });
});
