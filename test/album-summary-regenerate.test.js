const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// Single-album summary regeneration: the modal must always land on a definite
// OK/failed state, and must never let a stale response overwrite a newer run.

const IDS = [
  'regenerateSummaryModal',
  'regenerateSummaryIcon',
  'regenerateSummaryHeading',
  'regenerateSummarySubtitle',
  'regenerateSummaryDetail',
  'regenerateSummaryFooter',
  'regenerateSummaryCloseBtn',
];

/** Minimal stand-in for the pieces of the DOM this module touches. */
function makeDoc() {
  const listeners = new Map();
  const nodes = new Map();

  const makeNode = (id) => ({
    id,
    _classes: new Set(id === 'regenerateSummaryModal' ? ['hidden'] : []),
    textContent: '',
    innerHTML: '',
    className: '',
    classList: {
      add(c) {
        nodes.get(id)._classes.add(c);
      },
      remove(c) {
        nodes.get(id)._classes.delete(c);
      },
      contains(c) {
        return nodes.get(id)._classes.has(c);
      },
    },
    addEventListener() {},
    removeEventListener() {},
  });

  for (const id of IDS) nodes.set(id, makeNode(id));

  return {
    nodes,
    getElementById: (id) => nodes.get(id) || null,
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };
}

function isHidden(doc, id) {
  return doc.nodes.get(id).classList.contains('hidden');
}

describe('createAlbumSummaryRegenerate', () => {
  let createAlbumSummaryRegenerate;

  beforeEach(async () => {
    const mod = await import('../src/js/modules/album-summary-regenerate.js');
    createAlbumSummaryRegenerate = mod.createAlbumSummaryRegenerate;
  });

  const ALBUM = { artist: 'Slayer', album: 'Reign in Blood', album_id: 'a-1' };

  function build(apiCall, overrides = {}) {
    const doc = makeDoc();
    const toasts = [];
    const timers = [];
    const api = createAlbumSummaryRegenerate({
      doc,
      apiCall,
      showToast: (msg, kind) => toasts.push({ msg, kind }),
      setTimeoutFn: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clearTimeoutFn: () => {},
      ...overrides,
    });
    return { doc, toasts, timers, api };
  }

  it('reports a successful regeneration and self-dismisses', async () => {
    const { doc, timers, api } = build(async () => ({
      status: 'ok',
      source: 'claude',
    }));

    const status = await api.regenerateSummary(ALBUM);

    assert.strictEqual(status, 'ok');
    assert.strictEqual(
      doc.nodes.get('regenerateSummaryHeading').textContent,
      'Summary regenerated'
    );
    // Success needs no acknowledgement, so no dismiss button is offered...
    assert.ok(isHidden(doc, 'regenerateSummaryFooter'));
    // ...but a timer must exist, or the modal would never close.
    assert.strictEqual(timers.length, 1);
    timers[0]();
    assert.ok(isHidden(doc, 'regenerateSummaryModal'));
  });

  it('shows the album being worked on while it runs', async () => {
    let seenSubtitle = null;
    const { doc, api } = build(async () => {
      seenSubtitle = doc.nodes.get('regenerateSummarySubtitle').textContent;
      return { status: 'ok' };
    });

    await api.regenerateSummary(ALBUM);

    assert.strictEqual(seenSubtitle, 'Reign in Blood by Slayer');
  });

  it('keeps a failure on screen until it is acknowledged', async () => {
    const err = new Error('boom');
    err.data = { error: 'Summary regeneration failed' };
    const { doc, timers, api } = build(async () => {
      throw err;
    });

    const status = await api.regenerateSummary(ALBUM);

    assert.strictEqual(status, 'failed');
    assert.strictEqual(
      doc.nodes.get('regenerateSummaryHeading').textContent,
      'Regeneration failed'
    );
    assert.strictEqual(
      doc.nodes.get('regenerateSummaryDetail').textContent,
      'Summary regeneration failed'
    );
    // A failure must not vanish on a timer before it has been read.
    assert.strictEqual(timers.length, 0);
    assert.ok(!isHidden(doc, 'regenerateSummaryFooter'));
    assert.ok(!isHidden(doc, 'regenerateSummaryModal'));
  });

  it('distinguishes "no summary found" from an outright failure', async () => {
    const { doc, api } = build(async () => ({
      status: 'no_summary',
      message: 'No summary could be found for this album',
    }));

    const status = await api.regenerateSummary(ALBUM);

    assert.strictEqual(status, 'no_summary');
    assert.strictEqual(
      doc.nodes.get('regenerateSummaryHeading').textContent,
      'No summary found'
    );
  });

  it('does not let a slow first run overwrite a newer one', async () => {
    // The admin fires a second regeneration before the first replies. The
    // stale reply must not repaint the modal the second run now owns.
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    let call = 0;
    const { doc, api } = build(async () => {
      call++;
      if (call === 1) {
        await gate;
        return { status: 'failed', message: 'stale' };
      }
      return { status: 'ok' };
    });

    const first = api.regenerateSummary(ALBUM);
    const second = await api.regenerateSummary(ALBUM);
    release();
    await first;

    assert.strictEqual(second, 'ok');
    assert.strictEqual(
      doc.nodes.get('regenerateSummaryHeading').textContent,
      'Summary regenerated',
      'the stale first response must not repaint the second run'
    );
  });

  it('refuses an album with no identity without calling the API', async () => {
    let called = false;
    const { toasts, api } = build(async () => {
      called = true;
      return { status: 'ok' };
    });

    const status = await api.regenerateSummary({
      artist: 'A',
      album: 'B',
    });

    assert.strictEqual(status, 'failed');
    assert.strictEqual(called, false);
    assert.strictEqual(toasts.length, 1);
  });

  it('posts the album id to the admin endpoint', async () => {
    let seen = null;
    const { api } = build(async (url, opts) => {
      seen = { url, body: JSON.parse(opts.body) };
      return { status: 'ok' };
    });

    await api.regenerateSummary(ALBUM);

    assert.strictEqual(seen.url, '/api/admin/album-summaries/regenerate');
    assert.deepStrictEqual(seen.body, { albumId: 'a-1' });
  });
});
