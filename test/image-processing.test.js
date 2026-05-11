const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  TARGET_SIZE,
  JPEG_QUALITY,
  ITUNES_IMAGE_SIZE,
  upscaleItunesArtworkUrl,
  normalizeImageBuffer,
  decodeImagePayload,
  processUploadedCoverImage,
} = require('../utils/image-processing');

const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

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

  describe('decodeImagePayload', () => {
    it('should decode plain base64 image data', () => {
      const result = decodeImagePayload(PNG_1X1_BASE64);
      assert.ok(Buffer.isBuffer(result));
      assert.ok(result.length > 0);
    });

    it('should decode data URL image data', () => {
      const result = decodeImagePayload(
        `data:image/png;base64,${PNG_1X1_BASE64}`
      );
      assert.ok(Buffer.isBuffer(result));
      assert.ok(result.length > 0);
    });
  });

  describe('processUploadedCoverImage', () => {
    it('should normalize uploads to JPEG buffers', async () => {
      const result = await processUploadedCoverImage(PNG_1X1_BASE64);
      assert.strictEqual(result.format, 'JPEG');
      assert.ok(Buffer.isBuffer(result.buffer));
      assert.ok(
        result.buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      );
    });
  });
});
