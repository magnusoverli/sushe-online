const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createElement(overrides = {}) {
  const listeners = {};
  return {
    disabled: false,
    innerHTML: '',
    dataset: {},
    value: '',
    listeners,
    addEventListener(event, handler) {
      listeners[event] = handler;
    },
    querySelectorAll() {
      return [];
    },
    getAttribute(name) {
      return this.attributes?.[name] || null;
    },
    ...overrides,
  };
}

function createDocument(elementsById = {}) {
  return {
    getElementById(id) {
      return elementsById[id] || null;
    },
  };
}

describe('settings core handlers', () => {
  let createSettingsCoreHandlers;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/handlers/core-handlers.js');
    createSettingsCoreHandlers = module.createSettingsCoreHandlers;
  });

  it('handles action-bar service sync and refresh wiring', async () => {
    const syncBtn = createElement();
    const refreshBtn = createElement();
    const doc = createDocument({
      actionBarSync: syncBtn,
      actionBarRefresh: refreshBtn,
    });

    const apiCalls = [];
    const toasts = [];
    const loadedCategories = [];
    const categoryData = { integrations: { ok: true }, stats: { ok: true } };

    const handlers = createSettingsCoreHandlers({
      doc,
      win: { location: { href: '' } },
      apiCall: async (...args) => apiCalls.push(args),
      showToast: (...args) => toasts.push(args),
      categoryData,
      loadCategoryData: async (categoryId) => loadedCategories.push(categoryId),
    });

    handlers.attachActionBarHandlers('integrations');

    await syncBtn.listeners.click();
    await refreshBtn.listeners.click();

    assert.deepStrictEqual(apiCalls[0], [
      '/api/preferences/sync',
      { method: 'POST' },
    ]);
    assert.deepStrictEqual(loadedCategories, ['integrations', 'stats']);
    assert.deepStrictEqual(toasts[0], ['Services synced successfully']);
    assert.deepStrictEqual(toasts[1], ['Stats refreshed']);
    assert.strictEqual(categoryData.integrations, undefined);
    assert.strictEqual(categoryData.stats, undefined);
    assert.match(syncBtn.innerHTML, /Sync Services/);
    assert.match(refreshBtn.innerHTML, /Refresh/);
  });

  it('wires integration redirects and disconnect/music-service callbacks', async () => {
    const connectSpotifyBtn = createElement();
    const disconnectLastfmBtn = createElement();
    const musicServiceSelect = createElement();
    const win = { location: { href: '' } };
    const disconnectCalls = [];
    const serviceSelections = [];

    const handlers = createSettingsCoreHandlers({
      doc: createDocument({
        connectSpotifyBtn,
        disconnectLastfmBtn,
        musicServiceSelect,
      }),
      win,
      handleDisconnect: async (service) => disconnectCalls.push(service),
      handleMusicServiceChange: async (service) =>
        serviceSelections.push(service),
    });

    handlers.attachIntegrationsHandlers();

    connectSpotifyBtn.listeners.click();
    await disconnectLastfmBtn.listeners.click();
    musicServiceSelect.listeners.change({ target: { value: 'qobuz' } });

    assert.strictEqual(win.location.href, '/auth/spotify');
    assert.deepStrictEqual(disconnectCalls, ['lastfm']);
    assert.deepStrictEqual(serviceSelections, ['qobuz']);
  });

  it('wires visual and preferences controls to delegated handlers', () => {
    const accentColor = createElement();
    const timeFormat = createElement();
    const dateFormat = createElement();
    const checkbox = createElement({ dataset: { settingsColumnId: 'artist' } });
    const columnVisibilityToggles = createElement({
      querySelectorAll() {
        return [checkbox];
      },
    });

    const spotifyBtn = createElement({
      attributes: { 'data-service': 'spotify', 'data-range': 'medium_term' },
    });
    const lastfmBtn = createElement({
      attributes: { 'data-service': 'lastfm', 'data-range': 'overall' },
    });
    const spotifyRangeButtons = createElement({
      querySelectorAll() {
        return [spotifyBtn];
      },
    });
    const lastfmRangeButtons = createElement({
      querySelectorAll() {
        return [lastfmBtn];
      },
    });
    const syncPreferencesBtn = createElement();

    const calls = {
      accent: [],
      time: [],
      date: [],
      columns: [],
      ranges: [],
      sync: 0,
    };

    const handlers = createSettingsCoreHandlers({
      doc: createDocument({
        accentColor,
        timeFormatSelect: timeFormat,
        dateFormatSelect: dateFormat,
        columnVisibilityToggles,
        spotifyRangeButtons,
        lastfmRangeButtons,
        syncPreferencesBtn,
      }),
      handleAccentColorChange: (value) => calls.accent.push(value),
      handleTimeFormatChange: (value) => calls.time.push(value),
      handleDateFormatChange: (value) => calls.date.push(value),
      toggleColumnVisibility: (id) => calls.columns.push(id),
      handleSetTimeRange: (service, range) =>
        calls.ranges.push([service, range]),
      handleSyncPreferences: () => {
        calls.sync += 1;
      },
    });

    handlers.attachVisualHandlers();
    handlers.attachPreferencesHandlers();
    handlers.attachStatsHandlers();

    accentColor.listeners.change({ target: { value: '#123456' } });
    timeFormat.listeners.change({ target: { value: '12h' } });
    dateFormat.listeners.change({ target: { value: 'DD/MM/YYYY' } });
    checkbox.listeners.change();
    syncPreferencesBtn.listeners.click();
    spotifyBtn.listeners.click();
    lastfmBtn.listeners.click();

    assert.deepStrictEqual(calls.accent, ['#123456']);
    assert.deepStrictEqual(calls.time, ['12h']);
    assert.deepStrictEqual(calls.date, ['DD/MM/YYYY']);
    assert.deepStrictEqual(calls.columns, ['artist']);
    assert.deepStrictEqual(calls.ranges, [
      ['spotify', 'medium_term'],
      ['lastfm', 'overall'],
    ]);
    assert.strictEqual(calls.sync, 1);
  });

  it('wires account button callbacks', () => {
    const ids = [
      'changeEmailBtn',
      'saveEmailBtn',
      'cancelEmailBtn',
      'changePasswordBtn',
      'editUsernameBtn',
      'saveUsernameBtn',
      'cancelUsernameBtn',
      'requestAdminBtn',
    ];

    const elements = Object.fromEntries(ids.map((id) => [id, createElement()]));
    const events = [];
    const handlers = createSettingsCoreHandlers({
      doc: createDocument(elements),
      handleEditEmail: () => events.push('editEmail'),
      handleSaveEmail: () => events.push('saveEmail'),
      handleCancelEmail: () => events.push('cancelEmail'),
      handleChangePassword: () => events.push('changePassword'),
      handleEditUsername: () => events.push('editUsername'),
      handleSaveUsername: () => events.push('saveUsername'),
      handleCancelUsername: () => events.push('cancelUsername'),
      handleRequestAdmin: () => events.push('requestAdmin'),
    });

    handlers.attachAccountHandlers();

    elements.changeEmailBtn.listeners.click();
    elements.saveEmailBtn.listeners.click();
    elements.cancelEmailBtn.listeners.click();
    elements.changePasswordBtn.listeners.click();
    elements.editUsernameBtn.listeners.click();
    elements.saveUsernameBtn.listeners.click();
    elements.cancelUsernameBtn.listeners.click();
    elements.requestAdminBtn.listeners.click();

    assert.deepStrictEqual(events, [
      'editEmail',
      'saveEmail',
      'cancelEmail',
      'changePassword',
      'editUsername',
      'saveUsername',
      'cancelUsername',
      'requestAdmin',
    ]);
  });
});
