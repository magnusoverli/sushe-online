const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(...classes) {
      classes.forEach((c) => set.add(c));
    },
    remove(...classes) {
      classes.forEach((c) => set.delete(c));
    },
    has(className) {
      return set.has(className);
    },
  };
}

function createElement(overrides = {}) {
  return {
    value: '',
    disabled: false,
    textContent: '',
    classList: createClassList(),
    dataset: {},
    querySelectorAll() {
      return [];
    },
    getAttribute(name) {
      return this.attributes?.[name] || null;
    },
    ...overrides,
  };
}

function createDocument({ ids = {}, sections = [] } = {}) {
  return {
    documentElement: {
      style: {
        setPropertyCalls: [],
        setProperty(name, value) {
          this.setPropertyCalls.push([name, value]);
        },
      },
    },
    getElementById(id) {
      return ids[id] || null;
    },
    querySelectorAll(selector) {
      if (selector.includes('[data-content]')) return sections;
      return [];
    },
  };
}

describe('settings preference actions', () => {
  let createSettingsPreferenceActions;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/handlers/preference-actions.js');
    createSettingsPreferenceActions = module.createSettingsPreferenceActions;
  });

  it('confirms disconnect and redirects to service disconnect URL', async () => {
    const win = { location: { href: '' } };
    const prompts = [];

    const { handleDisconnect } = createSettingsPreferenceActions({
      doc: createDocument(),
      win,
      categoryData: {},
      showConfirmation: async (...args) => {
        prompts.push(args);
        return true;
      },
      apiCall: async () => ({}),
      showToast: () => {},
      loadCategoryData: async () => {},
    });

    await handleDisconnect('spotify');

    assert.strictEqual(win.location.href, '/auth/spotify/disconnect');
    assert.match(prompts[0][0], /Disconnect Spotify/);
  });

  it('updates music service cache and current user on success', async () => {
    const categoryData = { integrations: { musicService: '' } };
    const win = { currentUser: { musicService: null } };
    const apiCalls = [];
    const toasts = [];

    const { handleMusicServiceChange } = createSettingsPreferenceActions({
      doc: createDocument(),
      win,
      categoryData,
      showConfirmation: async () => true,
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true };
      },
      showToast: (...args) => toasts.push(args),
      loadCategoryData: async () => {},
    });

    await handleMusicServiceChange('qobuz');

    assert.deepStrictEqual(apiCalls[0], [
      '/settings/update-music-service',
      { method: 'POST', body: JSON.stringify({ musicService: 'qobuz' }) },
    ]);
    assert.strictEqual(categoryData.integrations.musicService, 'qobuz');
    assert.strictEqual(win.currentUser.musicService, 'qobuz');
    assert.deepStrictEqual(toasts[0], ['Music service updated!']);
  });

  it('syncs preferences and reloads preferences category data', async () => {
    const syncBtn = createElement();
    const syncIcon = createElement();
    const syncText = createElement({ textContent: 'Sync Now' });
    const categoryData = { preferences: { hasData: true } };
    const loadCalls = [];

    const { handleSyncPreferences } = createSettingsPreferenceActions({
      doc: createDocument({
        ids: {
          syncPreferencesBtn: syncBtn,
          syncIcon,
          syncText,
        },
      }),
      win: {},
      categoryData,
      showConfirmation: async () => true,
      apiCall: async () => ({ success: true }),
      showToast: () => {},
      loadCategoryData: async (categoryId) => loadCalls.push(categoryId),
    });

    await handleSyncPreferences();

    assert.strictEqual(syncBtn.disabled, false);
    assert.strictEqual(syncText.textContent, 'Sync Now');
    assert.strictEqual(syncIcon.classList.has('fa-spin'), false);
    assert.strictEqual(categoryData.preferences, null);
    assert.deepStrictEqual(loadCalls, ['preferences']);
  });

  it('toggles active range button and section visibility', () => {
    const spotifyShortBtn = createElement({
      attributes: { 'data-range': 'short_term' },
      classList: createClassList(['bg-green-600', 'text-white']),
    });
    const spotifyMediumBtn = createElement({
      attributes: { 'data-range': 'medium_term' },
      classList: createClassList(['bg-gray-700', 'text-gray-300']),
    });
    const spotifyRangeButtons = createElement({
      querySelectorAll() {
        return [spotifyShortBtn, spotifyMediumBtn];
      },
    });

    const shortSection = createElement({
      attributes: { 'data-range': 'short_term' },
      classList: createClassList(),
    });
    const mediumSection = createElement({
      attributes: { 'data-range': 'medium_term' },
      classList: createClassList(['hidden']),
    });

    const { handleSetTimeRange } = createSettingsPreferenceActions({
      doc: createDocument({
        ids: { spotifyRangeButtons },
        sections: [shortSection, mediumSection],
      }),
      win: {},
      categoryData: {},
      showConfirmation: async () => true,
      apiCall: async () => ({}),
      showToast: () => {},
      loadCategoryData: async () => {},
    });

    handleSetTimeRange('spotify', 'medium_term');

    assert.strictEqual(spotifyMediumBtn.classList.has('bg-green-600'), true);
    assert.strictEqual(spotifyShortBtn.classList.has('bg-gray-700'), true);
    assert.strictEqual(mediumSection.classList.has('hidden'), false);
    assert.strictEqual(shortSection.classList.has('hidden'), true);
  });

  it('reverts accent color input on save error', async () => {
    const accentColorInput = createElement({ value: '#ffffff' });
    const doc = createDocument({ ids: { accentColor: accentColorInput } });
    const categoryData = { visual: { accentColor: '#123456' } };
    const toasts = [];

    const { handleAccentColorChange } = createSettingsPreferenceActions({
      doc,
      win: { currentUser: {} },
      categoryData,
      showConfirmation: async () => true,
      apiCall: async () => {
        throw new Error('save failed');
      },
      showToast: (...args) => toasts.push(args),
      loadCategoryData: async () => {},
    });

    await handleAccentColorChange('#abcdef');

    assert.deepStrictEqual(toasts[0], [
      'Failed to update accent color',
      'error',
    ]);
    assert.strictEqual(accentColorInput.value, '#123456');
  });
});
