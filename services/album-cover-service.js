const { TransactionAbort } = require('../db/transaction');
const { processUploadedCoverImage } = require('../utils/image-processing');

function getQueryFn(dbOrClient) {
  if (typeof dbOrClient?.query === 'function') {
    return dbOrClient.query.bind(dbOrClient);
  }
  if (typeof dbOrClient?.raw === 'function') {
    return dbOrClient.raw.bind(dbOrClient);
  }
  throw new Error('album-cover-service requires a query-capable db');
}

function createAlbumCoverService(deps = {}) {
  const { db, logger } = deps;
  if (!db) throw new Error('db is required');

  async function updateCoverImage(albumId, coverImagePayload, userId = null) {
    return updateCoverImageWithClient(db, albumId, coverImagePayload, userId);
  }

  async function updateCoverImageWithClient(
    dbOrClient,
    albumId,
    coverImagePayload,
    userId = null
  ) {
    if (!albumId) {
      throw new TransactionAbort(400, { error: 'album_id is required' });
    }

    let processed;
    try {
      processed = await processUploadedCoverImage(coverImagePayload);
    } catch (error) {
      throw new TransactionAbort(400, { error: error.message });
    }

    const query = getQueryFn(dbOrClient);
    const result = await query(
      `UPDATE albums
       SET cover_image = $1,
           cover_image_format = $2,
           cover_image_updated_at = NOW(),
           cover_thumbnail = $3,
           cover_thumbnail_format = $4,
           cover_thumbnail_updated_at = NOW(),
           updated_at = NOW()
       WHERE album_id = $5
       RETURNING album_id, cover_image_updated_at, cover_thumbnail_updated_at`,
      [
        processed.buffer,
        processed.format,
        processed.thumbnailBuffer,
        processed.thumbnailFormat,
        albumId,
      ]
    );

    if (result.rowCount === 0) {
      throw new TransactionAbort(404, { error: 'Album not found' });
    }

    logger?.info('Album cover updated', {
      albumId,
      userId,
      size: processed.buffer.length,
      format: processed.format,
    });

    return {
      albumId: result.rows[0].album_id,
      coverImageUpdatedAt: result.rows[0].cover_image_updated_at,
      coverThumbnailUpdatedAt: result.rows[0].cover_thumbnail_updated_at,
      size: processed.buffer.length,
      thumbnailSize: processed.thumbnailBuffer.length,
      format: processed.format,
      thumbnailFormat: processed.thumbnailFormat,
    };
  }

  return { updateCoverImage, updateCoverImageWithClient };
}

module.exports = { createAlbumCoverService };
