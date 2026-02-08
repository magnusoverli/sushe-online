const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  TARGET_SIZE,
  JPEG_QUALITY,
  ITUNES_IMAGE_SIZE,
  upscaleItunesArtworkUrl,
  normalizeImageBuffer,
} = require('../utils/image-processing');

describe('image-processing', () => {
  describe('constants', () => {
    it('should have expected values', () => {
      assert.strictEqual(TARGET_SIZE, 512);
      assert.strictEqual(JPEG_QUALITY, 100);
      assert.strictEqual(ITUNES_IMAGE_SIZE, 600);
    });
  });

  describe('upscaleItunesArtworkUrl', () => {
    it('should replace 100x100 with 600x600', () => {
      const url =
        'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/ab/cd/ef/100x100bb.jpg';
      const result = upscaleItunesArtworkUrl(url);
      assert.ok(result.includes('600x600bb.'));
      assert.ok(!result.includes('100x100bb.'));
    });

    it('should handle various dimension patterns', () => {
      const url = 'https://example.com/art/250x250bb.png';
      const result = upscaleItunesArtworkUrl(url);
      assert.ok(result.includes('600x600bb.'));
    });

    it('should not modify URLs without the pattern', () => {
      const url = 'https://example.com/image.jpg';
      assert.strictEqual(upscaleItunesArtworkUrl(url), url);
    });
  });

  describe('normalizeImageBuffer', () => {
    it('should return Buffer unchanged if already a Buffer', () => {
      const buf = Buffer.from('test');
      assert.strictEqual(normalizeImageBuffer(buf), buf);
    });

    it('should convert base64 string to Buffer', () => {
      const original = 'hello world';
      const base64 = Buffer.from(original).toString('base64');
      const result = normalizeImageBuffer(base64);
      assert.ok(Buffer.isBuffer(result));
      assert.strictEqual(result.toString(), original);
    });
  });
});
