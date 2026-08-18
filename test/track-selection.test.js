const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

describe('track-selection module', () => {
  let createTrackSelection;

  beforeEach(async () => {
    const module = await import('../src/js/modules/track-selection.js');
    createTrackSelection = module.createTrackSelection;
  });

  it('refreshes the album display after a track-pick mutation', () => {
    const refreshAlbumDisplay = mock.fn();
    const trackSelection = createTrackSelection({ refreshAlbumDisplay });

    trackSelection.updateTrackCellDisplayDual();

    assert.strictEqual(refreshAlbumDisplay.mock.calls.length, 1);
  });
});
