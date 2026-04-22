const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

describe('settings admin renderer', () => {
  let createSettingsAdminRenderer;
  const originalWindow = global.window;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/renderers/admin-renderer.js');
    createSettingsAdminRenderer = module.createSettingsAdminRenderer;
    global.window = { currentUser: { _id: 'u1', username: 'alice' } };
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  it('renders loading state when admin data is unavailable', () => {
    const { renderAdminCategory } = createSettingsAdminRenderer();

    const html = renderAdminCategory({ hasData: false });

    assert.match(html, /Loading admin data/);
    assert.match(html, /Admin Panel/);
  });

  it('renders baseline admin sections with empty data', () => {
    const { renderAdminCategory } = createSettingsAdminRenderer();

    const html = renderAdminCategory({
      hasData: true,
      aggregateLists: [],
      users: [],
      events: { pending: [], counts: { total: 0, byType: {}, byPriority: {} } },
      telegram: { configured: false },
      telegramRecs: { configured: false, recommendationsEnabled: false },
    });

    assert.match(html, /Aggregate Lists/);
    assert.match(html, /No main lists found/);
    assert.match(html, /Pending Events/);
    assert.match(html, /No pending events/);
    assert.match(html, /Telegram Notifications/);
    assert.match(html, /Not configured/);
    assert.match(html, /id="configureTelegramBtn"/);
    assert.match(html, /Database Management/);
    assert.match(html, /Catalog Cleanup/);
  });

  it('renders aggregate and user controls from populated admin data', () => {
    const { renderAdminCategory } = createSettingsAdminRenderer();

    const html = renderAdminCategory({
      hasData: true,
      aggregateLists: [
        {
          year: 2024,
          status: {
            revealed: false,
            confirmationCount: 1,
            requiredConfirmations: 2,
            confirmations: [{ username: 'alice' }],
            locked: true,
          },
          stats: {
            participantCount: 3,
            totalAlbums: 10,
            albumsWith3PlusVoters: 2,
            albumsWith2Voters: 4,
          },
          recStatus: { locked: false },
        },
      ],
      users: [
        {
          _id: 'u1',
          username: 'alice',
          role: 'admin',
          email: 'alice@example.com',
          listCount: 4,
        },
        {
          _id: 'u2',
          username: 'bob',
          role: 'user',
          email: 'bob@example.com',
          listCount: 1,
        },
      ],
      events: { pending: [], counts: { total: 0, byType: {}, byPriority: {} } },
      telegram: { configured: true, chatTitle: 'Test Group', topicName: null },
      telegramRecs: { configured: true, recommendationsEnabled: true },
    });

    assert.match(html, /2024/);
    assert.match(html, /1\/2 Confirmations/);
    assert.match(html, /aggregate-revoke-confirm/);
    assert.match(html, /Manage Contributors/);
    assert.match(html, /User Management/);
    assert.match(html, /\(You\)/);
    assert.match(html, /Grant Admin/);
    assert.match(html, /Connected to Test Group/);
    assert.match(html, /id="toggleTelegramRecsBtn"/);
    assert.match(html, /Disable/);
  });
});
