/**
 * OAuth Routes Aggregator
 *
 * Registers all music service OAuth routes:
 * - Spotify OAuth
 * - Tidal OAuth
 * - Last.fm OAuth
 */

module.exports = (app, deps) => {
  require('./spotify')(app, deps);
  require('./tidal')(app, deps);
  require('./lastfm')(app, deps);
};
