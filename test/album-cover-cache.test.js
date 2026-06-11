const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createMockLogger } = require('./helpers');
const {
  AlbumCoverCache,
  coverCacheKey,
} = require('../services/album-cover-cache');

describe('album-cover-cache', () => {
  it('builds stable keys from album, size, and version', () => {
    assert.strictEqual(
      coverCacheKey('album-1', 'thumb', 123),
      'album-1:thumb:123'
    );
  });

  it('stores and retrieves versioned cover buffers', () => {
    const cache = new AlbumCoverCache({
      enabled: true,
      maxBytes: 1024,
      maxItems: 10,
      logger: createMockLogger(),
    });
    const imageBuffer = Buffer.from('cover');

    cache.set({
      albumId: 'album-1',
      size: 'thumb',
      version: '10',
      imageBuffer,
      contentType: 'image/jpeg',
      headers: { ETag: '"album-1-10"' },
    });

    const cached = cache.get({
      albumId: 'album-1',
      size: 'thumb',
      version: 10,
    });
    assert.ok(cached);
    assert.strictEqual(cached.imageBuffer, imageBuffer);
    assert.strictEqual(cached.contentType, 'image/jpeg');
    assert.strictEqual(cached.headers.ETag, '"album-1-10"');
  });

  it('does not cache when disabled', () => {
    const cache = new AlbumCoverCache({ enabled: false });
    const stored = cache.set({
      albumId: 'album-1',
      version: '1',
      imageBuffer: Buffer.from('cover'),
    });

    assert.strictEqual(stored, false);
    assert.strictEqual(
      cache.get({ albumId: 'album-1', size: 'full', version: '1' }),
      null
    );
  });

  it('honors a zero item limit', () => {
    const cache = new AlbumCoverCache({
      enabled: true,
      maxBytes: 1024,
      maxItems: 0,
      logger: createMockLogger(),
    });

    assert.strictEqual(
      cache.set({
        albumId: 'album-1',
        version: '1',
        imageBuffer: Buffer.from('cover'),
      }),
      false
    );
    assert.strictEqual(cache.getStats().items, 0);
  });

  it('evicts least-recently-used entries by byte limit', () => {
    const cache = new AlbumCoverCache({
      enabled: true,
      maxBytes: 8,
      maxItems: 10,
      logger: createMockLogger(),
    });

    cache.set({
      albumId: 'old',
      version: '1',
      imageBuffer: Buffer.from('12345'),
    });
    cache.set({
      albumId: 'new',
      version: '1',
      imageBuffer: Buffer.from('67890'),
    });

    assert.strictEqual(
      cache.get({ albumId: 'old', size: 'full', version: '1' }),
      null
    );
    assert.ok(cache.get({ albumId: 'new', size: 'full', version: '1' }));
    assert.ok(cache.getStats().totalBytes <= 8);
  });

  it('invalidates all sizes and versions for an album', () => {
    const cache = new AlbumCoverCache({
      enabled: true,
      maxBytes: 1024,
      maxItems: 10,
      logger: createMockLogger(),
    });

    cache.set({
      albumId: 'album-1',
      size: 'full',
      version: '1',
      imageBuffer: Buffer.from('full'),
    });
    cache.set({
      albumId: 'album-1',
      size: 'thumb',
      version: '1',
      imageBuffer: Buffer.from('thumb'),
    });
    cache.set({
      albumId: 'album-2',
      size: 'thumb',
      version: '1',
      imageBuffer: Buffer.from('other'),
    });

    assert.strictEqual(cache.invalidateAlbum('album-1'), 2);
    assert.strictEqual(
      cache.get({ albumId: 'album-1', size: 'full', version: '1' }),
      null
    );
    assert.ok(cache.get({ albumId: 'album-2', size: 'thumb', version: '1' }));
  });
});
