const { processUploadedCoverImage } = require('../../utils/image-processing');

// Run sharp resize/re-encode before a write transaction opens, so image work
// never runs while row and advisory locks are held.
async function prepareExplicitCovers(albums, TransactionAbort) {
  for (const album of albums || []) {
    if (album && album.cover_image) {
      try {
        album.cover_image = await processUploadedCoverImage(album.cover_image);
      } catch (error) {
        throw new TransactionAbort(400, { error: error.message });
      }
    }
  }
}

module.exports = { prepareExplicitCovers };
