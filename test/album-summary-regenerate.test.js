const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// Single-album summary regeneration. The flow is start-and-poll, because the
// fetch can outlast any gateway sitting in front of the app. The modal must
// always land on a definite OK/failed state, and a stale response must never
// overwrite a newer run.

const IDS = [
  'regenerateSummaryModal',
  'regenerateSummaryIcon',
  'regenerateSummaryHeading',
  'regenerateSummarySubtitle',
  'regenerateSummaryDetail',
  'regenerateSummaryFooter',
  'regenerateSummaryCloseBtn',
];

const START_URL = '/api/admin/album-summaries/regenerate';
const STATUS_URL = '/api/admin/album-summaries/regenerate/status';

/** Minimal stand-in for the pieces of the DOM this module touches. */
function makeDoc() {
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
      toggle(c, force) {
        const set = nodes.get(id)._classes;
        if (force === undefined) {
          if (set.has(c)) set.delete(c);
          else set.add(c);
          return;
        }
        if (force) set.add(c);
        else set.delete(c);
      },
    },
    addEventListener() {},
    removeEventListener() {},
  });

  for (const id of IDS) nodes.set(id, makeNode(id));

  return {
    nodes,
    getElementById: (id) => nodes.get(id) || null,
    addEventListener() {},
    removeEventListener() {},
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

  /**
   * @param {Function} apiCall - receives (url, opts)
   */
  function build(apiCall) {
    const doc = makeDoc();
    const toasts = [];
    const timers = [];
    // Virtual clock: sleeping advances it, so poll timeouts are testable
    // without waiting on anything real.
    let clock = 0;
    const api = createAlbumSummaryRegenerate({
      doc,
      apiCall,
      showToast: (msg, kind) => toasts.push({ msg, kind }),
      setTimeoutFn: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clearTimeoutFn: () => {},
      nowFn: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    return { doc, toasts, timers, api };
  }

  /** An apiCall that accepts the start, then settles after `pollsUntilDone`. */
  function settleAfter(outcome, pollsUntilDone = 1) {
    let polls = 0;
    const seen = [];
    const fn = async (url) => {
      seen.push(url);
      if (url === START_URL) return { status: 'running' };
      polls++;
      return polls < pollsUntilDone ? { status: 'running' } : outcome;
    };
    fn.seen = seen;
    return fn;
  }

  it('reports a successful regeneration and self-dismisses', async () => {
    const { doc, timers, api } = build(settleAfter({ status: 'ok' }));

    const status = await api.regenerateSummary(ALBUM);

    assert.strictEqual(status, 'ok');
    assert.strictEqual(
      doc.nodes.get('regenerateSummaryHeading').textContent,
      'Summary regenerated'
    );
    assert.ok(isHidden(doc, 'regenerateSummaryFooter'));
    assert.strictEqual(timers.length, 1);
    timers[0]();
    assert.ok(isHidden(doc, 'regenerateSummaryModal'));
  });

  it('keeps polling while the job is still running', async () => {
    const apiCall = settleAfter({ status: 'ok' }, 4);
    const { api } = build(apiCall);

    const status = await api.regenerateSummary(ALBUM);

    assert.strictEqual(status, 'ok');
    const polls = apiCall.seen.filter((u) => u.startsWith(STATUS_URL)).length;
    assert.strictEqual(polls, 4, 'must poll until the job settles');
  });

  it('shows the album being worked on while it runs', async () => {
    let seenSubtitle = null;
    const { doc, api } = build(async (url) => {
      if (url === START_URL) {
        seenSubtitle = doc.nodes.get('regenerateSummarySubtitle').textContent;
        return { status: 'running' };
      }
      return { status: 'ok' };
    });

    await api.regenerateSummary(ALBUM);

    assert.strictEqual(seenSubtitle, 'Reign in Blood by Slayer');
  });

  it('keeps a failure on screen until it is acknowledged', async () => {
    const { doc, timers, api } = build(
      settleAfter({ status: 'failed', message: 'Claude is not configured' })
    );

    const status = await api.regenerateSummary(ALBUM);

    assert.strictEqual(status, 'failed');
    assert.strictEqual(
      doc.nodes.get('regenerateSummaryHeading').textContent,
      'Regeneration failed'
    );
    assert.strictEqual(
      doc.nodes.get('regenerateSummaryDetail').textContent,
      'Claude is not configured'
    );
    // A failure must not vanish on a timer before it has been read.
    assert.strictEqual(timers.length, 0);
    assert.ok(!isHidden(doc, 'regenerateSummaryFooter'));
    assert.ok(!isHidden(doc, 'regenerateSummaryModal'));
  });

  it('distinguishes "no summary found" from an outright failure', async () => {
    const { doc, api } = build(
      settleAfter({
        status: 'no_summary',
        message: 'No summary could be found for this album',
      })
    );

    const status = await api.regenerateSummary(ALBUM);

    assert.strictEqual(status, 'no_summary');
    assert.strictEqual(
      doc.nodes.get('regenerateSummaryHeading').textContent,
      'No summary found'
    );
  });

  it('surfaces the HTTP status when the body is not JSON', async () => {
    // A gateway 502 arrives as an HTML body, so apiCall can only produce its
    // generic message. Without the status appended, the admin cannot tell an
    // infrastructure failure from an application one.
    const gatewayError = new Error('HTTP error! status: 502');
    gatewayError.status = 502;
    const { doc, api } = build(async () => {
      throw gatewayError;
    });

    const status = await api.regenerateSummary(ALBUM);

    assert.strictEqual(status, 'failed');
    assert.match(
      doc.nodes.get('regenerateSummaryDetail').textContent,
      /502/,
      'the status must survive into the message'
    );
  });

  it('reports a lost job rather than polling forever', async () => {
    const missing = new Error('No regeneration for this album');
    missing.status = 404;
    const { doc, api } = build(async (url) => {
      if (url === START_URL) return { status: 'running' };
      throw missing;
    });

    const status = await api.regenerateSummary(ALBUM);

    assert.strictEqual(status, 'failed');
    assert.match(
      doc.nodes.get('regenerateSummaryDetail').textContent,
      /restart/i
    );
  });

  it('gives up if the job never settles', async () => {
    // Guards against an unbounded poll loop when the job stays 'running'.
    const { api } = build(async () => ({ status: 'running' }));

    const status = await api.regenerateSummary(ALBUM);

    assert.strictEqual(status, 'failed');
  });

  it('does not let a slow first run overwrite a newer one', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    let starts = 0;
    const { doc, api } = build(async (url) => {
      if (url === START_URL) {
        starts++;
        return { status: 'running' };
      }
      if (starts === 1) {
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

  it('reports what the model is doing, not just that it is busy', async () => {
    // A spinner tells you nothing. The phase comes from the blocks the turn
    // opens, so "Searching the web" means it really is searching.
    const phases = [
      { status: 'running', phase: 'thinking', searches: 0 },
      { status: 'running', phase: 'searching', searches: 2 },
      { status: 'ok' },
    ];
    let i = 0;
    const { doc, api } = build(async (url) => {
      if (url === START_URL) return { status: 'running' };
      return phases[i++];
    });

    const seen = [];
    const heading = doc.nodes.get('regenerateSummaryHeading');
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      heading,
      'textContent'
    );
    let value = originalDescriptor ? originalDescriptor.value : '';
    Object.defineProperty(heading, 'textContent', {
      get: () => value,
      set: (v) => {
        value = v;
        seen.push(v);
      },
    });

    const status = await api.regenerateSummary(ALBUM);

    assert.strictEqual(status, 'ok');
    assert.ok(seen.includes('Thinking'), `expected a thinking phase: ${seen}`);
    assert.ok(
      seen.includes('Searching the web'),
      `expected a searching phase: ${seen}`
    );
    assert.strictEqual(
      doc.nodes.get('regenerateSummaryDetail').textContent,
      '2 searches so far'
    );
  });

  it('refuses an album with no identity without calling the API', async () => {
    let called = false;
    const { toasts, api } = build(async () => {
      called = true;
      return { status: 'ok' };
    });

    const status = await api.regenerateSummary({ artist: 'A', album: 'B' });

    assert.strictEqual(status, 'failed');
    assert.strictEqual(called, false);
    assert.strictEqual(toasts.length, 1);
  });

  it('starts with the album id and polls for that same album', async () => {
    let startBody = null;
    const seen = [];
    const { api } = build(async (url, opts) => {
      seen.push(url);
      if (url === START_URL) {
        startBody = JSON.parse(opts.body);
        return { status: 'running' };
      }
      return { status: 'ok' };
    });

    await api.regenerateSummary(ALBUM);

    assert.deepStrictEqual(startBody, { albumId: 'a-1' });
    assert.ok(seen.some((u) => u === `${STATUS_URL}?albumId=a-1`));
  });
});
