const { claimAlbumsForRefresh } = require('../playcount-engine');

function triggerPlaycountRefresh(ctx, user, addedItems) {
  if (
    addedItems.length === 0 ||
    !user.lastfmUsername ||
    !ctx.refreshPlaycountsInBackground
  ) {
    return;
  }

  const albumIds = addedItems.map((item) => item.album_id);
  ctx.db
    .raw(
      `SELECT album_id, artist, album FROM albums WHERE album_id = ANY($1::text[])`,
      [albumIds]
    )
    .then((queryResult) => {
      if (queryResult.rows.length === 0) return;

      const albumsToRefresh = queryResult.rows.map((album) => ({
        itemId: album.album_id,
        artist: album.artist,
        album: album.album,
        album_id: album.album_id,
      }));

      // Skip albums already being refreshed by another tier so adding albums
      // doesn't spawn duplicate Last.fm fetches.
      const { toLaunch, release } = claimAlbumsForRefresh(
        user._id,
        albumsToRefresh
      );
      if (toLaunch.length === 0) return;

      ctx.logger?.debug('Triggering playcount refresh for added albums', {
        userId: user._id,
        albumCount: toLaunch.length,
      });

      ctx
        .refreshPlaycountsInBackground(
          user._id,
          user.lastfmUsername,
          toLaunch,
          ctx.db,
          ctx.logger
        )
        .catch((err) => {
          ctx.logger?.warn('Playcount refresh for added albums failed', {
            error: err.message,
          });
        })
        .finally(release);
    })
    .catch((err) => {
      ctx.logger?.warn('Failed to look up albums for playcount refresh', {
        error: err.message,
      });
    });
}

module.exports = {
  triggerPlaycountRefresh,
};
