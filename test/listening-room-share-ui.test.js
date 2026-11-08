const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

const share = {
  url: 'https://example.test/lr/abcdefghijklmnopqrstuv',
  expiresAt: '2026-11-15T13:32:00.000Z',
  songCount: 22,
  leftOut: { noPick: 2, disqualified: 1 },
};

async function harness({
  copyFails = false,
  confirmed = true,
  stopFails = false,
} = {}) {
  const { openListeningRoomShare } =
    await import('../src/js/modules/listening-room-share.js');
  const nodes = new Map();
  const node = () => ({ textContent: '', hidden: false, handlers: new Map() });
  const modal = {
    ...node(),
    remove: mock.fn(),
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, node());
      return nodes.get(selector);
    },
  };
  const doc = { createElement: () => modal, body: { appendChild() {} } };
  const clipboard = {
    writeText: mock.fn(async () => {
      if (copyFails) throw new Error('Permission denied');
    }),
  };
  const showToast = mock.fn();
  const showConfirmation = mock.fn(async () => confirmed);
  const apiCall = mock.fn(async () => {
    if (stopFails) throw new Error('Network');
  });
  const modalFactory = (options) => {
    let open = false;
    return {
      open() {
        open = true;
        options.onOpen();
      },
      close() {
        open = false;
        for (const n of nodes.values()) n.handlers.clear();
        options.onClose();
      },
      isOpen: () => open,
      addListener(element, event, handler) {
        element.handlers.set(event, handler);
      },
    };
  };
  const controller = openListeningRoomShare(share, 'list/with spaces', {
    doc,
    clipboard,
    showToast,
    showConfirmation,
    apiCall,
    modalFactory,
  });
  await Promise.resolve();
  const get = (selector) => modal.querySelector(selector);
  const click = (selector) => get(selector).handlers.get('click')();
  return {
    get,
    click,
    controller,
    clipboard,
    showToast,
    showConfirmation,
    apiCall,
    modal,
  };
}

describe('Listening Room sharing UI', () => {
  it('formats singular, plural, zero-song and positive-only exclusion counts', async () => {
    const { listeningRoomSummary } =
      await import('../src/js/modules/listening-room-share.js');
    assert.equal(
      listeningRoomSummary(share),
      '22 songs. Left out: 2 albums without a track pick, 1 disqualified album.'
    );
    assert.equal(
      listeningRoomSummary({
        songCount: 1,
        leftOut: { noPick: 0, disqualified: 0 },
      }),
      '1 song.'
    );
    assert.equal(
      listeningRoomSummary({
        songCount: 0,
        leftOut: { noPick: 0, disqualified: 0 },
      }),
      'No songs yet. Pick tracks in this list; the link always shows the current picks.'
    );
    assert.match(
      listeningRoomSummary({
        songCount: 0,
        leftOut: { noPick: 1, disqualified: 2 },
      }),
      /1 album without a track pick, 2 disqualified albums/
    );
  });

  it('copies automatically, reports success, and resets Copied after two seconds', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = await harness();
    assert.deepEqual(h.clipboard.writeText.mock.calls[0].arguments, [
      share.url,
    ]);
    assert.equal(h.get('[data-share-status]').textContent, 'Link copied');
    assert.equal(h.get('[data-copy-share]').textContent, 'Copied');
    t.mock.timers.tick(1999);
    assert.equal(h.get('[data-copy-share]').textContent, 'Copied');
    t.mock.timers.tick(1);
    assert.equal(h.get('[data-copy-share]').textContent, 'Copy link');
    h.controller.close();
  });

  it('silently ignores automatic copy rejection and retries directly on a tap', async () => {
    const h = await harness({ copyFails: true });
    assert.equal(h.showToast.mock.callCount(), 0);
    h.clipboard.writeText.mock.mockImplementation(async () => {});
    const copying = h.click('[data-copy-share]');
    assert.equal(h.clipboard.writeText.mock.callCount(), 2);
    await copying;
    assert.equal(h.get('[data-copy-share]').textContent, 'Copied');
    h.controller.close();
  });

  it('confirms stop, deletes the share and leaves only Close with the stopped message', async () => {
    const h = await harness();
    await h.click('[data-stop-sharing]');
    assert.deepEqual(h.showConfirmation.mock.calls[0].arguments, [
      'Stop sharing',
      'Stop sharing this list? The link stops working right away.',
      '',
      'Stop sharing',
    ]);
    assert.deepEqual(h.apiCall.mock.calls[0].arguments, [
      '/api/lists/list%2Fwith%20spaces/listening-room-share',
      { method: 'DELETE' },
    ]);
    assert.equal(
      h.get('[data-share-details]').textContent,
      'Sharing stopped. The link no longer works.'
    );
    assert.equal(h.get('[data-copy-share]').hidden, true);
    assert.equal(h.get('[data-stop-sharing]').hidden, true);
    assert.equal(h.controller.isOpen(), true);
    h.controller.close();
  });

  it('cancelled confirmation keeps the link active without recopying', async () => {
    const h = await harness({ confirmed: false });
    await h.click('[data-stop-sharing]');
    assert.equal(h.apiCall.mock.callCount(), 0);
    assert.equal(h.clipboard.writeText.mock.callCount(), 1);
    assert.equal(h.get('[data-copy-share]').hidden, false);
    assert.equal(h.controller.isOpen(), true);
    h.controller.close();
  });

  it('failed stop uses an existing toast and restores the share window', async () => {
    const h = await harness({ stopFails: true });
    await h.click('[data-stop-sharing]');
    assert.equal(h.showToast.mock.callCount(), 1);
    assert.equal(h.controller.isOpen(), true);
    assert.equal(h.get('[data-copy-share]').hidden, false);
    h.controller.close();
  });

  it('shared action posts once and opens the same window for any owned list', async () => {
    const { createListMenuActions } =
      await import('../src/js/modules/list-menu-shared.js');
    const apiCall = mock.fn(async () => share);
    const openShareWindow = mock.fn();
    const showToast = mock.fn();
    const actions = createListMenuActions({
      apiCall,
      openShareWindow,
      showToast,
    });
    await actions.shareToListeningRoom('not main');
    assert.deepEqual(apiCall.mock.calls[0].arguments, [
      '/api/lists/not%20main/listening-room-share',
      { method: 'POST' },
    ]);
    assert.equal(openShareWindow.mock.calls[0].arguments[0], share);
    apiCall.mock.mockImplementation(async () => {
      throw new Error('Network');
    });
    await actions.shareToListeningRoom('not main');
    assert.deepEqual(showToast.mock.calls[0].arguments, [
      "Couldn't share the list. Try again.",
      'error',
    ]);
  });
});
