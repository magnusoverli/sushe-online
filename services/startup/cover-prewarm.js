function coverVersion(meta) {
  return meta.coverImageUpdatedAt
    ? new Date(meta.coverImageUpdatedAt).getTime()
    : meta.coverLength;
}

async function warmCoverCache({ albumService, coverTargets, logger }) {
  if (!albumService || coverTargets.length === 0) return { covers: 0 };

  let warmed = 0;
  for (const target of coverTargets) {
    const albumId = target.album_id;
    try {
      const meta = await albumService.getCoverMeta(albumId, { size: 'thumb' });
      const version = coverVersion(meta);
      if (albumService.getCachedCover(albumId, { size: 'thumb', version })) {
        warmed++;
        continue;
      }

      const { imageBuffer } = await albumService.getCoverImage(albumId, {
        size: 'thumb',
      });
      const lastModified = meta.coverImageUpdatedAt
        ? new Date(meta.coverImageUpdatedAt).toUTCString()
        : undefined;

      const stored = albumService.cacheCover(albumId, {
        size: 'thumb',
        version,
        imageBuffer,
        contentType: meta.contentType,
        headers: {
          'Cache-Control': 'private, max-age=31536000, immutable',
          ETag: `"${albumId}-${version}-${meta.coverLength}"`,
          'Last-Modified': lastModified,
          'Content-Type': meta.contentType,
          'Content-Length': imageBuffer.length,
        },
      });
      if (stored) warmed++;
    } catch (error) {
      logger.debug('Failed to prewarm album cover', {
        albumId,
        error: error.message,
      });
    }
  }

  return { covers: warmed };
}

module.exports = { coverVersion, warmCoverCache };
