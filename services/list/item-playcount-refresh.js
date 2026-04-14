function triggerPlaycountRefresh(ctx, user, addedItems) {
  if (
    addedItems.length === 0 ||
    !user.lastfmUsername ||
    !ctx.refreshPlaycountsInBackground
  ) {
    return;
  }

  const albumIds = addedItems.map((item) => item.album_id);
  ctx.pool
    .query(
      `SELECT album_id, artist, album FROM albums WHERE album_id = ANY($1::text[])`,
      [albumIds]
    )
    .then((queryResult) => {
      if (queryResult.rows.length === 0) return;

      const albumsToRefresh = queryResult.rows.map((album) => ({
        itemId: album.album_id,
        artist: album.artist,
        album: album.album,
        albumId: album.album_id,
      }));

      ctx.logger?.debug('Triggering playcount refresh for added albums', {
        userId: user._id,
        albumCount: albumsToRefresh.length,
      });

      ctx
        .refreshPlaycountsInBackground(
          user._id,
          user.lastfmUsername,
          albumsToRefresh,
          ctx.pool,
          ctx.logger
        )
        .catch((err) => {
          ctx.logger?.warn('Playcount refresh for added albums failed', {
            error: err.message,
          });
        });
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
