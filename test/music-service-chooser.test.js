/**
 * Tests for music-service-chooser.js utility module
 */

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

let chooseService;

describe('music-service-chooser', async () => {
  const mod = await import('../src/js/utils/music-service-chooser.js');
  chooseService = mod.chooseService;

  const mockShowToast = mock.fn();
  const mockShowServicePicker = mock.fn(() => Promise.resolve('spotify'));

  beforeEach(() => {
    mockShowToast.mock.resetCalls();
    mockShowServicePicker.mock.resetCalls();
    // Reset window.currentUser
    globalThis.window = globalThis.window || {};
    globalThis.window.currentUser = null;
  });

  it('should return spotify when preferred is spotify and connected', async () => {
    globalThis.window.currentUser = {
      spotifyAuth: true,
      tidalAuth: false,
      musicService: 'spotify',
    };
    const result = await chooseService(mockShowServicePicker, mockShowToast);
    assert.strictEqual(result, 'spotify');
    assert.strictEqual(mockShowServicePicker.mock.calls.length, 0);
  });

  it('should return tidal when preferred is tidal and connected', async () => {
    globalThis.window.currentUser = {
      spotifyAuth: false,
      tidalAuth: true,
      musicService: 'tidal',
    };
    const result = await chooseService(mockShowServicePicker, mockShowToast);
    assert.strictEqual(result, 'tidal');
  });

  it('should show picker when both services connected and no preference', async () => {
    globalThis.window.currentUser = {
      spotifyAuth: true,
      tidalAuth: true,
      musicService: null,
    };
    const result = await chooseService(mockShowServicePicker, mockShowToast);
    assert.strictEqual(mockShowServicePicker.mock.calls.length, 1);
    assert.strictEqual(result, 'spotify'); // mocked return value
  });

  it('should return spotify when only spotify connected', async () => {
    globalThis.window.currentUser = {
      spotifyAuth: true,
      tidalAuth: false,
      musicService: null,
    };
    const result = await chooseService(mockShowServicePicker, mockShowToast);
    assert.strictEqual(result, 'spotify');
  });

  it('should return tidal when only tidal connected', async () => {
    globalThis.window.currentUser = {
      spotifyAuth: false,
      tidalAuth: true,
      musicService: null,
    };
    const result = await chooseService(mockShowServicePicker, mockShowToast);
    assert.strictEqual(result, 'tidal');
  });

  it('should show toast and return null when no service connected', async () => {
    globalThis.window.currentUser = {
      spotifyAuth: false,
      tidalAuth: false,
      musicService: null,
    };
    const result = await chooseService(mockShowServicePicker, mockShowToast);
    assert.strictEqual(result, null);
    assert.strictEqual(mockShowToast.mock.calls.length, 1);
    assert.strictEqual(
      mockShowToast.mock.calls[0].arguments[0],
      'No music service connected'
    );
  });

  it('should return null when no currentUser', async () => {
    globalThis.window.currentUser = null;
    const result = await chooseService(mockShowServicePicker, mockShowToast);
    assert.strictEqual(result, null);
  });

  it('should fall back to tidal when preferred is spotify but only tidal connected', async () => {
    globalThis.window.currentUser = {
      spotifyAuth: false,
      tidalAuth: true,
      musicService: 'spotify',
    };
    const result = await chooseService(mockShowServicePicker, mockShowToast);
    assert.strictEqual(result, 'tidal');
    assert.strictEqual(mockShowServicePicker.mock.calls.length, 0);
  });

  it('should fall back to spotify when preferred is tidal but only spotify connected', async () => {
    globalThis.window.currentUser = {
      spotifyAuth: true,
      tidalAuth: false,
      musicService: 'tidal',
    };
    const result = await chooseService(mockShowServicePicker, mockShowToast);
    assert.strictEqual(result, 'spotify');
    assert.strictEqual(mockShowServicePicker.mock.calls.length, 0);
  });
});
