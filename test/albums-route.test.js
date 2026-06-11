const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const registerAlbumRoutes = require('../routes/api/albums');
const { createMockLogger } = require('./helpers');

function createTestApp(albumService) {
  const app = express();
  registerAlbumRoutes(app, {
    ensureAuthAPI: (_req, _res, next) => next(),
    logger: createMockLogger(),
    albumService,
  });
  return app;
}

describe('album routes', () => {
  it('serves unversioned current-version cover cache hits after metadata lookup', async () => {
    const imageBuffer = Buffer.from('cached-cover');
    const coverImageUpdatedAt = new Date('2026-05-01T12:00:00.000Z');
    const version = coverImageUpdatedAt.getTime();
    const albumService = {
      getCachedCover: mock.fn((albumId, options) => {
        if (albumId === 'canonical-album' && options.version === version) {
          return {
            imageBuffer,
            headers: {
              'Content-Type': 'image/jpeg',
              'Content-Length': imageBuffer.length,
            },
          };
        }
        return null;
      }),
      getCoverMeta: mock.fn(async () => ({
        albumId: 'canonical-album',
        contentType: 'image/jpeg',
        coverImageUpdatedAt,
        coverLength: imageBuffer.length,
      })),
      getCoverImage: mock.fn(async () => {
        throw new Error('cover image should not be read on cache hit');
      }),
      cacheCover: mock.fn(),
    };

    const response = await request(createTestApp(albumService))
      .get('/api/albums/requested-album/cover')
      .expect(200)
      .expect('X-Cover-Cache', 'HIT')
      .expect('Cache-Control', 'private, max-age=300, must-revalidate');

    assert.deepStrictEqual(response.body, imageBuffer);
    assert.strictEqual(albumService.getCoverMeta.mock.calls.length, 1);
    assert.strictEqual(albumService.getCoverImage.mock.calls.length, 0);
    assert.strictEqual(albumService.cacheCover.mock.calls.length, 0);
    assert.deepStrictEqual(
      albumService.getCachedCover.mock.calls.map((call) => call.arguments),
      [
        ['requested-album', { size: 'full', version: null }],
        ['canonical-album', { size: 'full', version }],
      ]
    );
  });
});
