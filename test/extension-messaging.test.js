const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(overrides = {}) {
  const session = {};
  const local = {};
  const runtime = {
    id: 'extension-id',
    getURL: (page) => `chrome-extension://extension-id/${page}`,
    sendMessage: async () => ({ success: true }),
  };
  const chrome = {
    runtime,
    tabs: { create: async () => ({ id: 42 }), update: async () => {} },
    storage: {
      session: {
        get: async () => ({ ...session }),
        set: async (data) => Object.assign(session, data),
        remove: async (key) => {
          delete session[key];
        },
      },
      local: { set: async (data) => Object.assign(local, data) },
    },
  };
  const context = vm.createContext({
    chrome,
    URL,
    AbortSignal: globalThis.AbortSignal,
  });
  for (const file of [
    'extension-constants.js',
    'shared-utils.js',
    'message-policy.js',
    'login-flow.js',
  ]) {
    vm.runInContext(
      readFileSync(path.join(__dirname, '../browser-extension', file), 'utf8'),
      context
    );
  }
  const flow = context.ExtensionLoginFlow.createLoginFlow({
    chrome,
    getApiBase: () => 'https://sushe.test',
    fetch: async () => ({ ok: true, json: async () => ({ valid: true }) }),
    ...overrides,
  });
  return { context, chrome, runtime, flow, session, local };
}

test('extension controls accept their own top-level pages with or without tabs', () => {
  const { context, runtime } = harness();
  const { ACTIONS } = context.ExtensionConstants;
  for (const page of ['options.html', 'popup.html']) {
    for (const tab of [undefined, { id: 12 }]) {
      for (const action of [
        ACTIONS.UPDATE_API_URL,
        ACTIONS.START_LOGIN,
        ACTIONS.LOGOUT,
        ACTIONS.GET_POPUP_STATE,
      ]) {
        assert.equal(
          context.ExtensionMessagePolicy.isAllowedMessage(
            { action },
            { id: runtime.id, url: runtime.getURL(page), tab, frameId: 0 },
            runtime
          ),
          true
        );
      }
    }
  }
});

test('privileged messages reject content scripts, other extensions, subframes and malformed senders', () => {
  const { context, runtime } = harness();
  const good = {
    id: runtime.id,
    url: runtime.getURL('options.html'),
    frameId: 0,
  };
  for (const sender of [
    undefined,
    { ...good, id: 'another-extension' },
    { ...good, frameId: 1 },
    { ...good, url: 'https://sushe.test/extension/auth', tab: { id: 1 } },
    { ...good, url: 'https://rateyourmusic.com/', tab: { id: 1 } },
    { ...good, url: runtime.getURL('content-script.js') },
    { ...good, url: 'not a URL' },
  ]) {
    for (const action of [
      'updateApiUrl',
      'startExtensionLogin',
      'logout',
      'getLists',
    ]) {
      assert.equal(
        context.ExtensionMessagePolicy.isAllowedMessage(
          { action },
          sender,
          runtime
        ),
        false
      );
    }
  }
  for (const message of [null, {}, { action: 1 }, { action: 'unknown' }]) {
    assert.equal(
      context.ExtensionMessagePolicy.isAllowedMessage(message, good, runtime),
      false
    );
  }
});

test('RYM-only actions require a real RYM content-script sender', () => {
  const { context, runtime } = harness();
  for (const action of [
    'rymPageLoaded',
    'getAlbumPresence',
    'openAlbumInSushe',
  ]) {
    for (const [url, allowed] of [
      ['https://rateyourmusic.com/release/album/test', true],
      ['https://www.rateyourmusic.com/', true],
      ['https://rateyourmusic.com.evil.test/', false],
      ['https://evilrateyourmusic.com/', false],
      ['https://sushe.test/extension/auth', false],
    ]) {
      assert.equal(
        context.ExtensionMessagePolicy.isAllowedMessage(
          { action },
          { id: runtime.id, url, tab: { id: 1 }, frameId: 0 },
          runtime
        ),
        allowed
      );
    }
  }
});

test('instance URLs are canonical origins supported by login and manifest permissions', () => {
  const normalize = harness().context.SharedUtils.normalizeApiUrl;
  assert.equal(normalize(' https://SuShe.test:443/ '), 'https://sushe.test');
  assert.equal(normalize('http://localhost:3000/'), 'http://localhost:3000');
  assert.equal(normalize('http://127.0.0.1:4000'), 'http://127.0.0.1:4000');
  for (const value of [
    null,
    {},
    '',
    'not a URL',
    'http://sushe.test',
    'ftp://sushe.test',
    'https://user:password@sushe.test',
    'https://sushe.test/login',
    'https://sushe.test/?next=foo',
    'https://sushe.test/#login',
    'http://[::1]:3000',
  ]) {
    assert.throws(() => normalize(value));
  }
});

test('UI requests surface negative responses, absent responses and transport failures', async () => {
  const { context, runtime } = harness();
  const send = context.SharedUtils.sendCheckedMessage;
  for (const response of [undefined, { success: false, error: 'Denied' }]) {
    runtime.sendMessage = async () => response;
    await assert.rejects(send('startExtensionLogin'));
  }
  runtime.sendMessage = async () => {
    throw new Error('Worker unavailable');
  };
  await assert.rejects(send('logout'), /Worker unavailable/);
  runtime.sendMessage = async () => ({
    success: true,
    apiUrl: 'https://sushe.test',
  });
  assert.equal((await send('updateApiUrl')).apiUrl, 'https://sushe.test');
});

const completion = { token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' };
const authSender = {
  tab: { id: 42 },
  frameId: 0,
  url: 'https://sushe.test/extension/auth',
};

test('cancelled, expired, wrong-tab and rejected login completions never persist credentials', async () => {
  const { flow, session, local } = harness();
  await flow.begin();
  await assert.rejects(
    flow.complete(completion, { ...authSender, tab: { id: 43 } }),
    /No matching/
  );
  session.pendingExtensionLogin.expiresAt = 0;
  await assert.rejects(flow.complete(completion, authSender), /No matching/);
  await flow.begin();
  await flow.cancel();
  await assert.rejects(flow.complete(completion, authSender), /No matching/);
  assert.deepEqual(local, {});
  const rejected = harness({ fetch: async () => ({ ok: false }) });
  await rejected.flow.begin();
  await assert.rejects(
    rejected.flow.complete(completion, authSender),
    /rejected/
  );
  assert.deepEqual(rejected.local, {});
});

test('failed tab navigation clears pending login and can be retried', async () => {
  const { chrome, flow, session } = harness();
  chrome.tabs.update = async () => {
    throw new Error('Tab closed');
  };
  await assert.rejects(flow.begin(), /Tab closed/);
  assert.deepEqual(session, {});
  chrome.tabs.update = async () => {};
  await flow.begin();
  assert.equal(session.pendingExtensionLogin.tabId, 42);
});

test('login validation uses the configured origin, bearer-only auth and a timeout shorter than the page handshake', async () => {
  let request;
  const { flow, local } = harness({
    fetch: async (...args) => {
      request = args;
      return { ok: true, json: async () => ({ valid: true }) };
    },
  });
  await flow.begin();
  await flow.complete(completion, authSender);
  assert.equal(request[0], 'https://sushe.test/api/auth/validate-token');
  assert.equal(request[1].credentials, 'omit');
  assert.equal(request[1].headers.Authorization, `Bearer ${completion.token}`);
  assert.equal(request[2], 10000);
  assert.equal(local.authToken, completion.token);
});
