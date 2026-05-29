const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

describe('now-playing module', () => {
  let createNowPlaying;

  beforeEach(async () => {
    const module = await import('../src/js/modules/now-playing.js');
    createNowPlaying = module.createNowPlaying;
  });

  it('does not log normal no-match playback checks by default', () => {
    const logger = { debug: mock.fn() };
    const nowPlaying = createNowPlaying({
      getCurrentList: () => 'list1',
      getListData: () => [{ artist: 'Misotheist', album: 'De Pinte' }],
      logger,
    });

    nowPlaying.updateNowPlayingBorder({
      hasPlayback: true,
      albumName: 'A Different Album',
      artistName: 'A Different Artist',
    });

    assert.strictEqual(logger.debug.mock.calls.length, 0);
  });

  it('can log now-playing diagnostics when debug is enabled', () => {
    const logger = { debug: mock.fn() };
    const nowPlaying = createNowPlaying({
      getCurrentList: () => 'list1',
      getListData: () => [{ artist: 'Misotheist', album: 'De Pinte' }],
      logger,
      debug: true,
    });

    nowPlaying.updateNowPlayingBorder({
      hasPlayback: true,
      albumName: 'A Different Album',
      artistName: 'A Different Artist',
    });

    assert.ok(logger.debug.mock.calls.length > 0);
  });
});
