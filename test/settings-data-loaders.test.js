const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');

describe('settings data loaders', () => {
  let createSettingsDataLoaders;
  const originalWindow = global.window;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/data-loaders.js');
    createSettingsDataLoaders = module.createSettingsDataLoaders;
    global.window = { currentUser: {} };
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  it('loads account data from current user', async () => {
    window.currentUser = {
      email: 'user@example.com',
      username: 'user1',
      role: 'admin',
      createdAt: '2024-01-01T00:00:00.000Z',
    };

    const { loadAccountData } = createSettingsDataLoaders({
      apiCall: mock.fn(),
    });

    const result = await loadAccountData();
    assert.deepStrictEqual(result, {
      email: 'user@example.com',
      username: 'user1',
      role: 'admin',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('returns hasData false when preferences payload is empty', async () => {
    const { loadPreferencesData } = createSettingsDataLoaders({
      apiCall: mock.fn(async () => ({})),
    });

    const result = await loadPreferencesData();
    assert.deepStrictEqual(result, { hasData: false });
  });

  it('loads stats data with list count and system stats', async () => {
    const apiCall = mock.fn(async (path) => {
      if (path === '/api/preferences/summary') {
        return {
          data: {
            totalAlbums: 12,
            totalScrobbles: 345,
            hasSpotify: true,
            hasLastfm: false,
          },
        };
      }
      if (path === '/api/user/lists-summary') {
        return { lists: [{}, {}, {}] };
      }
      if (path === '/api/stats') {
        return { uptimeSeconds: 100 };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const { loadStatsData } = createSettingsDataLoaders({ apiCall });
    const result = await loadStatsData();

    assert.deepStrictEqual(result, {
      totalAlbums: 12,
      totalScrobbles: 345,
      hasSpotify: true,
      hasLastfm: false,
      listCount: 3,
      systemStats: { uptimeSeconds: 100 },
    });
  });

  it('loads admin data from bootstrap endpoint', async () => {
    const apiCall = mock.fn(async (path) => {
      if (path === '/api/admin/bootstrap') {
        return {
          hasData: true,
          aggregateLists: [
            {
              year: 2024,
              recStatus: { locked: true },
            },
          ],
        };
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    const { loadAdminData } = createSettingsDataLoaders({ apiCall });
    const result = await loadAdminData();

    assert.strictEqual(result.hasData, true);
    assert.strictEqual(result.aggregateLists.length, 1);
    assert.strictEqual(result.aggregateLists[0].year, 2024);
    assert.strictEqual(result.aggregateLists[0].recStatus.locked, true);
    assert.strictEqual(apiCall.mock.calls.length, 1);
    assert.strictEqual(
      apiCall.mock.calls[0].arguments[0],
      '/api/admin/bootstrap'
    );
  });
});
