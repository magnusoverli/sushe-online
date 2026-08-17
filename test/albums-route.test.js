const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const registerAlbumRoutes = require('../routes/api/albums');
const { createMockLogger } = require('./helpers');

function createTestApp(albumService) {
  const app = express();
  app.use(express.json());
  registerAlbumRoutes(app, {
    ensureAuthAPI: (req, _res, next) => {
      req.user = { _id: 'user-1' };
      next();
    },
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

  it('returns complete full and thumbnail metadata after a cover update', async () => {
    const coverImageUpdatedAt = new Date('2026-08-12T10:00:00.000Z');
    const coverThumbnailUpdatedAt = new Date('2026-08-12T10:00:01.000Z');
    const albumService = {
      updateCoverImage: mock.fn(async () => ({
        albumId: 'album-1',
        format: 'JPEG',
        thumbnailFormat: 'JPEG',
        coverImageUpdatedAt,
        coverThumbnailUpdatedAt,
      })),
    };

    const response = await request(createTestApp(albumService))
      .patch('/api/albums/album-1/cover')
      .send({ cover_image: 'base64-cover' })
      .expect(200);

    assert.strictEqual(response.body.cover_image_format, 'JPEG');
    assert.strictEqual(response.body.cover_thumbnail_format, 'JPEG');
    assert.strictEqual(
      response.body.cover_thumbnail_updated_at,
      coverThumbnailUpdatedAt.toISOString()
    );
    assert.strictEqual(
      response.body.cover_thumb_url,
      `/api/albums/album-1/cover?size=thumb&v=${coverThumbnailUpdatedAt.getTime()}`
    );
  });

  it('resets genre overrides through the genre endpoint', async () => {
    const albumService = {
      resetGenres: mock.fn(async () => {}),
      updateGenres: mock.fn(async () => {}),
    };

    await request(createTestApp(albumService))
      .patch('/api/albums/album-1/genres')
      .send({ reset: true })
      .expect(200, { success: true });

    assert.deepStrictEqual(albumService.resetGenres.mock.calls[0].arguments, [
      'album-1',
      'user-1',
    ]);
    assert.strictEqual(albumService.updateGenres.mock.calls.length, 0);
  });

  it('returns the additive taxonomy resource', async () => {
    const taxonomy = {
      taxonomy: { schema_version: 1, manual_overrides: {} },
      taxonomy_updated_at: null,
      genre_1: '',
      genre_2: '',
    };
    const albumService = { getTaxonomy: mock.fn(async () => taxonomy) };

    const response = await request(createTestApp(albumService))
      .get('/api/albums/album-1/taxonomy')
      .expect(200);

    assert.deepStrictEqual(response.body, taxonomy);
  });
});
