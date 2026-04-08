const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

describe('settings core renderers', () => {
  let createSettingsCoreRenderers;
  const originalWindow = global.window;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/renderers/core-renderers.js');
    createSettingsCoreRenderers = module.createSettingsCoreRenderers;
    global.window = { currentUser: { dateFormat: 'MM/DD/YYYY' } };
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  it('renders account inputs using in-progress edit state', () => {
    const categoryData = {
      account: {
        editingUsername: true,
        tempUsername: 'new-name',
        editingEmail: true,
        tempEmail: 'new@example.com',
      },
    };

    const { renderAccountCategory } = createSettingsCoreRenderers({
      categoryData,
    });

    const html = renderAccountCategory({
      username: 'original-name',
      email: 'old@example.com',
      role: 'user',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    assert.match(html, /id="usernameInput" value="new-name"/);
    assert.match(html, /id="emailInput" value="new@example.com"/);
    assert.match(html, /id="requestAdminBtn"/);
  });

  it('renders visual category using injected column visibility helpers', () => {
    const { renderVisualCategory } = createSettingsCoreRenderers({
      getToggleableColumns: () => [
        { id: 'artist', label: 'Artist' },
        { id: 'year', label: 'Year' },
      ],
      isColumnVisible: (columnId) => columnId === 'artist',
    });

    const html = renderVisualCategory({
      accentColor: '#123456',
      timeFormat: '12h',
      dateFormat: 'DD/MM/YYYY',
    });

    assert.match(html, /id="accentColor"/);
    assert.match(html, /value="12h" selected/);
    assert.match(html, /value="DD\/MM\/YYYY" selected/);

    const artistSegmentStart = html.indexOf('data-settings-column-id="artist"');
    const yearSegmentStart = html.indexOf('data-settings-column-id="year"');
    assert.ok(artistSegmentStart >= 0);
    assert.ok(yearSegmentStart >= 0);

    const artistSegment = html.slice(
      artistSegmentStart,
      artistSegmentStart + 180
    );
    const yearSegment = html.slice(yearSegmentStart, yearSegmentStart + 180);

    assert.match(artistSegment, /checked/);
    assert.doesNotMatch(yearSegment, /checked/);
  });

  it('renders stats with optional sections based on data presence', () => {
    const { renderStatsCategory } = createSettingsCoreRenderers();

    const withStats = renderStatsCategory({
      listCount: 2,
      totalAlbums: 10,
      totalScrobbles: 1234,
      systemStats: {
        totalUsers: 5,
        totalLists: 12,
        totalAlbums: 100,
        adminUsers: 1,
        activeUsers: 3,
      },
    });

    const withoutScrobbles = renderStatsCategory({
      listCount: 2,
      totalAlbums: 10,
      totalScrobbles: 0,
      systemStats: null,
    });

    assert.match(withStats, /Total Scrobbles/);
    assert.match(withStats, /1(?:,|\s|\u00A0)234/);
    assert.match(withStats, /System Statistics/);

    assert.doesNotMatch(withoutScrobbles, /Total Scrobbles/);
    assert.doesNotMatch(withoutScrobbles, /System Statistics/);
  });
});
