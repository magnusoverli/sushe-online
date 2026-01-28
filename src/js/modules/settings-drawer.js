/**
 * Settings Drawer Module
 *
 * Manages the slide-over settings drawer with category navigation
 * and hybrid auto-save behavior.
 *
 * @module settings-drawer
 */

import { openDuplicateReviewModal } from './duplicate-review-modal.js';
import { openManualAlbumAudit } from './manual-album-audit-modal.js';

/**
 * Create settings drawer utilities with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Function} deps.showToast - Toast notification function
 * @param {Function} deps.showConfirmation - Modal confirmation function
 * @param {Function} deps.apiCall - API call function
 */
export function createSettingsDrawer(deps = {}) {
  const showToast = deps.showToast || (() => {});
  const showConfirmation =
    deps.showConfirmation || (() => Promise.resolve(false));
  const apiCall =
    deps.apiCall || (() => Promise.reject(new Error('apiCall not provided')));

  let currentCategory = 'account';
  const categoryData = {};
  let isOpen = false;
  let telegramModalState = null;

  /**
   * Open the settings drawer
   */
  function openDrawer() {
    const drawer = document.getElementById('settingsDrawer');
    if (!drawer) return;

    drawer.classList.add('open');
    document.body.style.overflow = 'hidden';
    isOpen = true;

    // Hide FAB and mobile now-playing bar on mobile
    const fab = document.getElementById('addAlbumFAB');
    const nowPlaying = document.getElementById('mobileNowPlaying');
    if (fab) {
      fab.style.opacity = '0';
      fab.style.pointerEvents = 'none';
    }
    if (nowPlaying) {
      nowPlaying.style.opacity = '0';
      nowPlaying.style.pointerEvents = 'none';
    }

    // Load initial category if not loaded
    if (!categoryData[currentCategory]) {
      loadCategoryData(currentCategory);
    }
  }

  /**
   * Close the settings drawer
   */
  function closeDrawer() {
    const drawer = document.getElementById('settingsDrawer');
    if (!drawer) return;

    drawer.classList.remove('open');
    document.body.style.overflow = '';
    isOpen = false;

    // Restore FAB and mobile now-playing bar visibility
    const fab = document.getElementById('addAlbumFAB');
    const nowPlaying = document.getElementById('mobileNowPlaying');
    const currentList = window.currentList || null;

    if (fab) {
      // Only show FAB if there's a current list (matches mobile menu pattern)
      if (currentList) {
        fab.style.opacity = '1';
        fab.style.pointerEvents = 'auto';
      }
    }
    if (nowPlaying) {
      nowPlaying.style.opacity = '';
      nowPlaying.style.pointerEvents = '';
    }
  }

  /**
   * Switch to a different category
   * @param {string} categoryId - Category ID (account, integrations, visual, stats)
   */
  async function switchCategory(categoryId) {
    if (categoryId === currentCategory) return;

    // Update active nav item
    document.querySelectorAll('.settings-nav-item').forEach((btn) => {
      btn.classList.remove('active');
      if (btn.dataset.category === categoryId) {
        btn.classList.add('active');
      }
    });

    currentCategory = categoryId;

    // Load category data if not cached
    if (!categoryData[categoryId]) {
      await loadCategoryData(categoryId);
    } else {
      renderCategoryContent(categoryId);
    }
  }

  /**
   * Load data for a category
   * @param {string} categoryId - Category ID
   */
  async function loadCategoryData(categoryId) {
    const contentEl = document.getElementById('settingsCategoryContent');
    if (!contentEl) return;

    // Show loading state
    contentEl.innerHTML = `
      <div class="flex items-center justify-center py-12">
        <div class="text-center">
          <i class="fas fa-spinner fa-spin text-2xl text-gray-400 mb-2"></i>
          <p class="text-gray-500">Loading...</p>
        </div>
      </div>
    `;

    try {
      let data = {};

      switch (categoryId) {
        case 'account':
          data = await loadAccountData();
          break;
        case 'integrations':
          data = await loadIntegrationsData();
          break;
        case 'visual':
          data = await loadVisualData();
          break;
        case 'preferences':
          data = await loadPreferencesData();
          break;
        case 'stats':
          data = await loadStatsData();
          break;
        case 'admin':
          data = await loadAdminData();
          break;
        default:
          console.error('Unknown category:', categoryId);
          return;
      }

      categoryData[categoryId] = data;
      renderCategoryContent(categoryId);
    } catch (error) {
      console.error('Error loading category data:', error);
      contentEl.innerHTML = `
        <div class="flex items-center justify-center py-12">
          <div class="text-center">
            <i class="fas fa-exclamation-circle text-2xl text-red-500 mb-2"></i>
            <p class="text-gray-500">Failed to load settings</p>
          </div>
        </div>
      `;
    }
  }

  /**
   * Render category content
   * @param {string} categoryId - Category ID
   */
  function renderCategoryContent(categoryId) {
    const contentEl = document.getElementById('settingsCategoryContent');
    if (!contentEl) return;

    const data = categoryData[categoryId] || {};

    switch (categoryId) {
      case 'account':
        contentEl.innerHTML = renderAccountCategory(data);
        attachAccountHandlers();
        break;
      case 'integrations':
        contentEl.innerHTML = renderIntegrationsCategory(data);
        attachIntegrationsHandlers();
        break;
      case 'visual':
        contentEl.innerHTML = renderVisualCategory(data);
        attachVisualHandlers();
        break;
      case 'preferences':
        contentEl.innerHTML = renderPreferencesCategory(data);
        attachPreferencesHandlers();
        break;
      case 'stats':
        contentEl.innerHTML = renderStatsCategory(data);
        attachStatsHandlers();
        break;
      case 'admin':
        contentEl.innerHTML = renderAdminCategory(data);
        attachAdminHandlers();
        break;
    }
  }

  /**
   * Load account data
   */
  async function loadAccountData() {
    try {
      // Use window.currentUser if available, otherwise use empty defaults
      const user = window.currentUser || {};
      // createdAt might not be in sanitized user, try to get from user object directly
      // If not available, we'll show "Unknown"
      return {
        email: user.email || '',
        username: user.username || '',
        role: user.role || 'user',
        createdAt: user.createdAt || user._createdAt || null,
      };
    } catch (error) {
      console.error('Error loading account data:', error);
      return { email: '', username: '', role: 'user', createdAt: null };
    }
  }

  /**
   * Load integrations data
   */
  async function loadIntegrationsData() {
    try {
      // Use window.currentUser if available
      const user = window.currentUser || {};
      // Check if auth objects exist (they're sanitized, so just check truthiness)
      return {
        spotify: {
          connected: !!user.spotifyAuth,
        },
        tidal: {
          connected: !!user.tidalAuth,
        },
        lastfm: {
          connected: !!user.lastfmUsername,
        },
        musicService: user.musicService || '',
        spotifyAuth: !!user.spotifyAuth,
        tidalAuth: !!user.tidalAuth,
      };
    } catch (error) {
      console.error('Error loading integrations data:', error);
      return {
        spotify: { connected: false },
        tidal: { connected: false },
        lastfm: { connected: false },
        musicService: '',
        spotifyAuth: false,
        tidalAuth: false,
      };
    }
  }

  /**
   * Load visual data
   */
  async function loadVisualData() {
    try {
      // Use window.currentUser if available
      const user = window.currentUser || {};
      return {
        accentColor: user.accentColor || '#dc2626',
        timeFormat: user.timeFormat || '24h',
        dateFormat: user.dateFormat || 'MM/DD/YYYY',
      };
    } catch (error) {
      console.error('Error loading visual data:', error);
      return {
        accentColor: '#dc2626',
        timeFormat: '24h',
        dateFormat: 'MM/DD/YYYY',
      };
    }
  }

  /**
   * Load preferences data
   */
  async function loadPreferencesData() {
    try {
      const prefs = await apiCall('/api/preferences');
      if (!prefs || !prefs.data) {
        return { hasData: false };
      }

      const data = prefs.data;

      // Fetch time-range-structured data for Spotify and Last.fm
      let spotifyArtistsByRange = {};
      let spotifyTracksByRange = {};
      let lastfmArtistsByRange = {};

      // Fetch Spotify time range data if Spotify is connected
      if (data.spotify?.syncedAt) {
        try {
          const [spotifyArtistsRes, spotifyTracksRes] = await Promise.all([
            apiCall('/api/preferences/spotify/artists'),
            apiCall('/api/preferences/spotify/tracks'),
          ]);

          if (
            spotifyArtistsRes?.data &&
            typeof spotifyArtistsRes.data === 'object' &&
            !Array.isArray(spotifyArtistsRes.data)
          ) {
            spotifyArtistsByRange = spotifyArtistsRes.data;
          }

          if (
            spotifyTracksRes?.data &&
            typeof spotifyTracksRes.data === 'object' &&
            !Array.isArray(spotifyTracksRes.data)
          ) {
            spotifyTracksByRange = spotifyTracksRes.data;
          }
        } catch (error) {
          console.warn('Error loading Spotify time range data:', error);
        }
      }

      // Fetch Last.fm time range data if Last.fm is connected
      if (data.lastfm?.syncedAt) {
        try {
          const lastfmArtistsRes = await apiCall(
            '/api/preferences/lastfm/artists'
          );

          if (
            lastfmArtistsRes?.data &&
            typeof lastfmArtistsRes.data === 'object' &&
            !Array.isArray(lastfmArtistsRes.data)
          ) {
            lastfmArtistsByRange = lastfmArtistsRes.data;
          }
        } catch (error) {
          console.warn('Error loading Last.fm time range data:', error);
        }
      }

      return {
        hasData: true,
        totalAlbums: data.totalAlbums || 0,
        topGenres: data.topGenres || [],
        topArtists: data.topArtists || [],
        topCountries: data.topCountries || [],
        genreAffinity: data.affinity?.genres || [],
        artistAffinity: data.affinity?.artists || [],
        spotify: {
          ...data.spotify,
          topArtistsByRange: spotifyArtistsByRange,
          topTracksByRange: spotifyTracksByRange,
        },
        lastfm: {
          ...data.lastfm,
          topArtistsByRange: lastfmArtistsByRange,
        },
        updatedAt: data.updatedAt,
      };
    } catch (error) {
      console.error('Error loading preferences data:', error);
      return { hasData: false };
    }
  }

  /**
   * Load stats data
   */
  async function loadStatsData() {
    try {
      const prefs = await apiCall('/api/preferences/summary');

      // Try to get list count from lists summary
      let listCount = 0;
      try {
        const listsSummary = await apiCall('/api/user/lists-summary');
        if (
          listsSummary &&
          listsSummary.lists &&
          Array.isArray(listsSummary.lists)
        ) {
          listCount = listsSummary.lists.length;
        }
      } catch (e) {
        // If lists-summary fails, we'll show 0
        console.warn('Could not fetch list count:', e);
      }

      // Load system stats
      let systemStats = null;
      try {
        systemStats = await apiCall('/api/stats');
      } catch (e) {
        console.warn('Could not load system stats:', e);
      }

      return {
        totalAlbums: prefs?.data?.totalAlbums || 0,
        totalScrobbles: prefs?.data?.totalScrobbles || 0,
        hasSpotify: prefs?.data?.hasSpotify || false,
        hasLastfm: prefs?.data?.hasLastfm || false,
        listCount: listCount,
        systemStats: systemStats,
      };
    } catch (error) {
      console.error('Error loading stats data:', error);
      return {
        totalAlbums: 0,
        totalScrobbles: 0,
        hasSpotify: false,
        hasLastfm: false,
        listCount: 0,
        systemStats: null,
      };
    }
  }

  /**
   * Load admin data
   */
  async function loadAdminData() {
    try {
      // Load admin events
      const eventsResponse = await apiCall('/api/admin/events?limit=50');
      const eventsCountsResponse = await apiCall('/api/admin/events/counts');

      // Load Telegram status
      let telegramStatus = null;
      try {
        telegramStatus = await apiCall('/api/admin/telegram/status');
      } catch (e) {
        console.warn('Could not load Telegram status:', e);
      }

      // Load admin stats
      let stats = null;
      try {
        stats = await apiCall('/api/admin/stats');
      } catch (e) {
        console.warn('Could not load admin stats:', e);
      }

      // Load users list
      let users = [];
      try {
        // We'll need to get users from stats or create a separate endpoint
        // For now, we'll get it from stats if available
        if (stats && stats.users) {
          users = stats.users;
        }
      } catch (e) {
        console.warn('Could not load users:', e);
      }

      // Load aggregate list years with status and stats
      let aggregateLists = [];
      try {
        const aggregateResponse = await apiCall(
          '/api/aggregate-list-years/with-main-lists'
        );
        if (
          aggregateResponse &&
          aggregateResponse.years &&
          aggregateResponse.years.length > 0
        ) {
          // Fetch status and stats for each year
          aggregateLists = await Promise.all(
            aggregateResponse.years.map(async (year) => {
              try {
                // Fetch status
                let status = {
                  exists: false,
                  revealed: false,
                  confirmations: [],
                  confirmationCount: 0,
                  requiredConfirmations: 2,
                };
                try {
                  const statusResponse = await apiCall(
                    `/api/aggregate-list/${year}/status`
                  );
                  status = statusResponse || status;
                } catch (e) {
                  console.warn(`Could not load status for year ${year}:`, e);
                }

                // Fetch stats
                let stats = null;
                try {
                  const statsResponse = await apiCall(
                    `/api/aggregate-list/${year}/stats`
                  );
                  if (statsResponse && statsResponse.stats) {
                    stats = statsResponse.stats;
                  }
                } catch (e) {
                  console.warn(`Could not load stats for year ${year}:`, e);
                }

                return {
                  year,
                  status,
                  stats,
                };
              } catch (e) {
                console.warn(
                  `Error loading aggregate list for year ${year}:`,
                  e
                );
                return {
                  year,
                  status: {
                    exists: false,
                    revealed: false,
                    confirmations: [],
                    confirmationCount: 0,
                    requiredConfirmations: 2,
                  },
                  stats: null,
                };
              }
            })
          );
        }
      } catch (e) {
        console.warn('Could not load aggregate lists:', e);
      }

      return {
        hasData: true,
        events: {
          pending: eventsResponse.events || [],
          counts: eventsCountsResponse || {
            total: 0,
            byType: {},
            byPriority: {},
          },
        },
        telegram: telegramStatus || { configured: false },
        stats: stats || null,
        users: users,
        aggregateLists: aggregateLists,
      };
    } catch (error) {
      console.error('Error loading admin data:', error);
      return { hasData: false };
    }
  }

  /**
   * Render Account category
   */
  function renderAccountCategory(data) {
    // Preserve editing state if we're re-rendering during edit
    const accountState = categoryData.account || {};
    const isEditingUsername = accountState.editingUsername || false;
    const isEditingEmail = accountState.editingEmail || false;
    const usernameValue = isEditingUsername
      ? accountState.tempUsername || data.username || ''
      : data.username || '';
    const emailValue = isEditingEmail
      ? accountState.tempEmail || data.email || ''
      : data.email || '';

    // Format member since date
    let memberSince = 'Unknown';
    if (data.createdAt) {
      try {
        const date = new Date(data.createdAt);
        const dateFormat = window.currentUser?.dateFormat || 'MM/DD/YYYY';
        if (dateFormat === 'DD/MM/YYYY') {
          memberSince = date.toLocaleDateString('en-GB');
        } else {
          memberSince = date.toLocaleDateString('en-US');
        }
      } catch (_e) {
        memberSince = 'Unknown';
      }
    }

    const roleDisplay =
      data.role === 'admin'
        ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-900/50 text-yellow-400 text-xs rounded-sm border border-yellow-600/30"><i class="fas fa-shield-alt"></i>Administrator</span>'
        : 'User';

    const isAdmin = data.role === 'admin';

    return `
      <div class="space-y-6">
        <div class="settings-group">
          <h3 class="settings-group-title">Account Information</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Email</label>
                ${
                  isEditingEmail
                    ? `<input type="email" id="emailInput" value="${emailValue}" class="settings-input" />`
                    : `<p class="settings-description">${data.email || 'Not set'}</p>`
                }
              </div>
              <div class="settings-row-control">
                ${
                  isEditingEmail
                    ? `<button id="saveEmailBtn" class="settings-button">Save</button>
                     <button id="cancelEmailBtn" class="settings-button ml-2">Cancel</button>`
                    : `<button id="changeEmailBtn" class="settings-button">Change</button>`
                }
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Username</label>
                ${
                  isEditingUsername
                    ? `<input type="text" id="usernameInput" value="${usernameValue}" class="settings-input" maxlength="30" />`
                    : `<p class="settings-description">${data.username || 'Not set'}</p>`
                }
              </div>
              <div class="settings-row-control">
                ${
                  isEditingUsername
                    ? `<button id="saveUsernameBtn" class="settings-button">Save</button>
                     <button id="cancelUsernameBtn" class="settings-button ml-2">Cancel</button>`
                    : `<button id="editUsernameBtn" class="settings-button">Edit</button>`
                }
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Role</label>
                <p class="settings-description">${roleDisplay}</p>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Member Since</label>
                <p class="settings-description">${memberSince}</p>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Password</label>
                <p class="settings-description">Last changed: Never</p>
              </div>
              <button id="changePasswordBtn" class="settings-button">
                Change Password
              </button>
            </div>
          </div>
        </div>
        ${
          !isAdmin
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">Admin Access</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Request Admin Access</label>
                <p class="settings-description">Enter the admin code to request administrator privileges</p>
              </div>
              <div class="settings-row-control">
                <input type="text" id="adminCodeInput" class="settings-input" placeholder="Admin code" maxlength="8" style="text-transform: uppercase; width: 150px;" />
                <button id="requestAdminBtn" class="settings-button ml-2">Submit</button>
              </div>
            </div>
          </div>
        </div>
        `
            : ''
        }
      </div>
    `;
  }

  /**
   * Render Integrations category
   */
  function renderIntegrationsCategory(data) {
    return `
      <div class="space-y-6">
        <div class="settings-group">
          <h3 class="settings-group-title">Music Services</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Spotify</label>
                <p class="settings-description">Connect to sync your listening data</p>
              </div>
              <div class="settings-row-control">
                ${
                  data.spotify?.connected
                    ? `<span class="settings-badge connected">Connected</span>
                     <button id="reauthorizeSpotifyBtn" class="settings-button ml-3" title="Re-login to update permissions">
                       Reauthorize
                     </button>
                     <button id="disconnectSpotifyBtn" class="settings-button settings-button-danger ml-2">
                       Disconnect
                     </button>`
                    : `<button id="connectSpotifyBtn" class="settings-button">
                       Connect
                     </button>`
                }
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Tidal</label>
                <p class="settings-description">Connect to sync your listening data</p>
              </div>
              <div class="settings-row-control">
                ${
                  data.tidal?.connected
                    ? `<span class="settings-badge connected">Connected</span>
                     <button id="disconnectTidalBtn" class="settings-button settings-button-danger ml-3">
                       Disconnect
                     </button>`
                    : `<button id="connectTidalBtn" class="settings-button">
                       Connect
                     </button>`
                }
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Last.fm</label>
                <p class="settings-description">Connect to sync your scrobbles</p>
              </div>
              <div class="settings-row-control">
                ${
                  data.lastfm?.connected
                    ? `<span class="settings-badge connected">Connected</span>
                     <button id="disconnectLastfmBtn" class="settings-button settings-button-danger ml-3">
                       Disconnect
                     </button>`
                    : `<button id="connectLastfmBtn" class="settings-button">
                       Connect
                     </button>`
                }
              </div>
            </div>
          </div>
        </div>
        <div class="settings-group">
          <h3 class="settings-group-title">Preferred Service</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label" for="musicServiceSelect">Default Music Service</label>
                <p class="settings-description">Choose your default music service for playlist creation</p>
              </div>
              <div class="settings-row-control">
                <select id="musicServiceSelect" class="settings-select">
                  <option value="" ${!data.musicService ? 'selected' : ''}>Ask each time</option>
                  <option value="spotify" ${data.musicService === 'spotify' ? 'selected' : ''} ${!data.spotifyAuth ? 'disabled' : ''}>Spotify</option>
                  <option value="tidal" ${data.musicService === 'tidal' ? 'selected' : ''} ${!data.tidalAuth ? 'disabled' : ''}>Tidal</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render Visual category
   */
  function renderVisualCategory(data) {
    return `
      <div class="space-y-6">
        <div class="settings-group">
          <h3 class="settings-group-title">Appearance</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label" for="accentColor">Accent Color</label>
                <p class="settings-description">Choose your preferred accent color</p>
              </div>
              <div class="settings-row-control">
                <input
                  type="color"
                  id="accentColor"
                  value="${data.accentColor || '#dc2626'}"
                  class="settings-color-input"
                />
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label" for="timeFormatSelect">Time Format</label>
                <p class="settings-description">Choose how times are displayed</p>
              </div>
              <div class="settings-row-control">
                <select id="timeFormatSelect" class="settings-select">
                  <option value="24h" ${data.timeFormat === '12h' ? '' : 'selected'}>24-hour</option>
                  <option value="12h" ${data.timeFormat === '12h' ? 'selected' : ''}>12-hour</option>
                </select>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label" for="dateFormatSelect">Date Format</label>
                <p class="settings-description">Choose how dates are displayed</p>
              </div>
              <div class="settings-row-control">
                <select id="dateFormatSelect" class="settings-select">
                  <option value="MM/DD/YYYY" ${data.dateFormat === 'DD/MM/YYYY' ? '' : 'selected'}>MM/DD/YYYY</option>
                  <option value="DD/MM/YYYY" ${data.dateFormat === 'DD/MM/YYYY' ? 'selected' : ''}>DD/MM/YYYY</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render Preferences category
   */
  function renderPreferencesCategory(data) {
    if (!data.hasData) {
      return `
        <div class="space-y-6">
          <div class="settings-group">
            <h3 class="settings-group-title">Music Preferences</h3>
            <div class="settings-group-content">
              <div class="text-center py-12">
                <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
                  <i class="fas fa-music text-2xl text-gray-600"></i>
                </div>
                <p class="text-gray-300 font-medium mb-2">No preference data yet</p>
                <p class="text-sm text-gray-500 mb-6 max-w-md mx-auto">Add albums to your lists or connect Spotify/Last.fm to see your music taste analysis.</p>
                <button id="syncPreferencesBtn" class="settings-button">
                  <i class="fas fa-sync-alt mr-2"></i>
                  Sync Now
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const topGenres = (data.topGenres || []).slice(0, 8);
    const topArtists = (data.topArtists || []).slice(0, 8);
    const topCountries = (data.topCountries || []).slice(0, 6);
    const maxCountryCount = topCountries[0]?.count || 1;
    const genreAffinity = (data.genreAffinity || []).slice(0, 10);
    const artistAffinity = (data.artistAffinity || []).slice(0, 10);

    // Format relative time
    let updatedText = 'Never';
    if (data.updatedAt) {
      try {
        const date = new Date(data.updatedAt);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) updatedText = 'Just now';
        else if (diffMins < 60)
          updatedText = `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
        else if (diffHours < 24)
          updatedText = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        else if (diffDays < 7)
          updatedText = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        else updatedText = date.toLocaleDateString();
      } catch (_e) {
        updatedText = 'Unknown';
      }
    }

    // Count data sources
    const hasListData = data.totalAlbums > 0;
    const hasSpotifyData = data.spotify?.syncedAt;
    const hasLastfmData = data.lastfm?.syncedAt;
    const sourceCount = [hasListData, hasSpotifyData, hasLastfmData].filter(
      Boolean
    ).length;

    // Helper to get source icons
    const getSourceIcons = (sources) => {
      if (!sources || !Array.isArray(sources)) return '';
      return sources
        .map((s) => {
          if (s === 'spotify')
            return '<i class="fab fa-spotify text-green-500" title="Spotify"></i>';
          if (s === 'lastfm')
            return '<i class="fab fa-lastfm text-red-500" title="Last.fm"></i>';
          if (s === 'internal')
            return '<i class="fas fa-list text-gray-400" title="Your lists"></i>';
          return '';
        })
        .join('');
    };

    // Helper to get country flag emoji (simplified)
    // Note: Currently unused but kept for future implementation
    const _getCountryFlag = (_countryName) => {
      // This is a simplified version - full implementation would use the flag mapping
      return '';
    };

    return `
      <div class="space-y-6">
        <div class="settings-group">
          <h3 class="settings-group-title">Music Preferences</h3>
          <div class="settings-group-content">
            <!-- Header with sync button -->
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-gray-800">
              <div class="text-sm text-gray-400">
                <i class="fas fa-clock mr-1.5"></i>
                Updated ${updatedText}
              </div>
              <button id="syncPreferencesBtn" class="settings-button">
                <i class="fas fa-sync-alt mr-2" id="syncIcon"></i>
                <span id="syncText">Sync Now</span>
              </button>
            </div>

            <!-- Quick Stats -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50 text-center">
                <div class="text-red-500 mb-2">
                  <i class="fas fa-compact-disc text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${data.totalAlbums || 0}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Albums</div>
              </div>
              <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50 text-center">
                <div class="text-purple-400 mb-2">
                  <i class="fas fa-tags text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${topGenres.length}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Genres</div>
              </div>
              <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50 text-center">
                <div class="text-blue-400 mb-2">
                  <i class="fas fa-user-friends text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${topArtists.length}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Artists</div>
              </div>
              <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50 text-center">
                <div class="text-green-400 mb-2">
                  <i class="fas fa-database text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${sourceCount}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Sources</div>
              </div>
            </div>
          </div>
        </div>

        ${
          topGenres.length > 0
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">Top Genres</h3>
          <div class="settings-group-content">
            <div class="space-y-2">
              ${topGenres
                .map(
                  (genre, idx) => `
                <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
                  <div class="w-6 text-sm font-medium text-gray-500">${idx + 1}</div>
                  <div class="flex-1 text-sm text-gray-200 truncate font-medium">${genre.name || genre}</div>
                  ${genre.sources ? `<div class="flex gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">${getSourceIcons(genre.sources)}</div>` : ''}
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        </div>
        `
            : ''
        }

        ${
          topArtists.length > 0
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">Top Artists</h3>
          <div class="settings-group-content">
            <div class="space-y-2">
              ${topArtists
                .map(
                  (artist, idx) => `
                <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
                  <div class="w-6 text-sm font-medium text-gray-500">${idx + 1}</div>
                  <div class="flex-1 text-sm text-gray-200 truncate font-medium">${artist.name || artist}</div>
                  ${artist.sources ? `<div class="flex gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">${getSourceIcons(artist.sources)}</div>` : ''}
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        </div>
        `
            : ''
        }

        ${
          topCountries.length > 0
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">Top Countries</h3>
          <div class="settings-group-content">
            <div class="space-y-2">
              ${topCountries
                .map((country, idx) => {
                  const count = country.count || 0;
                  const percentage =
                    maxCountryCount > 0
                      ? Math.round((count / maxCountryCount) * 100)
                      : 0;
                  return `
                  <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
                    <div class="w-6 text-sm font-medium text-gray-500">${idx + 1}</div>
                    <div class="w-28 sm:w-36 text-sm text-gray-200 truncate font-medium">${country.name || country}</div>
                    <div class="flex-1 h-2.5 bg-gray-800 rounded-full overflow-hidden">
                      <div class="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-500 ease-out" style="width: ${percentage}%"></div>
                    </div>
                    <div class="w-14 text-right text-xs text-gray-500 tabular-nums">${count} artist${count !== 1 ? 's' : ''}</div>
                  </div>
                `;
                })
                .join('')}
            </div>
          </div>
        </div>
        `
            : ''
        }

        ${
          genreAffinity.length > 0
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">Genre Affinity</h3>
          <div class="settings-group-content">
            <div class="space-y-2">
              ${genreAffinity
                .map(
                  (genre, idx) => `
                <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
                  <div class="w-6 text-sm font-medium text-gray-500">${idx + 1}</div>
                  <div class="flex-1 text-sm text-gray-200 truncate font-medium">${genre.name || genre}</div>
                  ${genre.sources ? `<div class="flex gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">${getSourceIcons(genre.sources)}</div>` : ''}
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        </div>
        `
            : ''
        }

        ${
          artistAffinity.length > 0
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">Artist Affinity</h3>
          <div class="settings-group-content">
            <div class="space-y-2">
              ${artistAffinity
                .map(
                  (artist, idx) => `
                <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
                  <div class="w-6 text-sm font-medium text-gray-500">${idx + 1}</div>
                  <div class="flex-1 text-sm text-gray-200 truncate font-medium">${artist.name || artist}</div>
                  ${artist.sources ? `<div class="flex gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">${getSourceIcons(artist.sources)}</div>` : ''}
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        </div>
        `
            : ''
        }

        ${
          data.lastfm?.totalScrobbles > 0
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">Last.fm Statistics</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Total Scrobbles</label>
                <p class="settings-description">From Last.fm</p>
              </div>
              <div class="settings-row-control">
                <span class="settings-stat-value">${data.lastfm.totalScrobbles.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
        `
            : ''
        }

        ${(() => {
          const spotifyArtistsByRange = data.spotify?.topArtistsByRange || {};
          const spotifyTracksByRange = data.spotify?.topTracksByRange || {};
          const spotifyRanges = [
            'short_term',
            'medium_term',
            'long_term',
          ].filter(
            (r) =>
              spotifyArtistsByRange[r]?.length > 0 ||
              spotifyTracksByRange[r]?.length > 0
          );

          if (spotifyRanges.length === 0) return '';

          const defaultSpotifyRange = spotifyRanges.includes('medium_term')
            ? 'medium_term'
            : spotifyRanges[0];
          const TIME_RANGE_LABELS = {
            short_term: '4 Weeks',
            medium_term: '6 Months',
            long_term: 'All Time',
          };

          // Helper to render Spotify artist bar
          const renderSpotifyArtist = (artist, rank, country = null) => {
            const countryDisplay = country
              ? `<span class="text-gray-500 text-xs" title="${country}">· ${country}</span>`
              : '';
            return `
              <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
                <div class="w-6 text-sm font-medium text-gray-500">${rank}</div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm text-gray-200 truncate font-medium" title="${artist.name || artist}">${artist.name || artist}</span>
                    ${countryDisplay}
                  </div>
                </div>
              </div>
            `;
          };

          // Helper to render Spotify track bar
          const renderSpotifyTrack = (track, rank) => {
            return `
              <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
                <div class="w-6 text-sm font-medium text-gray-500">${rank}</div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm text-gray-200 truncate font-medium" title="${track.name}">${track.name}</span>
                    <span class="text-gray-500 text-xs truncate" title="${track.artist}">· ${track.artist}</span>
                  </div>
                </div>
              </div>
            `;
          };

          return `
        <div class="settings-group">
          <h3 class="settings-group-title">Spotify</h3>
          <div class="settings-group-content">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div class="text-sm text-gray-400">
                ${data.spotify?.syncedAt ? `Synced ${updatedText}` : ''}
              </div>
              <div class="flex gap-1.5 flex-wrap" id="spotifyRangeButtons">
                ${spotifyRanges
                  .map((r) => {
                    const isActive = r === defaultSpotifyRange;
                    const activeClass = isActive
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600';
                    return `<button class="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${activeClass}" data-service="spotify" data-range="${r}">${TIME_RANGE_LABELS[r]}</button>`;
                  })
                  .join('')}
              </div>
            </div>
            
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h5 class="text-xs text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <i class="fas fa-user-friends"></i>
                  Top Artists
                </h5>
                ${spotifyRanges
                  .map((range) => {
                    const artists = spotifyArtistsByRange[range] || [];
                    return `
                    <div class="space-y-0.5 ${range !== defaultSpotifyRange ? 'hidden' : ''}" data-service="spotify" data-type="artists" data-range="${range}" data-content="true">
                      ${artists
                        .slice(0, 8)
                        .map((a, i) => renderSpotifyArtist(a, i + 1, a.country))
                        .join('')}
                    </div>
                  `;
                  })
                  .join('')}
              </div>
              
              <div>
                <h5 class="text-xs text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <i class="fas fa-music"></i>
                  Top Tracks
                </h5>
                ${spotifyRanges
                  .map((range) => {
                    const tracks = spotifyTracksByRange[range] || [];
                    return `
                    <div class="space-y-0.5 ${range !== defaultSpotifyRange ? 'hidden' : ''}" data-service="spotify" data-type="tracks" data-range="${range}" data-content="true">
                      ${tracks
                        .slice(0, 8)
                        .map((t, i) => renderSpotifyTrack(t, i + 1))
                        .join('')}
                    </div>
                  `;
                  })
                  .join('')}
              </div>
            </div>
          </div>
        </div>
        `;
        })()}

        ${(() => {
          const lastfmArtistsByRange = data.lastfm?.topArtistsByRange || {};
          const lastfmRanges = [
            '7day',
            '1month',
            '3month',
            '6month',
            '12month',
            'overall',
          ].filter((r) => lastfmArtistsByRange[r]?.length > 0);

          if (lastfmRanges.length === 0) return '';

          const defaultLastfmRange = lastfmRanges.includes('overall')
            ? 'overall'
            : lastfmRanges[0];
          const TIME_RANGE_LABELS = {
            '7day': '7 Days',
            '1month': '1 Month',
            '3month': '3 Months',
            '6month': '6 Months',
            '12month': '1 Year',
            overall: 'All Time',
          };

          // Helper to render Last.fm artist bar with play count
          const renderLastfmArtist = (artist, rank, maxPlaycount) => {
            const playcount = artist.playcount || 0;
            const percentage =
              maxPlaycount > 0
                ? Math.round((playcount / maxPlaycount) * 100)
                : 0;
            const countryDisplay = artist.country
              ? `<span class="text-gray-500 text-xs" title="${artist.country}">· ${artist.country}</span>`
              : '';
            return `
              <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
                <div class="w-6 text-sm font-medium text-gray-500">${rank}</div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm text-gray-200 truncate font-medium" title="${artist.name}">${artist.name}</span>
                    ${countryDisplay}
                  </div>
                  <div class="h-2 bg-gray-800 rounded-full overflow-hidden mt-1">
                    <div class="h-full bg-gradient-to-r from-red-500 to-red-400 rounded-full transition-all duration-500 ease-out" style="width: ${percentage}%"></div>
                  </div>
                </div>
                <div class="w-16 text-right text-xs text-gray-500 tabular-nums">${playcount.toLocaleString()}</div>
              </div>
            `;
          };

          return `
        <div class="settings-group">
          <h3 class="settings-group-title">Last.fm</h3>
          <div class="settings-group-content">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div class="text-sm text-gray-400">
                ${data.lastfm?.syncedAt ? `Synced ${updatedText}` : ''}
                ${data.lastfm?.totalScrobbles > 0 ? `· ${data.lastfm.totalScrobbles.toLocaleString()} scrobbles` : ''}
              </div>
              <div class="flex gap-1.5 flex-wrap" id="lastfmRangeButtons">
                ${lastfmRanges
                  .map((r) => {
                    const isActive = r === defaultLastfmRange;
                    const activeClass = isActive
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600';
                    return `<button class="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${activeClass}" data-service="lastfm" data-range="${r}">${TIME_RANGE_LABELS[r]}</button>`;
                  })
                  .join('')}
              </div>
            </div>
            
            <div>
              <h5 class="text-xs text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                <i class="fas fa-user-friends"></i>
                Top Artists
                <span class="text-gray-500 font-normal normal-case">(by play count)</span>
              </h5>
              ${lastfmRanges
                .map((range) => {
                  const artists = lastfmArtistsByRange[range] || [];
                  const maxPlaycount = artists[0]?.playcount || 1;
                  return `
                  <div class="space-y-0.5 ${range !== defaultLastfmRange ? 'hidden' : ''}" data-service="lastfm" data-type="artists" data-range="${range}" data-content="true">
                    ${artists
                      .slice(0, 8)
                      .map((a, i) => renderLastfmArtist(a, i + 1, maxPlaycount))
                      .join('')}
                  </div>
                `;
                })
                .join('')}
            </div>
          </div>
        </div>
        `;
        })()}
      </div>
    `;
  }

  /**
   * Render Stats category
   */
  function renderStatsCategory(data) {
    return `
      <div class="space-y-6">
        <div class="settings-group">
          <h3 class="settings-group-title">Statistics</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Lists</label>
                <p class="settings-description">Total number of lists</p>
              </div>
              <div class="settings-row-control">
                <span class="settings-stat-value">${data.listCount || 0}</span>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Total Albums</label>
                <p class="settings-description">Albums in your lists</p>
              </div>
              <div class="settings-row-control">
                <span class="settings-stat-value">${data.totalAlbums || 0}</span>
              </div>
            </div>
            ${
              data.totalScrobbles > 0
                ? `<div class="settings-row">
                  <div class="settings-row-label">
                    <label class="settings-label">Total Scrobbles</label>
                    <p class="settings-description">From Last.fm</p>
                  </div>
                  <div class="settings-row-control">
                    <span class="settings-stat-value">${data.totalScrobbles.toLocaleString()}</span>
                  </div>
                </div>`
                : ''
            }
          </div>
        </div>
        <!-- System Statistics -->
        ${
          data.systemStats
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">System Statistics</h3>
          <div class="settings-group-content">
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div class="preferences-stat-card">
                <div class="text-blue-400 mb-2">
                  <i class="fas fa-users text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${data.systemStats.totalUsers || 0}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Users</div>
              </div>
              <div class="preferences-stat-card">
                <div class="text-purple-400 mb-2">
                  <i class="fas fa-list text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${data.systemStats.totalLists || 0}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Lists</div>
              </div>
              <div class="preferences-stat-card">
                <div class="text-green-400 mb-2">
                  <i class="fas fa-compact-disc text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${data.systemStats.totalAlbums || 0}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Albums</div>
              </div>
              <div class="preferences-stat-card">
                <div class="text-yellow-400 mb-2">
                  <i class="fas fa-shield-alt text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${data.systemStats.adminUsers || 0}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Admins</div>
              </div>
              <div class="preferences-stat-card">
                <div class="text-red-400 mb-2">
                  <i class="fas fa-user-check text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${data.systemStats.activeUsers || 0}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Active (7d)</div>
              </div>
            </div>
          </div>
        </div>
        `
            : ''
        }
      </div>
    `;
  }

  /**
   * Render Admin category
   */
  function renderAdminCategory(data) {
    if (!data.hasData) {
      return `
        <div class="space-y-6">
          <div class="settings-group">
            <h3 class="settings-group-title">Admin Panel</h3>
            <div class="settings-group-content">
              <div class="text-center py-12">
                <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
                  <i class="fas fa-spinner fa-spin text-2xl text-gray-600"></i>
                </div>
                <p class="text-gray-300 font-medium mb-2">Loading admin data...</p>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const events = data.events || {
      pending: [],
      counts: { total: 0, byType: {}, byPriority: {} },
    };
    const telegram = data.telegram || { configured: false };
    const users = data.users || [];
    const aggregateLists = data.aggregateLists || [];

    // Format relative time helper
    const formatRelativeTime = (dateString) => {
      if (!dateString) return 'Unknown';
      try {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60)
          return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
        if (diffHours < 24)
          return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        if (diffDays < 7)
          return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        return date.toLocaleDateString();
      } catch (_e) {
        return 'Unknown';
      }
    };

    // Get priority badge color
    const getPriorityBadge = (priority) => {
      const colors = {
        urgent: 'bg-red-900/50 text-red-400 border-red-600/30',
        high: 'bg-orange-900/50 text-orange-400 border-orange-600/30',
        normal: 'bg-blue-900/50 text-blue-400 border-blue-600/30',
        low: 'bg-gray-800 text-gray-400 border-gray-700',
      };
      return colors[priority] || colors.normal;
    };

    return `
      <div class="space-y-6">
        <!-- Aggregate List Management -->
        ${
          aggregateLists.length > 0
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">
            <i class="fas fa-trophy mr-2 text-yellow-500"></i>
            Aggregate Lists
          </h3>
          <div class="settings-group-content">
            <div class="space-y-4">
              ${aggregateLists
                .map((item) => {
                  const year = item.year;
                  const status = item.status || {};
                  const stats = item.stats;
                  const isRevealed = status.revealed || false;
                  const confirmCount = status.confirmationCount || 0;
                  const required = status.requiredConfirmations || 2;
                  const confirmations = status.confirmations || [];
                  const currentUser = window.currentUser;
                  const hasConfirmed = confirmations.some(
                    (c) => c.username === currentUser?.username
                  );

                  // Status badge
                  let statusBadge = '';
                  if (isRevealed) {
                    statusBadge =
                      '<span class="px-2 py-1 bg-green-900/50 text-green-400 text-xs rounded-sm border border-green-600/30">Revealed</span>';
                  } else if (confirmCount > 0) {
                    statusBadge = `<span class="px-2 py-1 bg-yellow-900/50 text-yellow-400 text-xs rounded-sm border border-yellow-600/30">${confirmCount}/${required} Confirmations</span>`;
                  }
                  // No badge shown when not revealed and no confirmations yet

                  // Confirmations display
                  let confirmationsHtml = '';
                  if (confirmations.length > 0) {
                    confirmationsHtml = `
                    <div class="mt-2 flex flex-wrap gap-2">
                      ${confirmations
                        .map(
                          (c) => `
                        <span class="inline-flex items-center gap-1 px-2 py-1 bg-green-900/20 text-green-400 text-xs rounded-sm border border-green-600/20">
                          <i class="fas fa-check-circle"></i>${c.username || 'Unknown'}
                        </span>
                      `
                        )
                        .join('')}
                    </div>
                  `;
                  }

                  // Stats display (only if not revealed)
                  let statsHtml = '';
                  if (stats && !isRevealed) {
                    statsHtml = `
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                      <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
                        <div class="font-bold text-white text-lg">${stats.participantCount || 0}</div>
                        <div class="text-xs text-gray-400 uppercase">Contributors</div>
                      </div>
                      <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
                        <div class="font-bold text-white text-lg">${stats.totalAlbums || 0}</div>
                        <div class="text-xs text-gray-400 uppercase">Albums</div>
                      </div>
                      <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
                        <div class="font-bold text-white text-lg">${stats.albumsWith3PlusVoters || 0}</div>
                        <div class="text-xs text-gray-400 uppercase">3+ Votes</div>
                      </div>
                      <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
                        <div class="font-bold text-white text-lg">${stats.albumsWith2Voters || 0}</div>
                        <div class="text-xs text-gray-400 uppercase">2 Votes</div>
                      </div>
                    </div>
                  `;
                  }

                  // Action buttons
                  let actionsHtml = '';

                  // Lock/Unlock button
                  const isLocked = status.locked || false;
                  actionsHtml += `
                  <button class="settings-button aggregate-toggle-lock" data-year="${year}" data-locked="${isLocked}">
                    <i class="fas fa-${isLocked ? 'unlock' : 'lock'} mr-2"></i>${isLocked ? 'Unlock' : 'Lock'} Year
                  </button>`;

                  // Manage Contributors button - disabled if year is locked
                  if (isLocked) {
                    actionsHtml += `<button class="settings-button opacity-50 cursor-not-allowed" disabled data-year="${year}" title="Unlock the year to manage contributors">
                    <i class="fas fa-users mr-2"></i>Manage Contributors
                    <i class="fas fa-lock text-yellow-500 ml-2 text-xs"></i>
                  </button>`;
                  } else {
                    actionsHtml += `<button class="settings-button aggregate-manage-contributors" data-year="${year}">
                    <i class="fas fa-users mr-2"></i>Manage Contributors
                  </button>`;
                  }

                  if (isRevealed) {
                    actionsHtml += `
                    <a href="/aggregate-list/${year}" class="settings-button" target="_blank">
                      <i class="fas fa-eye mr-2"></i>View List
                    </a>
                    <button class="settings-button aggregate-reset-reveal" data-year="${year}">
                      <i class="fas fa-undo mr-2"></i>Reset Reveal
                    </button>
                  `;
                  } else {
                    if (hasConfirmed) {
                      actionsHtml += `
                      <button class="settings-button aggregate-revoke-confirm" data-year="${year}">
                        <i class="fas fa-times mr-2"></i>Revoke
                      </button>
                    `;
                    } else {
                      actionsHtml += `
                      <button class="settings-button settings-button-danger aggregate-confirm-reveal" data-year="${year}">
                        <i class="fas fa-check mr-2"></i>Confirm Reveal
                      </button>
                    `;
                    }
                    actionsHtml += `
                    <a href="/aggregate-list/${year}" class="settings-button" target="_blank">
                      <i class="fas fa-external-link-alt mr-2"></i>Open Page
                    </a>
                  `;
                  }

                  actionsHtml += `
                  <button class="settings-button aggregate-recompute" data-year="${year}">
                    <i class="fas fa-sync-alt mr-2"></i>Recompute
                  </button>
                  <button class="settings-button aggregate-audit" data-year="${year}">
                    <i class="fas fa-search mr-2"></i>Audit Data
                  </button>
                `;

                  return `
                  <div class="bg-gray-800/50 rounded-lg overflow-hidden aggregate-year-item" data-year="${year}">
                    <button 
                      class="w-full flex items-center justify-between p-4 hover:bg-gray-700/30 transition-colors duration-200 cursor-pointer aggregate-year-toggle focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset rounded-t-lg"
                      data-year="${year}"
                      aria-expanded="false"
                      aria-controls="aggregate-year-content-${year}"
                    >
                      <div class="flex items-center gap-3">
                        <i class="fas fa-chevron-right text-gray-400 aggregate-year-chevron transition-transform duration-300 ease-in-out text-sm" style="transform: rotate(0deg);" aria-hidden="true"></i>
                        <h5 class="text-lg font-bold text-white">${year}</h5>
                        ${isLocked ? '<i class="fas fa-lock text-yellow-500 ml-2" title="Year is locked"></i>' : ''}
                      </div>
                      ${statusBadge}
                    </button>
                    <div 
                      id="aggregate-year-content-${year}"
                      class="aggregate-year-content hidden overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out"
                      style="max-height: 0; opacity: 0;"
                    >
                      <div class="px-4 pb-4 pt-0 space-y-3">
                        ${confirmationsHtml}
                        ${statsHtml}
                        <div class="flex flex-wrap gap-2">
                          ${actionsHtml}
                        </div>
                      </div>
                    </div>
                  </div>
                `;
                })
                .join('')}
            </div>
          </div>
        </div>
        `
            : `
        <div class="settings-group">
          <h3 class="settings-group-title">
            <i class="fas fa-trophy mr-2 text-yellow-500"></i>
            Aggregate Lists
          </h3>
          <div class="settings-group-content">
            <p class="text-gray-400 text-sm">No main lists found. Users need to mark their lists as "main" for a specific year.</p>
          </div>
        </div>
        `
        }

        <!-- Album Summaries -->
        <div class="settings-group">
          <h3 class="settings-group-title">Album Summaries</h3>
          <div class="settings-group-content">
            <div id="albumSummaryStats" class="mb-4">
              <div class="text-gray-400 text-sm">Loading stats...</div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Fetch Album Summaries</label>
                <p class="settings-description">Fetch album descriptions from Claude AI for all albums without summaries</p>
              </div>
              <div class="flex gap-2">
                <button id="fetchAlbumSummariesBtn" class="settings-button">Fetch Missing</button>
                <button id="regenerateAllSummariesBtn" class="settings-button" title="Regenerate all summaries (including existing ones)">Regenerate All</button>
                <button id="stopAlbumSummariesBtn" class="settings-button settings-button-danger hidden">Stop</button>
              </div>
            </div>
            <div id="albumSummaryProgress" class="hidden mt-4">
              <div class="w-full bg-gray-700 rounded-full h-2.5 mb-2">
                <div id="albumSummaryProgressBar" class="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style="width: 0%"></div>
              </div>
              <div id="albumSummaryProgressText" class="text-sm text-gray-400"></div>
            </div>
          </div>
        </div>

        <!-- Album Images -->
        <div class="settings-group">
          <h3 class="settings-group-title">Album Images</h3>
          <div class="settings-group-content">
            <div id="albumImageStats" class="mb-4">
              <div class="text-gray-400 text-sm">Loading stats...</div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Refetch Album Images</label>
                <p class="settings-description">Re-download cover art from external sources (Cover Art Archive, iTunes) and process at 512x512 quality. Skips albums with 512x512+ images or >= 100KB.</p>
              </div>
              <div class="flex gap-2">
                <button id="refetchAlbumImagesBtn" class="settings-button">Refetch Images</button>
                <button id="stopRefetchImagesBtn" class="settings-button settings-button-danger hidden">Stop</button>
              </div>
            </div>
            <div id="imageRefetchProgress" class="hidden mt-4">
              <div class="flex justify-between text-sm text-gray-400 mb-1">
                <span id="imageRefetchProgressLabel">Processing...</span>
                <span id="imageRefetchProgressPercent">0%</span>
              </div>
              <div class="w-full bg-gray-700 rounded-full h-2.5">
                <div id="imageRefetchProgressBar" class="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style="width: 0%"></div>
              </div>
            </div>
            <div id="imageRefetchResult" class="hidden mt-4 p-3 bg-gray-800/50 rounded text-sm">
              <div id="imageRefetchResultText" class="text-gray-300"></div>
            </div>
          </div>
        </div>

        <!-- Duplicate Album Scanner -->
        <div class="settings-group">
          <h3 class="settings-group-title">Duplicate Album Scanner</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Scan for Duplicates</label>
                <p class="settings-description">Find and review albums that may be duplicates based on fuzzy matching</p>
              </div>
              <div class="flex items-center gap-3">
                <div class="flex items-center gap-2">
                  <label for="duplicateThreshold" class="text-xs text-gray-400 whitespace-nowrap">Sensitivity:</label>
                  <select id="duplicateThreshold" class="bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600">
                    <option value="0.10">Very High (0.10)</option>
                    <option value="0.15" selected>High (0.15)</option>
                    <option value="0.20">Medium (0.20)</option>
                    <option value="0.30">Low (0.30)</option>
                    <option value="0.45">Very Low (0.45)</option>
                  </select>
                </div>
                <button id="scanDuplicatesBtn" class="settings-button">Scan & Review</button>
              </div>
            </div>
            <p class="text-xs text-gray-500 mt-1">Lower values = more matches (more false positives). All matches require human review.</p>
            <div id="duplicateScanStatus" class="hidden mt-3 text-sm text-gray-400"></div>
            <div class="settings-row mt-4 pt-4 border-t border-gray-700/50">
              <div class="settings-row-label">
                <label class="settings-label">Manual Album Reconciliation</label>
                <p class="settings-description">Review manually-added albums that may match existing canonical albums</p>
              </div>
              <div class="flex gap-2">
                <button id="auditManualAlbumsBtn" class="settings-button">Audit Manual Albums</button>
              </div>
            </div>
          </div>
        </div>

        <!-- User Management -->
        ${
          users.length > 0
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">User Management</h3>
          <div class="settings-group-content">
            <div class="space-y-2">
              ${users
                .map((user) => {
                  const isCurrentUser = user._id === window.currentUser?._id;
                  return `
                  <div class="flex flex-col bg-gray-800/50 rounded-sm p-3 gap-3">
                    <div class="wrap-break-word">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="text-white font-medium">${user.username || user.email}</span>
                        ${
                          user.role === 'admin'
                            ? '<span class="px-2 py-0.5 bg-yellow-900/50 text-yellow-400 text-xs rounded-sm border border-yellow-600/30">Admin</span>'
                            : ''
                        }
                        ${isCurrentUser ? '<span class="text-xs text-gray-500">(You)</span>' : ''}
                      </div>
                      <p class="settings-description wrap-break-word">
                        ${user.listCount || 0} lists • ${user.email || 'No email'}
                      </p>
                    </div>
                    ${
                      !isCurrentUser
                        ? `
                      <div class="flex flex-wrap gap-2">
                        ${
                          user.role !== 'admin'
                            ? `<button class="settings-button admin-grant-admin" data-user-id="${user._id}" title="Grant Admin">Grant Admin</button>`
                            : `<button class="settings-button settings-button-danger admin-revoke-admin" data-user-id="${user._id}" title="Revoke Admin">Revoke Admin</button>`
                        }
                        <button class="settings-button admin-view-lists" data-user-id="${user._id}" title="View Lists">View Lists</button>
                        <button class="settings-button settings-button-danger admin-delete-user" data-user-id="${user._id}" title="Delete User">Delete</button>
                      </div>
                    `
                        : ''
                    }
                  </div>
                `;
                })
                .join('')}
            </div>
          </div>
        </div>
        `
            : ''
        }

        <!-- Admin Events Dashboard -->
        <div class="settings-group">
          <h3 class="settings-group-title">Pending Events</h3>
          <div class="settings-group-content">
            ${
              events.pending.length === 0
                ? `
              <div class="text-center py-8">
                <i class="fas fa-check-circle text-3xl text-gray-600 mb-2"></i>
                <p class="text-gray-400">No pending events</p>
              </div>
            `
                : `
              <div class="space-y-3">
                ${events.pending
                  .map(
                    (event) => `
                   <div class="bg-gray-800/50 rounded-lg p-4" data-event-id="${event.id}" data-event-data="${_escapeHtml(JSON.stringify(event))}">
                    <div class="flex items-start justify-between mb-2">
                      <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                          <h4 class="text-white font-semibold">${event.title || 'Untitled Event'}</h4>
                          <span class="px-2 py-0.5 text-xs rounded-sm border ${getPriorityBadge(event.priority || 'normal')}">
                            ${(event.priority || 'normal').toUpperCase()}
                          </span>
                        </div>
                        <p class="text-sm text-gray-400">${event.description || ''}</p>
                        <p class="text-xs text-gray-500 mt-1">${formatRelativeTime(event.created_at)}</p>
                      </div>
                    </div>
                    ${
                      event.actions && event.actions.length > 0
                        ? `
                      <div class="flex gap-2 mt-3">
                        ${event.actions
                          .map(
                            (action) => `
                          <button 
                            class="settings-button admin-event-action" 
                            data-event-id="${event.id}" 
                            data-action="${action.id}"
                          >
                            ${action.label}
                          </button>
                        `
                          )
                          .join('')}
                      </div>
                    `
                        : ''
                    }
                  </div>
                `
                  )
                  .join('')}
              </div>
            `
            }
          </div>
        </div>

        <!-- Telegram Notifications -->
        <div class="settings-group">
          <h3 class="settings-group-title">Telegram Notifications</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Status</label>
                <p class="settings-description">
                  ${
                    telegram.configured
                      ? `Connected to ${telegram.chatTitle || 'Telegram group'}${telegram.topicName ? ` (${telegram.topicName})` : ''}`
                      : 'Not configured'
                  }
                </p>
              </div>
              <div class="settings-row-control">
                ${
                  telegram.configured
                    ? `<button id="disconnectTelegramBtn" class="settings-button settings-button-danger">Disconnect</button>`
                    : `<button id="configureTelegramBtn" class="settings-button">Configure</button>`
                }
              </div>
            </div>
          </div>
        </div>

        <!-- Database Management -->
        <div class="settings-group">
          <h3 class="settings-group-title">Database Management</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Backup Database</label>
                <p class="settings-description">Download a backup of the entire database</p>
              </div>
              <a href="/admin/backup" class="settings-button" download>Download Backup</a>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Restore Database</label>
                <p class="settings-description">Restore from a backup file (destructive operation)</p>
              </div>
              <button id="restoreDatabaseBtn" class="settings-button settings-button-danger">Restore Backup</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Attach handlers for Account category
   */
  function attachAccountHandlers() {
    const changeEmailBtn = document.getElementById('changeEmailBtn');
    const saveEmailBtn = document.getElementById('saveEmailBtn');
    const cancelEmailBtn = document.getElementById('cancelEmailBtn');
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    const editUsernameBtn = document.getElementById('editUsernameBtn');
    const saveUsernameBtn = document.getElementById('saveUsernameBtn');
    const cancelUsernameBtn = document.getElementById('cancelUsernameBtn');
    const requestAdminBtn = document.getElementById('requestAdminBtn');

    if (changeEmailBtn) {
      changeEmailBtn.addEventListener('click', handleEditEmail);
    }

    if (saveEmailBtn) {
      saveEmailBtn.addEventListener('click', handleSaveEmail);
    }

    if (cancelEmailBtn) {
      cancelEmailBtn.addEventListener('click', handleCancelEmail);
    }

    if (changePasswordBtn) {
      changePasswordBtn.addEventListener('click', handleChangePassword);
    }

    if (editUsernameBtn) {
      editUsernameBtn.addEventListener('click', handleEditUsername);
    }

    if (saveUsernameBtn) {
      saveUsernameBtn.addEventListener('click', handleSaveUsername);
    }

    if (cancelUsernameBtn) {
      cancelUsernameBtn.addEventListener('click', handleCancelUsername);
    }

    if (requestAdminBtn) {
      requestAdminBtn.addEventListener('click', handleRequestAdmin);
    }
  }

  /**
   * Attach handlers for Integrations category
   */
  function attachIntegrationsHandlers() {
    const connectSpotifyBtn = document.getElementById('connectSpotifyBtn');
    const reauthorizeSpotifyBtn = document.getElementById(
      'reauthorizeSpotifyBtn'
    );
    const disconnectSpotifyBtn = document.getElementById(
      'disconnectSpotifyBtn'
    );
    const connectTidalBtn = document.getElementById('connectTidalBtn');
    const disconnectTidalBtn = document.getElementById('disconnectTidalBtn');
    const connectLastfmBtn = document.getElementById('connectLastfmBtn');
    const disconnectLastfmBtn = document.getElementById('disconnectLastfmBtn');

    if (connectSpotifyBtn) {
      connectSpotifyBtn.addEventListener('click', () => {
        window.location.href = '/auth/spotify';
      });
    }

    if (reauthorizeSpotifyBtn) {
      reauthorizeSpotifyBtn.addEventListener('click', () => {
        window.location.href = '/auth/spotify?force=true';
      });
    }

    if (disconnectSpotifyBtn) {
      disconnectSpotifyBtn.addEventListener('click', () =>
        handleDisconnect('spotify')
      );
    }

    if (connectTidalBtn) {
      connectTidalBtn.addEventListener('click', () => {
        window.location.href = '/auth/tidal';
      });
    }

    if (disconnectTidalBtn) {
      disconnectTidalBtn.addEventListener('click', () =>
        handleDisconnect('tidal')
      );
    }

    if (connectLastfmBtn) {
      connectLastfmBtn.addEventListener('click', () => {
        window.location.href = '/auth/lastfm';
      });
    }

    if (disconnectLastfmBtn) {
      disconnectLastfmBtn.addEventListener('click', () =>
        handleDisconnect('lastfm')
      );
    }

    const musicServiceSelect = document.getElementById('musicServiceSelect');
    if (musicServiceSelect) {
      musicServiceSelect.addEventListener('change', (e) => {
        handleMusicServiceChange(e.target.value);
      });
    }
  }

  /**
   * Attach handlers for Visual category
   */
  function attachVisualHandlers() {
    const accentColorInput = document.getElementById('accentColor');
    if (accentColorInput) {
      accentColorInput.addEventListener('change', (e) => {
        handleAccentColorChange(e.target.value);
      });
    }

    const timeFormatSelect = document.getElementById('timeFormatSelect');
    if (timeFormatSelect) {
      timeFormatSelect.addEventListener('change', (e) => {
        handleTimeFormatChange(e.target.value);
      });
    }

    const dateFormatSelect = document.getElementById('dateFormatSelect');
    if (dateFormatSelect) {
      dateFormatSelect.addEventListener('change', (e) => {
        handleDateFormatChange(e.target.value);
      });
    }
  }

  /**
   * Attach handlers for Preferences category
   */
  function attachPreferencesHandlers() {
    const syncBtn = document.getElementById('syncPreferencesBtn');
    if (syncBtn) {
      syncBtn.addEventListener('click', handleSyncPreferences);
    }

    // Attach time range button handlers
    const spotifyRangeButtons = document.getElementById('spotifyRangeButtons');
    if (spotifyRangeButtons) {
      spotifyRangeButtons.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          const service = btn.getAttribute('data-service');
          const range = btn.getAttribute('data-range');
          handleSetTimeRange(service, range);
        });
      });
    }

    const lastfmRangeButtons = document.getElementById('lastfmRangeButtons');
    if (lastfmRangeButtons) {
      lastfmRangeButtons.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          const service = btn.getAttribute('data-service');
          const range = btn.getAttribute('data-range');
          handleSetTimeRange(service, range);
        });
      });
    }
  }

  /**
   * Attach handlers for Stats category
   */
  function attachStatsHandlers() {
    // Stats category is read-only, no handlers needed
  }

  /**
   * Attach handlers for Admin category
   */
  function attachAdminHandlers() {
    // Event action handlers
    document.querySelectorAll('.admin-event-action').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const eventId = btn.dataset.eventId;
        const action = btn.dataset.action;

        // Get event data from parent container
        const eventContainer = btn.closest('[data-event-data]');
        let eventData = null;
        try {
          eventData = JSON.parse(eventContainer?.dataset.eventData || '{}');
        } catch (e) {
          console.error('Failed to parse event data:', e);
        }

        await handleAdminEventAction(eventId, action, eventData);
      });
    });

    // Telegram handlers
    const configureTelegramBtn = document.getElementById(
      'configureTelegramBtn'
    );
    const disconnectTelegramBtn = document.getElementById(
      'disconnectTelegramBtn'
    );

    if (configureTelegramBtn) {
      configureTelegramBtn.addEventListener('click', handleConfigureTelegram);
    }

    if (disconnectTelegramBtn) {
      disconnectTelegramBtn.addEventListener('click', handleDisconnectTelegram);
    }

    // Database restore handler
    const restoreDatabaseBtn = document.getElementById('restoreDatabaseBtn');
    if (restoreDatabaseBtn) {
      restoreDatabaseBtn.addEventListener('click', handleRestoreDatabase);
    }

    // User management handlers
    document.querySelectorAll('.admin-grant-admin').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        await handleGrantAdmin(userId);
      });
    });

    document.querySelectorAll('.admin-revoke-admin').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        await handleRevokeAdmin(userId);
      });
    });

    document.querySelectorAll('.admin-view-lists').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        await handleViewUserLists(userId);
      });
    });

    document.querySelectorAll('.admin-delete-user').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        await handleDeleteUser(userId);
      });
    });

    // Aggregate list toggle handlers (collapsible years)
    document.querySelectorAll('.aggregate-year-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const year = btn.dataset.year;
        const content = document.getElementById(
          `aggregate-year-content-${year}`
        );
        const chevron = btn.querySelector('.aggregate-year-chevron');
        const isExpanded = btn.getAttribute('aria-expanded') === 'true';

        if (isExpanded) {
          // Collapse
          content.style.maxHeight = `${content.scrollHeight}px`;
          content.style.opacity = '1';
          // Force reflow to ensure transition starts
          void content.offsetHeight;
          content.style.maxHeight = '0';
          content.style.opacity = '0';
          setTimeout(() => {
            content.classList.add('hidden');
          }, 300); // Match transition duration
          chevron.style.transform = 'rotate(0deg)';
          btn.setAttribute('aria-expanded', 'false');
        } else {
          // Expand
          content.classList.remove('hidden');
          // Temporarily set to auto to get actual height
          content.style.maxHeight = 'none';
          content.style.opacity = '0';
          const height = content.scrollHeight;
          content.style.maxHeight = '0';
          // Force reflow
          void content.offsetHeight;
          // Now animate to full height
          requestAnimationFrame(() => {
            content.style.maxHeight = `${height}px`;
            content.style.opacity = '1';
          });
          chevron.style.transform = 'rotate(90deg)';
          btn.setAttribute('aria-expanded', 'true');
        }
      });

      // Keyboard accessibility
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          btn.click();
        }
      });
    });

    // Aggregate list handlers
    document.querySelectorAll('.aggregate-confirm-reveal').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const year = parseInt(btn.dataset.year, 10);
        await handleConfirmAggregateReveal(year);
      });
    });

    document.querySelectorAll('.aggregate-revoke-confirm').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const year = parseInt(btn.dataset.year, 10);
        await handleRevokeAggregateConfirm(year);
      });
    });

    document.querySelectorAll('.aggregate-reset-reveal').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const year = parseInt(btn.dataset.year, 10);
        await handleResetAggregateReveal(year);
      });
    });

    document.querySelectorAll('.aggregate-recompute').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const year = parseInt(btn.dataset.year, 10);
        await handleRecomputeAggregateList(year);
      });
    });

    document.querySelectorAll('.aggregate-audit').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const year = parseInt(btn.dataset.year, 10);
        await handleAuditAggregateList(year);
      });
    });

    document
      .querySelectorAll('.aggregate-manage-contributors')
      .forEach((btn) => {
        btn.addEventListener('click', async () => {
          const year = parseInt(btn.dataset.year, 10);
          await handleShowContributorManager(year);
        });
      });

    document.querySelectorAll('.aggregate-toggle-lock').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const year = parseInt(btn.dataset.year, 10);
        const isCurrentlyLocked = btn.dataset.locked === 'true';
        await handleToggleYearLock(year, isCurrentlyLocked);
      });
    });

    // Album summary handlers
    const fetchAlbumSummariesBtn = document.getElementById(
      'fetchAlbumSummariesBtn'
    );
    const regenerateAllSummariesBtn = document.getElementById(
      'regenerateAllSummariesBtn'
    );
    const stopAlbumSummariesBtn = document.getElementById(
      'stopAlbumSummariesBtn'
    );

    if (fetchAlbumSummariesBtn) {
      fetchAlbumSummariesBtn.addEventListener(
        'click',
        handleFetchAlbumSummaries
      );
    }

    if (regenerateAllSummariesBtn) {
      regenerateAllSummariesBtn.addEventListener('click', async () => {
        // Show confirmation modal with cost warning
        const confirmed = await showConfirmation(
          'Regenerate All Album Summaries',
          'Are you sure you want to regenerate ALL album summaries?',
          'This will regenerate summaries for all albums (including those with existing summaries) and will incur API costs. This action should only be used when necessary.',
          'Regenerate All'
        );

        if (!confirmed) return;

        const fetchBtn = document.getElementById('fetchAlbumSummariesBtn');
        try {
          fetchBtn.disabled = true;
          regenerateAllSummariesBtn.disabled = true;
          regenerateAllSummariesBtn.textContent = 'Starting...';

          const response = await apiCall('/api/admin/album-summaries/fetch', {
            method: 'POST',
            body: JSON.stringify({ includeRetries: true, regenerateAll: true }),
          });

          if (response.success) {
            showToast('Regenerating all album summaries...', 'success');
            await loadAlbumSummaryStats();
            // Start polling for batch status updates
            if (!albumSummaryPollInterval) {
              albumSummaryPollInterval = setInterval(
                pollAlbumSummaryStatus,
                2000
              );
            }
          } else {
            showToast('Failed to start regeneration', 'error');
          }
        } catch (error) {
          console.error('Error regenerating all summaries:', error);
          showToast('Error regenerating summaries', 'error');
        } finally {
          fetchBtn.disabled = false;
          regenerateAllSummariesBtn.disabled = false;
          regenerateAllSummariesBtn.textContent = 'Regenerate All';
        }
      });
    }

    if (stopAlbumSummariesBtn) {
      stopAlbumSummariesBtn.addEventListener('click', handleStopAlbumSummaries);
    }

    // Load album summary stats on admin panel load
    loadAlbumSummaryStats();

    // Album image refetch handlers
    const refetchAlbumImagesBtn = document.getElementById(
      'refetchAlbumImagesBtn'
    );
    const stopRefetchImagesBtn = document.getElementById(
      'stopRefetchImagesBtn'
    );

    if (refetchAlbumImagesBtn) {
      refetchAlbumImagesBtn.addEventListener('click', handleRefetchAlbumImages);
    }

    if (stopRefetchImagesBtn) {
      stopRefetchImagesBtn.addEventListener('click', handleStopRefetchImages);
    }

    // Load album image stats on admin panel load
    loadAlbumImageStats();

    // Duplicate scanner handlers
    const scanDuplicatesBtn = document.getElementById('scanDuplicatesBtn');
    if (scanDuplicatesBtn) {
      scanDuplicatesBtn.addEventListener('click', handleScanDuplicates);
    }

    // Manual album reconciliation handler
    const auditManualAlbumsBtn = document.getElementById(
      'auditManualAlbumsBtn'
    );
    if (auditManualAlbumsBtn) {
      auditManualAlbumsBtn.addEventListener('click', openManualAlbumAudit);
    }
  }

  /**
   * Handle duplicate album scanning - opens review modal
   */
  async function handleScanDuplicates() {
    const scanBtn = document.getElementById('scanDuplicatesBtn');
    const statusDiv = document.getElementById('duplicateScanStatus');
    const thresholdSelect = document.getElementById('duplicateThreshold');
    const threshold = thresholdSelect
      ? parseFloat(thresholdSelect.value)
      : 0.15;

    try {
      scanBtn.disabled = true;
      scanBtn.textContent = 'Scanning...';
      statusDiv.classList.remove('hidden');
      statusDiv.innerHTML =
        '<i class="fas fa-spinner fa-spin mr-2"></i>Scanning database for potential duplicates...';

      const response = await apiCall(
        `/admin/api/scan-duplicates?threshold=${threshold}`
      );

      if (response.error) {
        throw new Error(response.error);
      }

      if (response.pairs.length === 0) {
        statusDiv.innerHTML = `
          <span class="text-green-400">
            <i class="fas fa-check-circle mr-2"></i>
            No potential duplicates found (${response.totalAlbums} albums, ${response.excludedPairs} marked distinct)
          </span>
        `;
        showToast('No potential duplicates found', 'success');
      } else {
        statusDiv.innerHTML = `
          <span class="text-yellow-400">
            Found ${response.potentialDuplicates} potential duplicates. Opening review...
          </span>
        `;

        // Open the review modal
        const result = await openDuplicateReviewModal(response.pairs);

        // Update status after review
        statusDiv.innerHTML = `
          <span class="text-gray-400">
            Last scan: ${response.potentialDuplicates} found, ${result.resolved} resolved, ${result.remaining} remaining
          </span>
        `;
      }
    } catch (error) {
      console.error('Error scanning for duplicates:', error);
      statusDiv.innerHTML = `
        <span class="text-red-400">
          <i class="fas fa-exclamation-triangle mr-2"></i>
          Error: ${error.message}
        </span>
      `;
      showToast('Error scanning for duplicates', 'error');
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan & Review';
    }
  }

  /**
   * Handle email edit
   */
  function handleEditEmail() {
    if (!categoryData.account) {
      categoryData.account = {};
    }
    categoryData.account.editingEmail = true;
    categoryData.account.tempEmail =
      categoryData.account.email || window.currentUser?.email || '';
    renderCategoryContent('account');
    attachAccountHandlers();

    // Focus the input
    setTimeout(() => {
      const input = document.getElementById('emailInput');
      if (input) {
        input.focus();
        input.select();
      }
    }, 100);
  }

  /**
   * Handle email save
   */
  async function handleSaveEmail() {
    const input = document.getElementById('emailInput');
    if (!input) return;

    const newEmail = input.value.trim();

    // Validate
    if (!newEmail) {
      showToast('Email cannot be empty', 'error');
      return;
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      showToast('Please enter a valid email address', 'error');
      return;
    }

    if (
      newEmail === (categoryData.account?.email || window.currentUser?.email)
    ) {
      // No change, just cancel
      handleCancelEmail();
      return;
    }

    // Show confirmation modal
    const confirmed = await showConfirmation(
      'Change Email',
      'Are you sure you want to change your email address?',
      'You will need to verify your new email address.',
      'Change Email'
    );

    if (!confirmed) {
      handleCancelEmail();
      return;
    }

    try {
      const response = await apiCall('/settings/update-email', {
        method: 'POST',
        body: JSON.stringify({ email: newEmail }),
      });

      if (response.success) {
        showToast('Email updated successfully', 'success');

        // Update cached data
        if (categoryData.account) {
          categoryData.account.email = newEmail;
          categoryData.account.editingEmail = false;
          delete categoryData.account.tempEmail;
        }

        // Update window.currentUser
        if (window.currentUser) {
          window.currentUser.email = newEmail;
        }

        // Re-render
        renderCategoryContent('account');
        attachAccountHandlers();
      }
    } catch (error) {
      console.error('Error updating email:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to update email';
      showToast(errorMsg, 'error');
    }
  }

  /**
   * Handle email cancel
   */
  function handleCancelEmail() {
    if (categoryData.account) {
      categoryData.account.editingEmail = false;
      delete categoryData.account.tempEmail;
    }
    renderCategoryContent('account');
    attachAccountHandlers();
  }

  /**
   * Handle password change
   */
  async function handleChangePassword() {
    // Create and show password change modal
    const modal = createPasswordModal();
    document.body.appendChild(modal);
    modal.classList.remove('hidden');

    // Focus first input
    setTimeout(() => {
      const currentPasswordInput = modal.querySelector('#currentPasswordInput');
      if (currentPasswordInput) {
        currentPasswordInput.focus();
      }
    }, 100);
  }

  /**
   * Handle username edit
   */
  function handleEditUsername() {
    if (!categoryData.account) {
      categoryData.account = {};
    }
    categoryData.account.editingUsername = true;
    categoryData.account.tempUsername =
      categoryData.account.username || window.currentUser?.username || '';
    renderCategoryContent('account');
    attachAccountHandlers();

    // Focus the input
    setTimeout(() => {
      const input = document.getElementById('usernameInput');
      if (input) {
        input.focus();
        input.select();
      }
    }, 100);
  }

  /**
   * Handle username save
   */
  async function handleSaveUsername() {
    const input = document.getElementById('usernameInput');
    if (!input) return;

    const newUsername = input.value.trim();

    // Validate
    if (!newUsername) {
      showToast('Username cannot be empty', 'error');
      return;
    }

    if (newUsername.length < 3 || newUsername.length > 30) {
      showToast('Username must be 3-30 characters', 'error');
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
      showToast(
        'Username can only contain letters, numbers, and underscores',
        'error'
      );
      return;
    }

    if (
      newUsername ===
      (categoryData.account?.username || window.currentUser?.username)
    ) {
      // No change, just cancel
      handleCancelUsername();
      return;
    }

    try {
      const response = await apiCall('/settings/update-username', {
        method: 'POST',
        body: JSON.stringify({ username: newUsername }),
      });

      if (response.success) {
        showToast('Username updated successfully', 'success');

        // Update cached data
        if (categoryData.account) {
          categoryData.account.username = newUsername;
          categoryData.account.editingUsername = false;
          delete categoryData.account.tempUsername;
        }

        // Update window.currentUser
        if (window.currentUser) {
          window.currentUser.username = newUsername;
        }

        // Re-render
        renderCategoryContent('account');
        attachAccountHandlers();
      }
    } catch (error) {
      console.error('Error updating username:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to update username';
      showToast(errorMsg, 'error');
    }
  }

  /**
   * Handle username cancel
   */
  function handleCancelUsername() {
    if (categoryData.account) {
      categoryData.account.editingUsername = false;
      delete categoryData.account.tempUsername;
    }
    renderCategoryContent('account');
    attachAccountHandlers();
  }

  /**
   * Handle service disconnect
   */
  async function handleDisconnect(service) {
    const serviceName = service.charAt(0).toUpperCase() + service.slice(1);
    const confirmed = await showConfirmation(
      `Disconnect ${serviceName}`,
      `Are you sure you want to disconnect ${serviceName}?`,
      'Your listening data will no longer sync from this service.',
      'Disconnect'
    );

    if (!confirmed) return;

    try {
      // Disconnect endpoints are GET requests that redirect
      window.location.href = `/auth/${service}/disconnect`;
    } catch (error) {
      console.error('Error disconnecting service:', error);
      showToast(`Failed to disconnect ${serviceName}`, 'error');
    }
  }

  /**
   * Handle music service change
   */
  async function handleMusicServiceChange(service) {
    try {
      const result = await apiCall('/settings/update-music-service', {
        method: 'POST',
        body: JSON.stringify({ musicService: service || null }),
      });

      if (result.success) {
        showToast('Music service updated!');
        // Update local cache
        if (categoryData.integrations) {
          categoryData.integrations.musicService = service || '';
        }
        // Update window.currentUser if available
        if (window.currentUser) {
          window.currentUser.musicService = service || null;
        }
      } else {
        showToast(result.error || 'Error updating music service', 'error');
      }
    } catch (error) {
      console.error('Error updating music service:', error);
      showToast('Error updating music service', 'error');
    }
  }

  /**
   * Handle preferences sync
   */
  async function handleSyncPreferences() {
    const syncBtn = document.getElementById('syncPreferencesBtn');
    const syncIcon = document.getElementById('syncIcon');
    const syncText = document.getElementById('syncText');

    if (!syncBtn) return;

    // Disable button and show loading
    syncBtn.disabled = true;
    if (syncIcon) {
      syncIcon.classList.add('fa-spin');
    }
    if (syncText) {
      syncText.textContent = 'Syncing...';
    }

    try {
      await apiCall('/api/preferences/sync', {
        method: 'POST',
      });

      showToast('Preferences synced successfully', 'success');

      // Reload preferences data
      categoryData.preferences = null;
      await loadCategoryData('preferences');
    } catch (error) {
      console.error('Error syncing preferences:', error);
      showToast('Failed to sync preferences', 'error');
    } finally {
      // Re-enable button
      syncBtn.disabled = false;
      if (syncIcon) {
        syncIcon.classList.remove('fa-spin');
      }
      if (syncText) {
        syncText.textContent = 'Sync Now';
      }
    }
  }

  /**
   * Handle time range change for Spotify/Last.fm data
   */
  function handleSetTimeRange(service, range) {
    // Update button states
    const buttonContainer = document.getElementById(`${service}RangeButtons`);
    if (buttonContainer) {
      const buttons = buttonContainer.querySelectorAll('button');
      const activeClass =
        service === 'spotify'
          ? 'bg-green-600 text-white'
          : 'bg-red-600 text-white';
      const inactiveClass = 'bg-gray-700 text-gray-300 hover:bg-gray-600';

      buttons.forEach((btn) => {
        const btnRange = btn.getAttribute('data-range');
        const isActive = btnRange === range;

        // Remove all state classes
        btn.classList.remove(
          'bg-green-600',
          'bg-red-600',
          'bg-gray-700',
          'text-white',
          'text-gray-300',
          'hover:bg-gray-600'
        );

        // Add appropriate classes
        if (isActive) {
          activeClass.split(' ').forEach((c) => btn.classList.add(c));
        } else {
          inactiveClass.split(' ').forEach((c) => btn.classList.add(c));
        }
      });
    }

    // Show/hide data sections
    const allSections = document.querySelectorAll(
      `[data-service="${service}"][data-content]`
    );
    allSections.forEach((section) => {
      const sectionRange = section.getAttribute('data-range');
      if (sectionRange === range) {
        section.classList.remove('hidden');
      } else {
        section.classList.add('hidden');
      }
    });
  }

  /**
   * Handle accent color change (auto-save)
   */
  async function handleAccentColorChange(color) {
    try {
      await apiCall('/settings/update-accent-color', {
        method: 'POST',
        body: JSON.stringify({ accentColor: color }),
      });

      // Update CSS variable immediately
      document.documentElement.style.setProperty('--accent-color', color);

      showToast('Accent color updated', 'success');

      // Update cached data
      if (categoryData.visual) {
        categoryData.visual.accentColor = color;
      }

      // Update window.currentUser if it exists
      if (window.currentUser) {
        window.currentUser.accentColor = color;
      }
    } catch (error) {
      console.error('Error updating accent color:', error);
      showToast('Failed to update accent color', 'error');

      // Revert color input
      const input = document.getElementById('accentColor');
      if (input && categoryData.visual) {
        input.value = categoryData.visual.accentColor;
      }
    }
  }

  /**
   * Handle time format change (auto-save)
   */
  async function handleTimeFormatChange(timeFormat) {
    try {
      await apiCall('/settings/update-time-format', {
        method: 'POST',
        body: JSON.stringify({ timeFormat }),
      });

      showToast('Time format updated', 'success');

      // Update cached data
      if (categoryData.visual) {
        categoryData.visual.timeFormat = timeFormat;
      }

      // Update window.currentUser if it exists
      if (window.currentUser) {
        window.currentUser.timeFormat = timeFormat;
      }
    } catch (error) {
      console.error('Error updating time format:', error);
      showToast('Failed to update time format', 'error');

      // Revert select
      const select = document.getElementById('timeFormatSelect');
      if (select && categoryData.visual) {
        select.value = categoryData.visual.timeFormat;
      }
    }
  }

  /**
   * Handle date format change (auto-save)
   */
  async function handleDateFormatChange(dateFormat) {
    try {
      await apiCall('/settings/update-date-format', {
        method: 'POST',
        body: JSON.stringify({ dateFormat }),
      });

      showToast('Date format updated', 'success');

      // Update cached data
      if (categoryData.visual) {
        categoryData.visual.dateFormat = dateFormat;
      }

      // Update window.currentUser if it exists
      if (window.currentUser) {
        window.currentUser.dateFormat = dateFormat;
      }
    } catch (error) {
      console.error('Error updating date format:', error);
      showToast('Failed to update date format', 'error');

      // Revert select
      const select = document.getElementById('dateFormatSelect');
      if (select && categoryData.visual) {
        select.value = categoryData.visual.dateFormat;
      }
    }
  }

  /**
   * Create password change modal
   */
  function createPasswordModal() {
    const modal = document.createElement('div');
    modal.className = 'settings-modal';
    modal.id = 'passwordChangeModal';
    modal.innerHTML = `
      <div class="settings-modal-backdrop"></div>
      <div class="settings-modal-content">
        <div class="settings-modal-header">
          <h3 class="settings-modal-title">Change Password</h3>
          <button class="settings-modal-close" aria-label="Close">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="settings-modal-body">
          <form id="passwordChangeForm">
            <div class="settings-form-group">
              <label class="settings-label" for="currentPasswordInput">Current Password</label>
              <input type="password" id="currentPasswordInput" class="settings-input" required />
            </div>
            <div class="settings-form-group">
              <label class="settings-label" for="newPasswordInput">New Password</label>
              <input type="password" id="newPasswordInput" class="settings-input" required minlength="8" />
              <p class="settings-description">Must be at least 8 characters</p>
            </div>
            <div class="settings-form-group">
              <label class="settings-label" for="confirmPasswordInput">Confirm New Password</label>
              <input type="password" id="confirmPasswordInput" class="settings-input" required minlength="8" />
            </div>
            <div id="passwordError" class="text-red-500 text-sm mt-2 hidden"></div>
          </form>
        </div>
        <div class="settings-modal-footer">
          <button id="cancelPasswordBtn" class="settings-button">Cancel</button>
          <button id="savePasswordBtn" class="settings-button">Change Password</button>
        </div>
      </div>
    `;

    // Attach handlers
    const backdrop = modal.querySelector('.settings-modal-backdrop');
    const closeBtn = modal.querySelector('.settings-modal-close');
    const cancelBtn = modal.querySelector('#cancelPasswordBtn');
    const saveBtn = modal.querySelector('#savePasswordBtn');
    const form = modal.querySelector('#passwordChangeForm');

    const closeModal = () => {
      modal.classList.add('hidden');
      setTimeout(() => {
        document.body.removeChild(modal);
      }, 300);
    };

    backdrop?.addEventListener('click', closeModal);
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleSavePassword(modal);
    });

    saveBtn?.addEventListener('click', async () => {
      await handleSavePassword(modal);
    });

    return modal;
  }

  /**
   * Handle password save
   */
  async function handleSavePassword(modal) {
    const currentPassword = modal.querySelector('#currentPasswordInput').value;
    const newPassword = modal.querySelector('#newPasswordInput').value;
    const confirmPassword = modal.querySelector('#confirmPasswordInput').value;
    const errorEl = modal.querySelector('#passwordError');
    const saveBtn = modal.querySelector('#savePasswordBtn');

    // Clear previous errors
    errorEl.classList.add('hidden');
    errorEl.textContent = '';

    // Validate
    if (!currentPassword || !newPassword || !confirmPassword) {
      errorEl.textContent = 'All fields are required';
      errorEl.classList.remove('hidden');
      return;
    }

    if (newPassword.length < 8) {
      errorEl.textContent = 'New password must be at least 8 characters';
      errorEl.classList.remove('hidden');
      return;
    }

    if (newPassword !== confirmPassword) {
      errorEl.textContent = 'New passwords do not match';
      errorEl.classList.remove('hidden');
      return;
    }

    // Disable button and show loading
    saveBtn.disabled = true;
    saveBtn.textContent = 'Changing...';

    try {
      const response = await apiCall('/settings/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });

      if (response.success) {
        showToast('Password updated successfully', 'success');

        // Close modal
        modal.classList.add('hidden');
        setTimeout(() => {
          document.body.removeChild(modal);
        }, 300);
      }
    } catch (error) {
      console.error('Error changing password:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to change password';
      errorEl.textContent = errorMsg;
      errorEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Change Password';
    }
  }

  /**
   * Handle admin request
   */
  async function handleRequestAdmin() {
    const input = document.getElementById('adminCodeInput');
    if (!input) return;

    const code = input.value.trim().toUpperCase();

    if (!code) {
      showToast('Please enter an admin code', 'error');
      return;
    }

    const btn = document.getElementById('requestAdminBtn');
    if (!btn) return;

    // Disable button and show loading
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
      const response = await apiCall('/settings/request-admin', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });

      if (response.success) {
        showToast('Admin access granted!', 'success');

        // Update window.currentUser
        if (window.currentUser) {
          window.currentUser.role = 'admin';
        }

        // Reload account data to show updated role
        categoryData.account = null;
        await loadCategoryData('account');
      }
    } catch (error) {
      console.error('Error requesting admin:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to request admin access';
      showToast(errorMsg, 'error');
      btn.disabled = false;
      btn.textContent = 'Submit';
    }
  }

  /**
   * Handle admin event action
   */
  async function handleAdminEventAction(eventId, action, eventData) {
    try {
      // Build confirmation message based on action and event data
      let title = 'Confirm Action';
      let message = 'Are you sure you want to proceed with this action?';
      let confirmText = 'Confirm';

      if (
        action === 'approve' &&
        eventData?.event_type === 'account_approval'
      ) {
        title = 'Approve User Registration';
        const username = eventData.data?.username || 'this user';
        const email = eventData.data?.email || '';
        message = `Are you sure you want to approve the registration for <strong>${username}</strong>?`;
        if (email) {
          message += `<br><span class="text-sm text-gray-400">${email}</span>`;
        }
        confirmText = 'Approve User';
      } else if (
        action === 'reject' &&
        eventData?.event_type === 'account_approval'
      ) {
        title = 'Reject User Registration';
        const username = eventData.data?.username || 'this user';
        const email = eventData.data?.email || '';
        message = `Are you sure you want to reject the registration for <strong>${username}</strong>?`;
        if (email) {
          message += `<br><span class="text-sm text-gray-400">${email}</span>`;
        }
        message +=
          '<br><br><span class="text-yellow-400">This user will not be able to access the application.</span>';
        confirmText = 'Reject User';
      }

      // Show confirmation modal
      const confirmed = await showConfirmation(
        title,
        message,
        null,
        confirmText
      );

      if (!confirmed) {
        return; // User cancelled
      }

      // Execute the action
      const response = await apiCall(
        `/api/admin/events/${eventId}/action/${action}`,
        {
          method: 'POST',
        }
      );

      if (response.success) {
        showToast(
          response.message || 'Action completed successfully',
          'success'
        );

        // Reload admin data to refresh events
        categoryData.admin = null;
        await loadCategoryData('admin');
      }
    } catch (error) {
      console.error('Error executing event action:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to execute action';
      showToast(errorMsg, 'error');
    }
  }

  /**
   * Handle configure Telegram
   */
  async function handleConfigureTelegram() {
    const modal = createTelegramModal();
    document.body.appendChild(modal);
    modal.classList.remove('hidden');

    // Initialize state
    telegramModalState = {
      currentStep: 1,
      botToken: null,
      botInfo: null,
      detectedGroups: [],
      selectedGroup: null,
      groupInfo: null,
      selectedTopic: null,
      isLoading: false,
    };

    // Initialize modal UI
    updateTelegramModalStep(1);

    // Focus first input
    setTimeout(() => {
      const tokenInput = modal.querySelector('#telegramBotToken');
      if (tokenInput) {
        tokenInput.focus();
      }
    }, 100);
  }

  /**
   * Create Telegram setup modal
   */
  function createTelegramModal() {
    const modal = document.createElement('div');
    modal.className = 'settings-modal';
    modal.id = 'telegramSetupModal';
    modal.innerHTML = `
      <div class="settings-modal-backdrop"></div>
      <div class="settings-modal-content" style="max-width: 32rem;">
        <div class="settings-modal-header">
          <h3 class="settings-modal-title">
            <i class="fab fa-telegram text-blue-400 mr-2"></i>
            Configure Telegram
          </h3>
          <button class="settings-modal-close" aria-label="Close">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="settings-modal-body">
          <!-- Step 1: Bot Token -->
          <div id="telegramStep1" class="telegram-step active" data-step="1">
            <h4 class="text-sm font-semibold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
              <span class="telegram-step-indicator">1</span>
              Create a Telegram Bot
            </h4>
            <ol class="text-sm text-gray-400 mb-4 space-y-1 list-decimal list-inside">
              <li>Open Telegram and message <a href="https://t.me/BotFather" target="_blank" class="text-blue-400 hover:underline">@BotFather</a></li>
              <li>Send <code class="bg-gray-800 px-1.5 py-0.5 rounded-sm text-xs">/newbot</code> and follow the prompts</li>
              <li>Copy the bot token and paste it below</li>
            </ol>
            <div class="flex gap-2">
              <input 
                type="password" 
                id="telegramBotToken" 
                placeholder="Paste your bot token here..."
                class="settings-input flex-1"
              >
              <button id="validateTelegramTokenBtn" class="settings-button">
                <i class="fas fa-check mr-2"></i>Validate
              </button>
            </div>
            <div id="telegramTokenFeedback" class="telegram-feedback mt-2 hidden"></div>
          </div>
          
          <!-- Step 2: Group Selection -->
          <div id="telegramStep2" class="telegram-step disabled" data-step="2">
            <h4 class="text-sm font-semibold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
              <span class="telegram-step-indicator">2</span>
              Connect to Admin Group
            </h4>
            <p class="text-sm text-gray-400 mb-4">
              Add your bot to an admin-only group, then send any message in the group and click Detect.
            </p>
            <div class="flex gap-2 mb-3">
              <button id="detectTelegramGroupsBtn" class="settings-button">
                <i class="fas fa-search mr-2"></i>Detect Groups
              </button>
            </div>
            <select id="telegramGroupSelect" class="settings-select w-full hidden">
              <option value="">Select a group...</option>
            </select>
            <div id="telegramGroupFeedback" class="telegram-feedback mt-2 hidden"></div>
          </div>
          
          <!-- Step 3: Topic Selection (for forum groups) -->
          <div id="telegramStep3" class="telegram-step disabled hidden" data-step="3">
            <h4 class="text-sm font-semibold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
              <span class="telegram-step-indicator">3</span>
              Select Topic (Optional)
            </h4>
            <p class="text-sm text-gray-400 mb-4">
              This group has Topics enabled. Select a topic for notifications or use General.
            </p>
            <select id="telegramTopicSelect" class="settings-select w-full">
              <option value="">General (default)</option>
            </select>
          </div>
          
          <!-- Step 4: Test & Save -->
          <div id="telegramStep4" class="telegram-step disabled" data-step="4">
            <h4 class="text-sm font-semibold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
              <span class="telegram-step-indicator">4</span>
              Test & Activate
            </h4>
            <div id="telegramSaveFeedback" class="telegram-feedback mb-3 hidden"></div>
            <div class="flex flex-wrap gap-2">
              <button id="sendTelegramTestBtn" class="settings-button">
                <i class="fas fa-paper-plane mr-2"></i>Send Test
              </button>
              <button id="saveTelegramConfigBtn" class="settings-button">
                <i class="fas fa-save mr-2"></i>Save & Enable
              </button>
            </div>
          </div>
        </div>
        <div class="settings-modal-footer">
          <button id="closeTelegramModalBtn" class="settings-button">Cancel</button>
        </div>
      </div>
    `;

    // Attach handlers
    const backdrop = modal.querySelector('.settings-modal-backdrop');
    const closeBtn = modal.querySelector('.settings-modal-close');
    const cancelBtn = modal.querySelector('#closeTelegramModalBtn');
    const validateBtn = modal.querySelector('#validateTelegramTokenBtn');
    const detectBtn = modal.querySelector('#detectTelegramGroupsBtn');
    const groupSelect = modal.querySelector('#telegramGroupSelect');
    const topicSelect = modal.querySelector('#telegramTopicSelect');
    const testBtn = modal.querySelector('#sendTelegramTestBtn');
    const saveBtn = modal.querySelector('#saveTelegramConfigBtn');

    const closeModal = () => {
      modal.classList.add('hidden');
      setTimeout(() => {
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
        telegramModalState = null;
      }, 300);
    };

    backdrop?.addEventListener('click', closeModal);
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);

    validateBtn?.addEventListener('click', () =>
      handleValidateTelegramToken(modal)
    );
    detectBtn?.addEventListener('click', () =>
      handleDetectTelegramGroups(modal)
    );
    groupSelect?.addEventListener('change', (e) =>
      handleSelectTelegramGroup(modal, e.target.value)
    );
    topicSelect?.addEventListener('change', (e) =>
      handleSelectTelegramTopic(modal, e.target.value)
    );
    testBtn?.addEventListener('click', () => handleSendTelegramTest(modal));
    saveBtn?.addEventListener('click', () => handleSaveTelegramConfig(modal));

    // Allow Enter key to validate token
    const tokenInput = modal.querySelector('#telegramBotToken');
    tokenInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleValidateTelegramToken(modal);
      }
    });

    return modal;
  }

  /**
   * Update Telegram modal step UI
   */
  function updateTelegramModalStep(step) {
    if (!telegramModalState) return;

    telegramModalState.currentStep = step;

    // Update all steps
    for (let i = 1; i <= 4; i++) {
      const stepEl = document.querySelector(`#telegramStep${i}`);
      if (!stepEl) continue;

      stepEl.classList.remove('active', 'completed', 'disabled');

      if (i < step) {
        stepEl.classList.add('completed');
      } else if (i === step) {
        stepEl.classList.add('active');
      } else {
        stepEl.classList.add('disabled');
      }
    }
  }

  /**
   * Enable Telegram step
   */
  function enableTelegramStep(step) {
    // Mark previous steps as completed
    for (let i = 1; i < step; i++) {
      const prevStepEl = document.querySelector(`#telegramStep${i}`);
      if (prevStepEl) {
        prevStepEl.classList.remove('active', 'disabled');
        prevStepEl.classList.add('completed');
      }
    }

    const stepEl = document.querySelector(`#telegramStep${step}`);
    if (stepEl) {
      stepEl.classList.remove('disabled', 'completed');
      stepEl.classList.add('active');
      updateTelegramModalStep(step);
    }
  }

  /**
   * Disable Telegram step
   */
  function _disableTelegramStep(step) {
    const stepEl = document.querySelector(`#telegramStep${step}`);
    if (stepEl) {
      stepEl.classList.add('disabled');
      stepEl.classList.remove('active', 'completed');
    }
  }

  /**
   * Handle validate Telegram token (Step 1)
   */
  async function handleValidateTelegramToken(modal) {
    if (!telegramModalState) return;

    const tokenInput = modal.querySelector('#telegramBotToken');
    const feedbackEl = modal.querySelector('#telegramTokenFeedback');
    const validateBtn = modal.querySelector('#validateTelegramTokenBtn');

    if (!tokenInput || !feedbackEl || !validateBtn) return;

    const token = tokenInput.value.trim();

    // Basic validation
    if (!token) {
      feedbackEl.className = 'telegram-feedback error mt-2';
      feedbackEl.innerHTML =
        '<i class="fas fa-exclamation-circle"></i>Please enter a bot token';
      feedbackEl.classList.remove('hidden');
      return;
    }

    // Basic format check (Telegram bot tokens are typically long alphanumeric strings)
    if (token.length < 20) {
      feedbackEl.className = 'telegram-feedback error mt-2';
      feedbackEl.innerHTML =
        '<i class="fas fa-exclamation-circle"></i>Token appears to be invalid (too short)';
      feedbackEl.classList.remove('hidden');
      return;
    }

    // Show loading state
    validateBtn.disabled = true;
    validateBtn.innerHTML =
      '<i class="fas fa-spinner fa-spin mr-2"></i>Validating...';
    feedbackEl.className = 'telegram-feedback loading mt-2';
    feedbackEl.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i>Validating token...';
    feedbackEl.classList.remove('hidden');

    try {
      const response = await apiCall('/api/admin/telegram/validate-token', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });

      if (response.valid && response.botInfo) {
        // Success
        telegramModalState.botToken = token;
        telegramModalState.botInfo = response.botInfo;

        feedbackEl.className = 'telegram-feedback success mt-2';
        feedbackEl.innerHTML = `<i class="fas fa-check-circle"></i>Token validated! Bot: @${response.botInfo.username || 'unknown'}`;
        feedbackEl.classList.remove('hidden');

        // Enable Step 2
        enableTelegramStep(2);
        updateTelegramModalStep(2);
      } else {
        throw new Error(response.error || 'Invalid token');
      }
    } catch (error) {
      console.error('Error validating Telegram token:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to validate token';
      feedbackEl.className = 'telegram-feedback error mt-2';
      feedbackEl.innerHTML = `<i class="fas fa-exclamation-circle"></i>${errorMsg}`;
      feedbackEl.classList.remove('hidden');
    } finally {
      validateBtn.disabled = false;
      validateBtn.innerHTML = '<i class="fas fa-check mr-2"></i>Validate';
    }
  }

  /**
   * Handle detect Telegram groups (Step 2)
   */
  async function handleDetectTelegramGroups(modal) {
    if (!telegramModalState || !telegramModalState.botToken) {
      showToast('Please validate bot token first', 'error');
      return;
    }

    const detectBtn = modal.querySelector('#detectTelegramGroupsBtn');
    const groupSelect = modal.querySelector('#telegramGroupSelect');
    const feedbackEl = modal.querySelector('#telegramGroupFeedback');

    if (!detectBtn || !groupSelect || !feedbackEl) return;

    // Show loading state
    detectBtn.disabled = true;
    detectBtn.innerHTML =
      '<i class="fas fa-spinner fa-spin mr-2"></i>Detecting...';
    feedbackEl.className = 'telegram-feedback loading mt-2';
    feedbackEl.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i>Detecting groups...';
    feedbackEl.classList.remove('hidden');
    groupSelect.classList.add('hidden');

    try {
      const response = await apiCall('/api/admin/telegram/detect-groups', {
        method: 'POST',
        body: JSON.stringify({ token: telegramModalState.botToken }),
      });

      if (response.groups && response.groups.length > 0) {
        telegramModalState.detectedGroups = response.groups;

        // Populate dropdown
        groupSelect.innerHTML = '<option value="">Select a group...</option>';
        response.groups.forEach((group) => {
          const option = document.createElement('option');
          option.value = group.id;
          option.textContent = `${group.title} (${group.type})`;
          groupSelect.appendChild(option);
        });

        groupSelect.classList.remove('hidden');
        feedbackEl.className = 'telegram-feedback success mt-2';
        feedbackEl.innerHTML = `<i class="fas fa-check-circle"></i>Found ${response.groups.length} group(s). Select one below.`;
        feedbackEl.classList.remove('hidden');
      } else {
        feedbackEl.className = 'telegram-feedback error mt-2';
        feedbackEl.innerHTML =
          '<i class="fas fa-exclamation-circle"></i>No groups found. Make sure the bot is added to a group and has sent a message.';
        feedbackEl.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error detecting Telegram groups:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to detect groups';
      feedbackEl.className = 'telegram-feedback error mt-2';
      feedbackEl.innerHTML = `<i class="fas fa-exclamation-circle"></i>${errorMsg}`;
      feedbackEl.classList.remove('hidden');
    } finally {
      detectBtn.disabled = false;
      detectBtn.innerHTML = '<i class="fas fa-search mr-2"></i>Detect Groups';
    }
  }

  /**
   * Handle select Telegram group (Step 2)
   */
  async function handleSelectTelegramGroup(modal, chatId) {
    if (!telegramModalState || !chatId || !telegramModalState.botToken) return;

    const feedbackEl = modal.querySelector('#telegramGroupFeedback');
    const step3El = modal.querySelector('#telegramStep3');
    const topicSelect = modal.querySelector('#telegramTopicSelect');

    if (!feedbackEl) return;

    // Show loading
    feedbackEl.className = 'telegram-feedback loading mt-2';
    feedbackEl.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i>Loading group info...';
    feedbackEl.classList.remove('hidden');

    try {
      const response = await apiCall('/api/admin/telegram/group-info', {
        method: 'POST',
        body: JSON.stringify({
          token: telegramModalState.botToken,
          chatId: chatId,
        }),
      });

      // Find selected group
      const selectedGroup = telegramModalState.detectedGroups.find(
        (g) => g.id === chatId
      );
      telegramModalState.selectedGroup = selectedGroup || {
        id: chatId,
        title: response.title || 'Unknown',
      };
      telegramModalState.groupInfo = response;

      if (response.isForum && response.topics && response.topics.length > 0) {
        // Forum group - show Step 3
        telegramModalState.selectedTopic = null; // Reset topic selection

        // Populate topics dropdown
        if (topicSelect) {
          topicSelect.innerHTML = '<option value="">General (default)</option>';
          response.topics.forEach((topic) => {
            const option = document.createElement('option');
            option.value = topic.id;
            option.textContent = topic.name || `Topic ${topic.id}`;
            topicSelect.appendChild(option);
          });
        }

        if (step3El) {
          step3El.classList.remove('hidden');
          enableTelegramStep(3);
        }
        updateTelegramModalStep(3);

        feedbackEl.className = 'telegram-feedback success mt-2';
        feedbackEl.innerHTML = `<i class="fas fa-check-circle"></i>Group selected: ${response.title}. This is a forum group - select a topic below.`;
        feedbackEl.classList.remove('hidden');
      } else {
        // Regular group - skip to Step 4
        if (step3El) {
          step3El.classList.add('hidden');
        }
        enableTelegramStep(4);
        updateTelegramModalStep(4);

        feedbackEl.className = 'telegram-feedback success mt-2';
        feedbackEl.innerHTML = `<i class="fas fa-check-circle"></i>Group selected: ${response.title}. You can now test and save.`;
        feedbackEl.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error getting group info:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to get group info';
      feedbackEl.className = 'telegram-feedback error mt-2';
      feedbackEl.innerHTML = `<i class="fas fa-exclamation-circle"></i>${errorMsg}`;
      feedbackEl.classList.remove('hidden');
    }
  }

  /**
   * Handle select Telegram topic (Step 3)
   */
  function handleSelectTelegramTopic(modal, threadId) {
    if (!telegramModalState) return;

    const topicSelect = modal.querySelector('#telegramTopicSelect');
    if (!topicSelect) return;

    const selectedOption = topicSelect.options[topicSelect.selectedIndex];
    const topicName = selectedOption ? selectedOption.textContent : null;

    telegramModalState.selectedTopic = threadId
      ? { threadId: parseInt(threadId, 10), topicName }
      : null;

    // Enable Step 4
    enableTelegramStep(4);
    updateTelegramModalStep(4);
  }

  /**
   * Handle send Telegram test (Step 4)
   */
  async function handleSendTelegramTest(modal) {
    if (
      !telegramModalState ||
      !telegramModalState.botToken ||
      !telegramModalState.selectedGroup
    ) {
      showToast('Please complete all previous steps', 'error');
      return;
    }

    const testBtn = modal.querySelector('#sendTelegramTestBtn');
    const feedbackEl = modal.querySelector('#telegramSaveFeedback');

    if (!testBtn || !feedbackEl) return;

    // Show loading state
    testBtn.disabled = true;
    testBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Sending...';
    feedbackEl.className = 'telegram-feedback loading mb-3';
    feedbackEl.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i>Sending test message...';
    feedbackEl.classList.remove('hidden');

    try {
      const response = await apiCall('/api/admin/telegram/test-preview', {
        method: 'POST',
        body: JSON.stringify({
          token: telegramModalState.botToken,
          chatId: telegramModalState.selectedGroup.id,
          threadId: telegramModalState.selectedTopic?.threadId || null,
        }),
      });

      if (response.success) {
        feedbackEl.className = 'telegram-feedback success mb-3';
        feedbackEl.innerHTML =
          '<i class="fas fa-check-circle"></i>Test message sent! Check your Telegram group.';
        feedbackEl.classList.remove('hidden');
        showToast('Test message sent successfully', 'success');
      } else {
        throw new Error(response.error || 'Failed to send test message');
      }
    } catch (error) {
      console.error('Error sending Telegram test:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to send test message';
      feedbackEl.className = 'telegram-feedback error mb-3';
      feedbackEl.innerHTML = `<i class="fas fa-exclamation-circle"></i>${errorMsg}`;
      feedbackEl.classList.remove('hidden');
    } finally {
      testBtn.disabled = false;
      testBtn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Send Test';
    }
  }

  /**
   * Handle save Telegram config (Step 4)
   */
  async function handleSaveTelegramConfig(modal) {
    if (
      !telegramModalState ||
      !telegramModalState.botToken ||
      !telegramModalState.selectedGroup
    ) {
      showToast('Please complete all previous steps', 'error');
      return;
    }

    const saveBtn = modal.querySelector('#saveTelegramConfigBtn');
    const feedbackEl = modal.querySelector('#telegramSaveFeedback');

    if (!saveBtn || !feedbackEl) return;

    // Show loading state
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
    feedbackEl.className = 'telegram-feedback loading mb-3';
    feedbackEl.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i>Saving configuration...';
    feedbackEl.classList.remove('hidden');

    try {
      const response = await apiCall('/api/admin/telegram/save-config', {
        method: 'POST',
        body: JSON.stringify({
          botToken: telegramModalState.botToken,
          chatId: telegramModalState.selectedGroup.id,
          threadId: telegramModalState.selectedTopic?.threadId || null,
          chatTitle:
            telegramModalState.selectedGroup.title ||
            telegramModalState.groupInfo?.title ||
            'Admin Group',
          topicName: telegramModalState.selectedTopic?.topicName || null,
        }),
      });

      if (response.success) {
        feedbackEl.className = 'telegram-feedback success mb-3';
        feedbackEl.innerHTML =
          '<i class="fas fa-check-circle"></i>Configuration saved successfully!';
        feedbackEl.classList.remove('hidden');
        showToast('Telegram notifications enabled!', 'success');

        // Close modal and reload admin data
        setTimeout(() => {
          modal.classList.add('hidden');
          setTimeout(() => {
            if (document.body.contains(modal)) {
              document.body.removeChild(modal);
            }
            telegramModalState = null;

            // Reload admin data to refresh Telegram status
            categoryData.admin = null;
            loadCategoryData('admin');
          }, 300);
        }, 1000);
      } else {
        throw new Error(response.error || 'Failed to save configuration');
      }
    } catch (error) {
      console.error('Error saving Telegram config:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to save configuration';
      feedbackEl.className = 'telegram-feedback error mb-3';
      feedbackEl.innerHTML = `<i class="fas fa-exclamation-circle"></i>${errorMsg}`;
      feedbackEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Save & Enable';
    }
  }

  /**
   * Handle disconnect Telegram
   */
  async function handleDisconnectTelegram() {
    const confirmed = await showConfirmation(
      'Disconnect Telegram',
      'Are you sure you want to disconnect Telegram notifications?',
      'You can reconnect at any time.',
      'Disconnect'
    );

    if (!confirmed) return;

    try {
      const response = await apiCall('/api/admin/telegram/disconnect', {
        method: 'DELETE',
      });

      if (response.success) {
        showToast('Telegram disconnected successfully', 'success');

        // Reload admin data
        categoryData.admin = null;
        await loadCategoryData('admin');
      }
    } catch (error) {
      console.error('Error disconnecting Telegram:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to disconnect Telegram';
      showToast(errorMsg, 'error');
    }
  }

  /**
   * Handle restore database
   */
  /**
   * Handle restore database (opens modal)
   */
  async function handleRestoreDatabase() {
    // Create and show modal
    const modal = await createRestoreModal();
    document.body.appendChild(modal);

    // Trigger animation
    setTimeout(() => {
      modal.classList.remove('hidden');
    }, 10);
  }

  /**
   * Create restore database modal
   */
  async function createRestoreModal() {
    const modal = document.createElement('div');
    modal.className = 'settings-modal hidden';
    modal.id = 'restoreDatabaseModal';
    modal.innerHTML = `
      <div class="settings-modal-backdrop"></div>
      <div class="settings-modal-content" style="max-width: 500px;">
        <div class="settings-modal-header">
          <h3 class="settings-modal-title">
            <i class="fas fa-upload mr-2 text-red-500"></i>Restore Database
          </h3>
          <button class="settings-modal-close" aria-label="Close">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="settings-modal-body">
          <div class="bg-red-900/20 border border-red-800/50 rounded-lg p-4 mb-4">
            <p class="text-red-400 text-sm font-semibold mb-2">⚠️ Warning</p>
            <p class="text-gray-300 text-sm">This will replace the entire database with the backup file. All current data will be permanently lost. The server will restart automatically after restoration.</p>
          </div>
          <form id="restoreDatabaseForm">
            <div class="settings-form-group">
              <label class="settings-label" for="backupFileInput">Backup File (.dump)</label>
              <input type="file" id="backupFileInput" class="settings-input" accept=".dump" required />
              <p class="settings-description">Select a PostgreSQL dump file to restore</p>
            </div>
            <div id="restoreError" class="text-red-500 text-sm mt-2 hidden"></div>
            <div id="restoreProgress" class="hidden mt-4">
              <div class="flex items-center gap-2 text-sm text-gray-400">
                <i class="fas fa-spinner fa-spin"></i>
                <span id="restoreProgressText">Uploading backup...</span>
              </div>
            </div>
          </form>
        </div>
        <div class="settings-modal-footer">
          <button id="cancelRestoreBtn" class="settings-button">Cancel</button>
          <button id="confirmRestoreBtn" class="settings-button settings-button-danger" disabled>Restore Database</button>
        </div>
      </div>
    `;

    // Attach close handlers
    const backdrop = modal.querySelector('.settings-modal-backdrop');
    const closeBtn = modal.querySelector('.settings-modal-close');
    const cancelBtn = modal.querySelector('#cancelRestoreBtn');
    const confirmBtn = modal.querySelector('#confirmRestoreBtn');
    const form = modal.querySelector('#restoreDatabaseForm');
    const fileInput = modal.querySelector('#backupFileInput');
    const errorEl = modal.querySelector('#restoreError');

    const closeModal = () => {
      modal.classList.add('hidden');
      setTimeout(() => {
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
      }, 300);
    };

    backdrop?.addEventListener('click', closeModal);
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);

    // Enable/disable restore button based on file selection
    fileInput.addEventListener('change', () => {
      const hasFile = fileInput.files && fileInput.files.length > 0;
      confirmBtn.disabled = !hasFile;
      errorEl.classList.add('hidden');
    });

    // Handle form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleConfirmRestore(modal);
    });

    // Handle restore button click
    confirmBtn.addEventListener('click', async () => {
      await handleConfirmRestore(modal);
    });

    return modal;
  }

  /**
   * Handle confirm restore
   */
  async function handleConfirmRestore(modal) {
    const fileInput = modal.querySelector('#backupFileInput');
    const errorEl = modal.querySelector('#restoreError');
    const progressEl = modal.querySelector('#restoreProgress');
    const progressText = modal.querySelector('#restoreProgressText');
    const confirmBtn = modal.querySelector('#confirmRestoreBtn');

    const closeModal = () => {
      modal.classList.add('hidden');
      setTimeout(() => {
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
      }, 300);
    };

    if (!fileInput.files || fileInput.files.length === 0) {
      errorEl.textContent = 'Please select a backup file';
      errorEl.classList.remove('hidden');
      return;
    }

    const file = fileInput.files[0];
    if (!file.name.endsWith('.dump')) {
      errorEl.textContent = 'Please select a valid .dump file';
      errorEl.classList.remove('hidden');
      return;
    }

    // Show progress
    errorEl.classList.add('hidden');
    progressEl.classList.remove('hidden');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Restoring...';

    try {
      const formData = new FormData();
      formData.append('backup', file);

      progressText.textContent = 'Uploading backup...';

      const response = await fetch('/admin/restore', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
        headers: {
          'X-CSRF-Token': window.csrfToken || '',
        },
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: 'Restore failed' }));
        throw new Error(errorData.error || 'Restore failed');
      }

      const result = await response.json();

      progressText.textContent =
        result.message || 'Restore completed. Server restarting...';

      showToast(
        'Database restored successfully. Server will restart...',
        'success'
      );

      // Close modal after a delay
      setTimeout(() => {
        closeModal();
      }, 2000);
    } catch (error) {
      console.error('Error restoring database:', error);
      errorEl.textContent = error.message || 'Failed to restore database';
      errorEl.classList.remove('hidden');
      progressEl.classList.add('hidden');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Restore Database';
    }
  }

  // ============ ALBUM SUMMARY HANDLERS ============

  let albumSummaryPollInterval = null;

  // ============ IMAGE REFETCH HANDLERS ============

  let imageRefetchPollInterval = null;
  let imageRefetchPollCount = 0;
  const STATS_REFRESH_INTERVAL = 10; // Refresh stats every N polls (~15 seconds)

  /**
   * Load and display album summary statistics
   */
  async function loadAlbumSummaryStats() {
    const statsEl = document.getElementById('albumSummaryStats');
    if (!statsEl) return;

    try {
      const response = await apiCall('/api/admin/album-summaries/stats');
      const { stats, batchStatus } = response;

      if (!stats) {
        statsEl.innerHTML =
          '<div class="text-gray-400 text-sm">No stats available</div>';
        return;
      }

      statsEl.innerHTML = `
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-white text-lg">${stats.totalAlbums || 0}</div>
            <div class="text-xs text-gray-400 uppercase">Total Albums</div>
          </div>
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-green-400 text-lg">${stats.withSummary || 0}</div>
            <div class="text-xs text-gray-400 uppercase">With Summary</div>
          </div>
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-yellow-400 text-lg">${stats.attemptedNoSummary || 0}</div>
            <div class="text-xs text-gray-400 uppercase">No Summary Found</div>
          </div>
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-blue-400 text-lg">${stats.neverAttempted || 0}</div>
            <div class="text-xs text-gray-400 uppercase">Never Attempted</div>
          </div>
        </div>
        <div class="grid grid-cols-1 gap-2">
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-orange-400 text-lg">${stats.fromClaude || 0}</div>
            <div class="text-xs text-gray-400 uppercase"><i class="fas fa-robot mr-1"></i>From Claude AI</div>
          </div>
        </div>
      `;

      // Update UI based on batch status
      updateAlbumSummaryUI(batchStatus);
    } catch (error) {
      console.error('Error loading album summary stats:', error);
      statsEl.innerHTML =
        '<div class="text-red-400 text-sm">Failed to load stats</div>';
    }
  }

  /**
   * Update album summary UI based on batch status
   */
  function updateAlbumSummaryUI(status) {
    const fetchBtn = document.getElementById('fetchAlbumSummariesBtn');
    const regenerateBtn = document.getElementById('regenerateAllSummariesBtn');
    const stopBtn = document.getElementById('stopAlbumSummariesBtn');
    const progressEl = document.getElementById('albumSummaryProgress');
    const progressBar = document.getElementById('albumSummaryProgressBar');
    const progressText = document.getElementById('albumSummaryProgressText');

    if (!fetchBtn || !stopBtn || !progressEl) return;

    if (status?.running) {
      // Hide both action buttons, show stop button
      fetchBtn.classList.add('hidden');
      if (regenerateBtn) regenerateBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
      progressEl.classList.remove('hidden');

      const progress = status.progress || 0;
      progressBar.style.width = `${progress}%`;
      progressText.textContent = `Processing: ${status.processed || 0}/${status.total || 0} (${status.found || 0} found, ${status.notFound || 0} not found, ${status.errors || 0} errors)`;

      // Start polling if not already
      if (!albumSummaryPollInterval) {
        albumSummaryPollInterval = setInterval(pollAlbumSummaryStatus, 2000);
      }
    } else {
      // Show both action buttons, hide stop button
      fetchBtn.classList.remove('hidden');
      if (regenerateBtn) regenerateBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');
      progressEl.classList.add('hidden');

      // Stop polling
      if (albumSummaryPollInterval) {
        clearInterval(albumSummaryPollInterval);
        albumSummaryPollInterval = null;
      }
    }
  }

  /**
   * Poll album summary batch status
   */
  async function pollAlbumSummaryStatus() {
    try {
      const response = await apiCall('/api/admin/album-summaries/status');
      updateAlbumSummaryUI(response.status);

      // If job finished, reload stats (silently handle errors to avoid false positives)
      if (!response.status?.running) {
        try {
          await loadAlbumSummaryStats();
        } catch (statsError) {
          // Silently handle stats loading errors - these are not critical failures
          // The batch job completed successfully, stats loading failure is just a UI refresh issue
          console.error(
            'Error loading album summary stats after batch completion:',
            statsError
          );
        }
      }
    } catch (error) {
      // Only log polling errors, don't show toast (polling failures are expected during network issues)
      console.error('Error polling album summary status:', error);
    }
  }

  /**
   * Handle fetch album summaries button
   */
  async function handleFetchAlbumSummaries() {
    const fetchBtn = document.getElementById('fetchAlbumSummariesBtn');

    try {
      fetchBtn.disabled = true;
      fetchBtn.textContent = 'Starting...';

      const response = await apiCall('/api/admin/album-summaries/fetch', {
        method: 'POST',
        body: JSON.stringify({ includeRetries: true, regenerateAll: false }),
      });

      if (response.success) {
        showToast('Album summary fetch started', 'success');
        updateAlbumSummaryUI(response.status);
      }
    } catch (error) {
      console.error('Error starting album summary fetch:', error);
      showToast(error.data?.error || 'Failed to start fetch', 'error');
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = 'Fetch Missing';
    }
  }

  /**
   * Handle stop album summaries button
   */
  async function handleStopAlbumSummaries() {
    const stopBtn = document.getElementById('stopAlbumSummariesBtn');

    try {
      stopBtn.disabled = true;
      stopBtn.textContent = 'Stopping...';

      const response = await apiCall('/api/admin/album-summaries/stop', {
        method: 'POST',
      });

      if (response.success) {
        showToast('Album summary fetch stopped', 'success');
        updateAlbumSummaryUI(response.status);
        await loadAlbumSummaryStats();
      }
    } catch (error) {
      console.error('Error stopping album summary fetch:', error);
      showToast('Failed to stop fetch', 'error');
    } finally {
      stopBtn.disabled = false;
      stopBtn.textContent = 'Stop';
    }
  }

  // ============ ALBUM IMAGE HANDLERS ============

  /**
   * Load and display album image statistics
   */
  async function loadAlbumImageStats() {
    const statsEl = document.getElementById('albumImageStats');
    if (!statsEl) return;

    try {
      const response = await apiCall('/api/admin/images/stats');
      const { stats, isRunning } = response;

      if (!stats) {
        statsEl.innerHTML =
          '<div class="text-gray-400 text-sm">No stats available</div>';
        return;
      }

      statsEl.innerHTML = `
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-white text-lg">${stats.totalAlbums || 0}</div>
            <div class="text-xs text-gray-400 uppercase">Total Albums</div>
          </div>
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-green-400 text-lg">${stats.withImage || 0}</div>
            <div class="text-xs text-gray-400 uppercase">With Image</div>
          </div>
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-yellow-400 text-lg">${stats.withoutImage || 0}</div>
            <div class="text-xs text-gray-400 uppercase">Without Image</div>
          </div>
        </div>
        <div class="text-xs text-gray-500 mt-2">
          Avg size: ${stats.avgSizeKb || 0} KB | Min: ${stats.minSizeKb || 0} KB | Max: ${stats.maxSizeKb || 0} KB
        </div>
      `;

      // Update button states based on running status
      // If running, fetch progress to show current state
      if (isRunning) {
        try {
          const progressResponse = await apiCall('/api/admin/images/progress');
          updateImageRefetchUI(isRunning, progressResponse.progress);
        } catch {
          updateImageRefetchUI(isRunning, null);
        }
      } else {
        updateImageRefetchUI(isRunning);
      }
    } catch (error) {
      console.error('Error loading album image stats:', error);
      statsEl.innerHTML =
        '<div class="text-red-400 text-sm">Failed to load stats</div>';
    }
  }

  /**
   * Update image refetch UI based on running status and progress
   */
  function updateImageRefetchUI(isRunning, progress = null) {
    const refetchBtn = document.getElementById('refetchAlbumImagesBtn');
    const stopBtn = document.getElementById('stopRefetchImagesBtn');
    const progressContainer = document.getElementById('imageRefetchProgress');
    const progressBar = document.getElementById('imageRefetchProgressBar');
    const progressPercent = document.getElementById(
      'imageRefetchProgressPercent'
    );
    const progressLabel = document.getElementById('imageRefetchProgressLabel');

    if (!refetchBtn || !stopBtn) return;

    if (isRunning) {
      refetchBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');

      // Show progress bar
      if (progressContainer) {
        progressContainer.classList.remove('hidden');
      }

      // Update progress if available
      if (progress && progressBar) {
        const percent = progress.percentComplete || 0;
        progressBar.style.width = `${percent}%`;
        if (progressPercent) {
          progressPercent.textContent = `${percent}%`;
        }
        if (progressLabel) {
          const skippedInfo = progress.skipped
            ? ` (${progress.skipped} skipped)`
            : '';
          progressLabel.textContent = `Processing ${progress.processed || 0} of ${progress.total || 0}...${skippedInfo}`;
        }
      }

      // Start polling if not already
      if (!imageRefetchPollInterval) {
        imageRefetchPollCount = 0;
        imageRefetchPollInterval = setInterval(pollImageRefetchProgress, 1500);
      }
    } else {
      refetchBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');

      // Hide progress bar when not running
      if (progressContainer) {
        progressContainer.classList.add('hidden');
      }

      // Stop polling
      if (imageRefetchPollInterval) {
        clearInterval(imageRefetchPollInterval);
        imageRefetchPollInterval = null;
      }
    }
  }

  /**
   * Poll for image refetch progress
   */
  async function pollImageRefetchProgress() {
    try {
      const response = await apiCall('/api/admin/images/progress');
      const { isRunning, progress } = response;

      updateImageRefetchUI(isRunning, progress);
      imageRefetchPollCount++;

      // Refresh stats periodically while running (every ~15 seconds)
      if (isRunning && imageRefetchPollCount % STATS_REFRESH_INTERVAL === 0) {
        await refreshImageStatsOnly();
      }

      // If no longer running, stop polling and reload stats
      if (!isRunning && imageRefetchPollInterval) {
        clearInterval(imageRefetchPollInterval);
        imageRefetchPollInterval = null;
        imageRefetchPollCount = 0;
        await loadAlbumImageStats();
      }
    } catch (error) {
      console.error('Error polling image refetch progress:', error);
    }
  }

  /**
   * Refresh just the stats display without affecting UI state
   */
  async function refreshImageStatsOnly() {
    const statsEl = document.getElementById('albumImageStats');
    if (!statsEl) return;

    try {
      const response = await apiCall('/api/admin/images/stats');
      const { stats } = response;

      if (!stats) return;

      statsEl.innerHTML = `
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-white text-lg">${stats.totalAlbums || 0}</div>
            <div class="text-xs text-gray-400 uppercase">Total Albums</div>
          </div>
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-green-400 text-lg">${stats.withImage || 0}</div>
            <div class="text-xs text-gray-400 uppercase">With Image</div>
          </div>
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-yellow-400 text-lg">${stats.withoutImage || 0}</div>
            <div class="text-xs text-gray-400 uppercase">Without Image</div>
          </div>
        </div>
        <div class="text-xs text-gray-500 mt-2">
          Avg size: ${stats.avgSizeKb || 0} KB | Min: ${stats.minSizeKb || 0} KB | Max: ${stats.maxSizeKb || 0} KB
        </div>
      `;
    } catch (error) {
      console.error('Error refreshing image stats:', error);
    }
  }

  /**
   * Handle refetch album images button
   */
  async function handleRefetchAlbumImages() {
    const refetchBtn = document.getElementById('refetchAlbumImagesBtn');
    const resultEl = document.getElementById('imageRefetchResult');
    const resultTextEl = document.getElementById('imageRefetchResultText');

    const confirmed = await showConfirmation(
      'Refetch Album Images',
      'This will re-download cover art from external sources for albums missing images or with low-quality images.',
      'Albums with 512x512+ images or >= 100KB are skipped. The operation can be stopped at any time.',
      'Start Refetch'
    );

    if (!confirmed) return;

    try {
      refetchBtn.disabled = true;
      refetchBtn.textContent = 'Starting...';

      // Hide any previous results
      resultEl.classList.add('hidden');

      // Show initial UI state (will start polling)
      updateImageRefetchUI(true, {
        total: 0,
        processed: 0,
        percentComplete: 0,
        currentAlbum: null,
      });

      showToast('Image refetch started. This may take a while...', 'info');

      const response = await apiCall('/api/admin/images/refetch', {
        method: 'POST',
      });

      if (response.success && response.summary) {
        const s = response.summary;
        const duration = formatDuration(s.durationSeconds);

        resultTextEl.innerHTML = `
          <div class="font-semibold text-white mb-2">
            ${s.stoppedEarly ? 'Refetch Stopped Early' : 'Refetch Complete'}
          </div>
          <div class="grid grid-cols-2 gap-2 text-sm">
            <div><span class="text-gray-400">Total:</span> ${s.total}</div>
            <div><span class="text-gray-400">Duration:</span> ${duration}</div>
            <div><span class="text-green-400">Success:</span> ${s.success}</div>
            <div><span class="text-red-400">Failed:</span> ${s.failed}</div>
            <div><span class="text-blue-400">Skipped:</span> ${s.skipped || 0}</div>
          </div>
        `;
        resultEl.classList.remove('hidden');

        const skippedMsg = s.skipped ? `, ${s.skipped} skipped` : '';
        showToast(
          `Image refetch ${s.stoppedEarly ? 'stopped' : 'completed'}: ${s.success} updated, ${s.failed} failed${skippedMsg}`,
          s.stoppedEarly ? 'warning' : 'success'
        );

        // Reload stats
        await loadAlbumImageStats();
      }
    } catch (error) {
      console.error('Error refetching album images:', error);
      showToast(error.data?.error || 'Failed to refetch images', 'error');
    } finally {
      refetchBtn.disabled = false;
      refetchBtn.textContent = 'Refetch Images';
      updateImageRefetchUI(false);
    }
  }

  /**
   * Handle stop refetch images button
   */
  async function handleStopRefetchImages() {
    const stopBtn = document.getElementById('stopRefetchImagesBtn');

    try {
      stopBtn.disabled = true;
      stopBtn.textContent = 'Stopping...';

      const response = await apiCall('/api/admin/images/stop', {
        method: 'POST',
      });

      if (response.success) {
        showToast('Image refetch stopping...', 'info');
      }
    } catch (error) {
      console.error('Error stopping image refetch:', error);
      showToast('Failed to stop refetch', 'error');
    } finally {
      stopBtn.disabled = false;
      stopBtn.textContent = 'Stop';
    }
  }

  /**
   * Format duration in seconds to human readable string
   */
  function formatDuration(seconds) {
    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}m ${secs}s`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${mins}m`;
    }
  }

  /**
   * Handle grant admin
   */
  async function handleGrantAdmin(userId) {
    const confirmed = await showConfirmation(
      'Grant Admin Access',
      'Are you sure you want to grant admin access to this user?',
      'This user will have full administrative privileges.',
      'Grant Admin'
    );

    if (!confirmed) return;

    try {
      const response = await apiCall('/admin/make-admin', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });

      if (response.success) {
        showToast('Admin access granted successfully', 'success');

        // Reload admin data
        categoryData.admin = null;
        await loadCategoryData('admin');
      }
    } catch (error) {
      console.error('Error granting admin:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to grant admin access';
      showToast(errorMsg, 'error');
    }
  }

  /**
   * Handle revoke admin
   */
  async function handleRevokeAdmin(userId) {
    const confirmed = await showConfirmation(
      'Revoke Admin Access',
      'Are you sure you want to revoke admin access from this user?',
      'This user will lose all administrative privileges.',
      'Revoke Admin'
    );

    if (!confirmed) return;

    try {
      const response = await apiCall('/admin/revoke-admin', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });

      if (response.success) {
        showToast('Admin access revoked successfully', 'success');

        // Reload admin data
        categoryData.admin = null;
        await loadCategoryData('admin');
      }
    } catch (error) {
      console.error('Error revoking admin:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to revoke admin access';
      showToast(errorMsg, 'error');
    }
  }

  /**
   * Handle view user lists
   */
  async function handleViewUserLists(userId) {
    try {
      const response = await apiCall(`/admin/user-lists/${userId}`);

      if (response.lists) {
        // Create and show user lists modal
        const modal = createUserListsModal(response.lists);
        document.body.appendChild(modal);
        modal.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error fetching user lists:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to fetch user lists';
      showToast(errorMsg, 'error');
    }
  }

  /**
   * Create user lists modal
   */
  function createUserListsModal(lists) {
    const modal = document.createElement('div');
    modal.className = 'settings-modal';
    modal.id = 'userListsModal';
    modal.innerHTML = `
      <div class="settings-modal-backdrop"></div>
      <div class="settings-modal-content" style="max-width: 32rem;">
        <div class="settings-modal-header">
          <h3 class="settings-modal-title">User Lists</h3>
          <button class="settings-modal-close" aria-label="Close">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="settings-modal-body">
          ${
            lists.length === 0
              ? `
            <p class="text-gray-400 text-center py-8">This user has no lists.</p>
          `
              : `
            <div class="space-y-2 max-h-96 overflow-y-auto">
              ${lists
                .map(
                  (list) => `
                <div class="flex items-center justify-between py-2 px-3 bg-gray-800/50 rounded-sm border border-gray-700/50">
                  <div>
                    <div class="text-white font-medium">${list.name || 'Unnamed List'}</div>
                    <div class="text-xs text-gray-400 mt-1">
                      ${list.albumCount || 0} albums
                      ${list.createdAt ? ` • Created ${new Date(list.createdAt).toLocaleDateString()}` : ''}
                    </div>
                  </div>
                </div>
              `
                )
                .join('')}
            </div>
          `
          }
        </div>
        <div class="settings-modal-footer">
          <button id="closeUserListsBtn" class="settings-button">Close</button>
        </div>
      </div>
    `;

    // Attach handlers
    const backdrop = modal.querySelector('.settings-modal-backdrop');
    const closeBtn = modal.querySelector('.settings-modal-close');
    const closeUserListsBtn = modal.querySelector('#closeUserListsBtn');

    const closeModal = () => {
      modal.classList.add('hidden');
      setTimeout(() => {
        document.body.removeChild(modal);
      }, 300);
    };

    backdrop?.addEventListener('click', closeModal);
    closeBtn?.addEventListener('click', closeModal);
    closeUserListsBtn?.addEventListener('click', closeModal);

    return modal;
  }

  /**
   * Handle delete user
   */
  async function handleDeleteUser(userId) {
    const confirmed = await showConfirmation(
      'Delete User',
      'Are you sure you want to delete this user?',
      'This will permanently delete the user and all their data. This action cannot be undone.',
      'Delete User'
    );

    if (!confirmed) return;

    try {
      const response = await apiCall('/admin/delete-user', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });

      if (response.success) {
        showToast('User deleted successfully', 'success');

        // Reload admin data
        categoryData.admin = null;
        await loadCategoryData('admin');
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to delete user';
      showToast(errorMsg, 'error');
    }
  }

  /**
   * Handle confirm aggregate list reveal
   */
  async function handleConfirmAggregateReveal(year) {
    const confirmed = await showConfirmation(
      'Confirm Reveal',
      `Confirm reveal of Aggregate List ${year}?`,
      'This action contributes to revealing the list to everyone.',
      'Confirm Reveal'
    );

    if (!confirmed) return;

    try {
      const response = await apiCall(`/api/aggregate-list/${year}/confirm`, {
        method: 'POST',
      });

      if (response.success) {
        if (response.revealed) {
          showToast(`Aggregate List ${year} has been revealed!`, 'success');
        } else {
          showToast(
            'Confirmation added. Waiting for more confirmations.',
            'success'
          );
        }

        // Reload admin data
        categoryData.admin = null;
        await loadCategoryData('admin');
      }
    } catch (error) {
      console.error('Error confirming aggregate reveal:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to confirm reveal';
      showToast(errorMsg, 'error');
    }
  }

  /**
   * Handle revoke aggregate list confirmation
   */
  async function handleRevokeAggregateConfirm(year) {
    const confirmed = await showConfirmation(
      'Revoke Confirmation',
      'Are you sure you want to revoke your confirmation?',
      'This will remove your confirmation for revealing the aggregate list.',
      'Revoke'
    );

    if (!confirmed) return;

    try {
      const response = await apiCall(`/api/aggregate-list/${year}/confirm`, {
        method: 'DELETE',
      });

      if (response.success) {
        showToast('Confirmation revoked', 'success');

        // Reload admin data
        categoryData.admin = null;
        await loadCategoryData('admin');
      }
    } catch (error) {
      console.error('Error revoking aggregate confirm:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to revoke confirmation';
      showToast(errorMsg, 'error');
    }
  }

  /**
   * Handle reset aggregate reveal experience
   */
  async function handleResetAggregateReveal(year) {
    const confirmed = await showConfirmation(
      'Reset Reveal Experience',
      `Reset your reveal experience for ${year}?`,
      'You will see the dramatic burning reveal again when you visit the aggregate list page.',
      'Reset Reveal'
    );

    if (!confirmed) return;

    try {
      const response = await apiCall(`/api/aggregate-list/${year}/reset-seen`, {
        method: 'DELETE',
      });

      if (response.success) {
        if (response.deleted) {
          showToast(
            `Reveal experience reset for ${year}. Visit the aggregate list page to see the dramatic reveal!`,
            'success'
          );
        } else {
          showToast(
            `No view record found for ${year} - you haven't seen the reveal yet.`,
            'info'
          );
        }
      }
    } catch (error) {
      console.error('Error resetting aggregate reveal:', error);
      const errorMsg =
        error.data?.error ||
        error.message ||
        'Failed to reset reveal experience';
      showToast(errorMsg, 'error');
    }
  }

  /**
   * Handle toggle year lock
   */
  async function handleToggleYearLock(year, isCurrentlyLocked) {
    const action = isCurrentlyLocked ? 'unlock' : 'lock';
    const confirmed = await showConfirmation(
      `${action === 'lock' ? 'Lock' : 'Unlock'} Year ${year}`,
      `Are you sure you want to ${action} year ${year}?`,
      action === 'lock'
        ? 'This will prevent all users (including admins) from creating or editing lists for this year.'
        : 'This will allow users to create and edit lists for this year again.',
      action === 'lock' ? 'Lock Year' : 'Unlock Year'
    );

    if (!confirmed) return;

    try {
      const response = await apiCall(`/api/aggregate-list/${year}/${action}`, {
        method: 'POST',
      });

      if (response.success) {
        showToast(`Year ${year} has been ${action}ed successfully`, 'success');

        // Partial update: Update just this year's status without collapsing
        await updateSingleYearLockStatus(year, !isCurrentlyLocked);

        // Notify main app to refresh locked year status
        if (window.refreshLockedYearStatus) {
          await window.refreshLockedYearStatus(year);
        }
      }
    } catch (error) {
      console.error(`Error ${action}ing year:`, error);
      const errorMsg =
        error.data?.error || error.message || `Failed to ${action} year`;
      showToast(errorMsg, 'error');
    }
  }

  /**
   * Update the lock status for a single year without reloading the entire admin section
   * @param {number} year - Year to update
   * @param {boolean} newLockStatus - New lock status (true = locked, false = unlocked)
   */
  async function updateSingleYearLockStatus(year, newLockStatus) {
    // Find the lock button for this year
    const lockButton = document.querySelector(
      `.aggregate-toggle-lock[data-year="${year}"]`
    );
    if (!lockButton) return;

    // Update button content entirely to avoid text duplication
    const buttonText = newLockStatus ? 'Unlock Year' : 'Lock Year';
    const iconClass = newLockStatus ? 'unlock' : 'lock';
    lockButton.innerHTML = `<i class="fas fa-${iconClass} mr-2"></i>${buttonText}`;
    lockButton.dataset.locked = newLockStatus;

    // Update lock icon in year header
    const yearHeader = document.querySelector(
      `.aggregate-year-toggle[data-year="${year}"]`
    );
    if (yearHeader) {
      const existingLockIcon = yearHeader.querySelector('.fa-lock');
      if (newLockStatus && !existingLockIcon) {
        // Add lock icon
        const lockIcon = document.createElement('i');
        lockIcon.className = 'fas fa-lock text-yellow-500 ml-2';
        yearHeader.appendChild(lockIcon);
      } else if (!newLockStatus && existingLockIcon) {
        // Remove lock icon
        existingLockIcon.remove();
      }
    }

    // Update Manage Contributors button
    const contributorsButton = document.querySelector(
      `.aggregate-manage-contributors[data-year="${year}"]`
    );
    const disabledContributorsButton = document.querySelector(
      `button[disabled][data-year="${year}"][title*="Unlock"]`
    );

    if (newLockStatus) {
      // Lock engaged: Disable contributors button
      if (contributorsButton) {
        const newButton = document.createElement('button');
        newButton.className =
          'settings-button opacity-50 cursor-not-allowed';
        newButton.disabled = true;
        newButton.dataset.year = year;
        newButton.title = 'Unlock the year to manage contributors';
        newButton.innerHTML = `
          <i class="fas fa-users mr-2"></i>Manage Contributors
          <i class="fas fa-lock text-yellow-500 ml-2 text-xs"></i>
        `;
        contributorsButton.replaceWith(newButton);
      }
    } else {
      // Lock removed: Enable contributors button
      if (disabledContributorsButton) {
        const newButton = document.createElement('button');
        newButton.className = 'settings-button aggregate-manage-contributors';
        newButton.dataset.year = year;
        newButton.innerHTML = `
          <i class="fas fa-users mr-2"></i>Manage Contributors
        `;
        // Re-attach event listener
        newButton.addEventListener('click', async () => {
          await handleShowContributorManager(year);
        });
        disabledContributorsButton.replaceWith(newButton);
      }
    }

    // Update cached data if available
    if (categoryData.admin?.aggregateStatus) {
      const statusIndex = categoryData.admin.aggregateStatus.findIndex(
        (s) => s.year === year
      );
      if (statusIndex !== -1) {
        categoryData.admin.aggregateStatus[statusIndex].locked = newLockStatus;
      }
    }
  }

  /**
   * Handle recompute aggregate list
   */
  async function handleRecomputeAggregateList(year) {
    const confirmed = await showConfirmation(
      'Recompute Aggregate List',
      `Recompute aggregate list for ${year}?`,
      'This will recalculate the aggregate list based on current contributor data.',
      'Recompute'
    );

    if (!confirmed) return;

    try {
      const response = await apiCall(`/api/aggregate-list/${year}/recompute`, {
        method: 'POST',
      });

      if (response.success) {
        showToast(
          `Aggregate list for ${year} recomputed successfully`,
          'success'
        );

        // Partial update: only update the stats for this year without collapsing the accordion
        if (response.status && categoryData.admin?.aggregateStatus) {
          // Update cached data
          const yearIndex = categoryData.admin.aggregateStatus.findIndex(
            (s) => s.year === year
          );
          if (yearIndex !== -1) {
            categoryData.admin.aggregateStatus[yearIndex] = response.status;
          }

          // Update stats display in the DOM
          const yearContent = document.getElementById(
            `aggregate-year-content-${year}`
          );
          if (yearContent) {
            const stats = response.status.stats;
            const statsGrid = yearContent.querySelector(
              '.grid.grid-cols-2.sm\\:grid-cols-4'
            );
            if (statsGrid && stats) {
              statsGrid.innerHTML = `
                <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
                  <div class="font-bold text-white text-lg">${stats.participantCount || 0}</div>
                  <div class="text-xs text-gray-400 uppercase">Contributors</div>
                </div>
                <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
                  <div class="font-bold text-white text-lg">${stats.totalAlbums || 0}</div>
                  <div class="text-xs text-gray-400 uppercase">Albums</div>
                </div>
                <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
                  <div class="font-bold text-white text-lg">${stats.albumsWith3PlusVoters || 0}</div>
                  <div class="text-xs text-gray-400 uppercase">3+ Votes</div>
                </div>
                <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
                  <div class="font-bold text-white text-lg">${stats.albumsWith2Voters || 0}</div>
                  <div class="text-xs text-gray-400 uppercase">2 Votes</div>
                </div>
              `;
            }
          }
        }
      }
    } catch (error) {
      console.error('Error recomputing aggregate list:', error);
      const errorMsg =
        error.data?.error ||
        error.message ||
        'Failed to recompute aggregate list';
      showToast(errorMsg, 'error');
    }
  }

  /**
   * Handle audit aggregate list data integrity
   */
  async function handleAuditAggregateList(year) {
    try {
      showToast('Running audit...', 'info');

      // Fetch both the regular audit and the diagnostic in parallel
      const [auditResponse, diagnosticResponse] = await Promise.all([
        apiCall(`/api/admin/aggregate-audit/${year}`),
        apiCall(`/api/admin/aggregate-audit/${year}/diagnose`),
      ]);

      if (!auditResponse) {
        showToast('Failed to run audit', 'error');
        return;
      }

      // Create and show the audit results modal with diagnostic data
      await showAuditResultsModal(year, auditResponse, diagnosticResponse);
    } catch (error) {
      console.error('Error auditing aggregate list:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to run audit';
      showToast(errorMsg, 'error');
    }
  }

  /**
   * Show audit results in a modal
   * @param {number} year - The year being audited
   * @param {Object} auditData - Regular audit data with duplicates
   * @param {Object} diagnosticData - Diagnostic data with overlap stats
   */
  async function showAuditResultsModal(year, auditData, diagnosticData = null) {
    const modal = document.createElement('div');
    modal.className = 'settings-modal';
    modal.id = `audit-modal-${year}`;

    const { summary, duplicates } = auditData;
    const hasDuplicates = duplicates && duplicates.length > 0;

    // Extract overlap stats from diagnostic if available
    const overlapStats = diagnosticData?.overlapStats || null;
    const missedByBasic = diagnosticData?.missedByBasic || [];

    // Build overlap stats HTML if diagnostic data available (NO album details disclosed)
    const overlapHtml = overlapStats
      ? `
          <!-- Overlap Statistics Section -->
          <div class="bg-gray-800/50 rounded-lg p-4 mb-4">
            <h4 class="text-white font-semibold mb-3">
              <i class="fas fa-layer-group mr-2 text-purple-400"></i>Overlap Statistics
            </h4>
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span class="text-gray-400">Albums on 1 list only:</span>
                <span class="text-white ml-2">${overlapStats.distribution.appearsOn1List}</span>
              </div>
              <div>
                <span class="text-gray-400">Albums on 2+ lists:</span>
                <span class="text-green-400 ml-2">${overlapStats.distribution.appearsOn2PlusLists}</span>
              </div>
              <div>
                <span class="text-gray-400">Albums on 3+ lists:</span>
                <span class="text-green-400 ml-2">${overlapStats.distribution.appearsOn3PlusLists}</span>
              </div>
              <div>
                <span class="text-gray-400">Albums on 5+ lists:</span>
                <span class="text-green-400 ml-2">${overlapStats.distribution.appearsOn5PlusLists}</span>
              </div>
            </div>
          </div>
        `
      : '';

    // Build smart normalization indicator (NO album details disclosed)
    const missedHtml =
      missedByBasic.length > 0
        ? `
          <!-- Normalization Improvements Section -->
          <div class="bg-green-900/20 border border-green-800 rounded-lg p-4 mb-4">
            <h4 class="text-green-400 font-semibold mb-2">
              <i class="fas fa-magic mr-2"></i>Smart Normalization Active
            </h4>
            <p class="text-gray-400 text-sm">
              ${missedByBasic.length} album(s) with variant names (e.g., deluxe editions, remastered versions) 
              were correctly merged that would have been counted separately with basic matching.
            </p>
          </div>
        `
        : '';

    modal.innerHTML = `
      <div class="settings-modal-backdrop"></div>
      <div class="settings-modal-content" style="max-width: 700px; max-height: 80vh;">
        <div class="settings-modal-header">
          <h3 class="settings-modal-title">
            <i class="fas fa-search mr-2"></i>Data Audit Results - ${year}
          </h3>
          <button class="settings-modal-close" aria-label="Close">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="settings-modal-body" style="max-height: 60vh; overflow-y: auto;">
          <!-- Summary Section -->
          <div class="bg-gray-800/50 rounded-lg p-4 mb-4">
            <h4 class="text-white font-semibold mb-3">
              <i class="fas fa-chart-bar mr-2 text-blue-400"></i>Summary
            </h4>
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span class="text-gray-400">Total List Entries:</span>
                <span class="text-white ml-2">${summary.totalAlbumsScanned}</span>
              </div>
              <div>
                <span class="text-gray-400">Unique Albums:</span>
                <span class="text-white ml-2">${summary.uniqueAlbums}</span>
              </div>
              <div>
                <span class="text-gray-400">Albums with Multiple IDs:</span>
                <span class="${summary.albumsWithMultipleIds > 0 ? 'text-yellow-400' : 'text-green-400'} ml-2">${summary.albumsWithMultipleIds}</span>
              </div>
              <div>
                <span class="text-gray-400">Changes Needed:</span>
                <span class="${summary.totalChangesNeeded > 0 ? 'text-yellow-400' : 'text-green-400'} ml-2">${summary.totalChangesNeeded}</span>
              </div>
            </div>
          </div>

          ${overlapHtml}
          ${missedHtml}

          ${
            hasDuplicates
              ? `
          <!-- Duplicates Section (no album details) -->
          <div class="bg-yellow-900/20 border border-yellow-800 rounded-lg p-4 mb-4">
            <h4 class="text-yellow-400 font-semibold mb-2">
              <i class="fas fa-exclamation-triangle mr-2"></i>Albums with Different IDs
            </h4>
            <p class="text-gray-400 text-sm">
              ${duplicates.length} album(s) were added from different sources (MusicBrainz, Spotify, manual entry) 
              but represent the same album. The aggregation system groups them correctly, but you can optionally 
              normalize the IDs for cleaner data.
            </p>
          </div>
          `
              : `
          <!-- All Good Section -->
          <div class="text-center py-8">
            <i class="fas fa-check-circle text-green-500 text-4xl mb-3"></i>
            <p class="text-white font-medium">All Clear!</p>
            <p class="text-gray-400 text-sm mt-1">No data integrity issues found for ${year}.</p>
          </div>
          `
          }
        </div>
        <div class="settings-modal-footer">
          <button id="closeAuditBtn-${year}" class="settings-button">Close</button>
          ${
            hasDuplicates && summary.totalChangesNeeded > 0
              ? `
          <button id="previewFixBtn-${year}" class="settings-button">
            <i class="fas fa-eye mr-2"></i>Preview Fix
          </button>
          <button id="applyFixBtn-${year}" class="settings-button settings-button-danger">
            <i class="fas fa-wrench mr-2"></i>Apply Fix
          </button>
          `
              : ''
          }
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Attach close handlers
    const backdrop = modal.querySelector('.settings-modal-backdrop');
    const closeBtn = modal.querySelector('.settings-modal-close');
    const closeAuditBtn = modal.querySelector(`#closeAuditBtn-${year}`);
    const previewFixBtn = modal.querySelector(`#previewFixBtn-${year}`);
    const applyFixBtn = modal.querySelector(`#applyFixBtn-${year}`);

    const closeModal = () => {
      modal.classList.add('hidden');
      setTimeout(() => {
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
      }, 300);
    };

    backdrop.addEventListener('click', closeModal);
    closeBtn.addEventListener('click', closeModal);
    closeAuditBtn.addEventListener('click', closeModal);

    if (previewFixBtn) {
      previewFixBtn.addEventListener('click', async () => {
        try {
          previewFixBtn.disabled = true;
          previewFixBtn.innerHTML =
            '<i class="fas fa-spinner fa-spin mr-2"></i>Loading...';

          const preview = await apiCall(
            `/api/admin/aggregate-audit/${year}/preview`
          );

          if (preview.changesRequired) {
            // Show summary only, no album details
            showToast(
              `${preview.totalChanges} entries across ${preview.changes.length} albums would be normalized`,
              'info'
            );
          } else {
            showToast('No changes needed', 'success');
          }
        } catch (error) {
          console.error('Error previewing fix:', error);
          showToast('Failed to preview fix', 'error');
        } finally {
          previewFixBtn.disabled = false;
          previewFixBtn.innerHTML =
            '<i class="fas fa-eye mr-2"></i>Preview Fix';
        }
      });
    }

    if (applyFixBtn) {
      applyFixBtn.addEventListener('click', async () => {
        const confirmed = await showConfirmation(
          'Apply Data Fix',
          `Apply data integrity fix for ${year}?`,
          'This will normalize album IDs to their canonical values. This action cannot be undone.',
          'Apply Fix'
        );

        if (!confirmed) return;

        try {
          applyFixBtn.disabled = true;
          applyFixBtn.innerHTML =
            '<i class="fas fa-spinner fa-spin mr-2"></i>Applying...';

          const result = await apiCall(
            `/api/admin/aggregate-audit/${year}/fix`,
            {
              method: 'POST',
              body: JSON.stringify({ confirm: true }),
            }
          );

          if (result.success) {
            showToast(
              `Applied ${result.changesApplied} changes successfully`,
              'success'
            );
            closeModal();

            // Reload admin data
            categoryData.admin = null;
            await loadCategoryData('admin');
          }
        } catch (error) {
          console.error('Error applying fix:', error);
          showToast('Failed to apply fix', 'error');
        } finally {
          applyFixBtn.disabled = false;
          applyFixBtn.innerHTML = '<i class="fas fa-wrench mr-2"></i>Apply Fix';
        }
      });
    }

    // Handle escape key
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  }

  /**
   * Escape HTML to prevent XSS
   * Currently unused after removing album details from audit modal,
   * but kept for potential future use.
   */
  function _escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Handle show contributor manager
   */
  /**
   * Create contributor management modal
   */
  async function createContributorModal(year) {
    const modal = document.createElement('div');
    modal.className = 'settings-modal hidden';
    modal.id = `contributor-modal-${year}`;
    modal.innerHTML = `
      <div class="settings-modal-backdrop"></div>
      <div class="settings-modal-content" style="max-width: 600px;">
        <div class="settings-modal-header">
          <h3 class="settings-modal-title">
            <i class="fas fa-users mr-2"></i>Manage Contributors - ${year}
          </h3>
          <button class="settings-modal-close" aria-label="Close">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="settings-modal-body">
          <div class="text-center py-4">
            <i class="fas fa-spinner fa-spin text-gray-500"></i>
            <p class="text-gray-400 mt-2">Loading eligible users...</p>
          </div>
        </div>
        <div class="settings-modal-footer">
          <button id="cancelContributorBtn-${year}" class="settings-button">Cancel</button>
          <button id="saveContributorBtn-${year}" class="settings-button" disabled>Save Changes</button>
        </div>
      </div>
    `;

    // Attach close handlers
    const backdrop = modal.querySelector('.settings-modal-backdrop');
    const closeBtn = modal.querySelector('.settings-modal-close');
    const cancelBtn = modal.querySelector(`#cancelContributorBtn-${year}`);
    const saveBtn = modal.querySelector(`#saveContributorBtn-${year}`);

    // Track original state and current state
    const originalState = new Map();
    const currentState = new Map();

    const closeModal = () => {
      modal.classList.add('hidden');
      setTimeout(() => {
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
      }, 300);
    };

    backdrop?.addEventListener('click', closeModal);
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);

    // Load eligible users
    try {
      const response = await apiCall(
        `/api/aggregate-list/${year}/eligible-users`
      );
      const body = modal.querySelector('.settings-modal-body');

      if (!response.eligibleUsers || response.eligibleUsers.length === 0) {
        body.innerHTML =
          '<p class="text-gray-500 text-sm text-center py-4">No users have main lists for this year.</p>';
        saveBtn.disabled = true;
        return modal;
      }

      const eligibleUsers = response.eligibleUsers;
      const initialContributorCount = eligibleUsers.filter(
        (u) => u.is_contributor
      ).length;

      // Store original state
      eligibleUsers.forEach((user) => {
        originalState.set(user.user_id, user.is_contributor);
        currentState.set(user.user_id, user.is_contributor);
      });

      // Build HTML
      let html = `
        <div class="mb-4 flex items-center justify-between flex-wrap gap-2">
          <span class="text-sm text-gray-400">
            <i class="fas fa-users mr-1"></i>
            <span id="contributor-count-${year}">${initialContributorCount}</span> of ${eligibleUsers.length} users selected as contributors
          </span>
          <div class="flex gap-2">
            <button id="selectAllBtn-${year}" class="settings-button" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;">Select All</button>
            <button id="deselectAllBtn-${year}" class="settings-button" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;">Deselect All</button>
          </div>
        </div>
        <div class="space-y-2 max-h-96 overflow-y-auto" id="user-list-${year}">
      `;

      eligibleUsers.forEach((user) => {
        const isChecked = user.is_contributor ? 'checked' : '';
        html += `
          <label class="flex items-center gap-3 p-2 bg-gray-900/50 rounded-sm cursor-pointer hover:bg-gray-800/50 transition border border-gray-700/50">
            <input type="checkbox" 
                   class="contributor-checkbox w-5 h-5 rounded-sm border-gray-600 bg-gray-800 text-purple-600 focus:ring-purple-500 focus:ring-offset-gray-900"
                   data-user-id="${user.user_id}" 
                   ${isChecked}>
            <div class="flex-1 min-w-0">
              <span class="text-white font-medium">${user.username || 'Unknown'}</span>
              <span class="text-gray-500 text-sm ml-2">(${user.album_count || 0} albums)</span>
            </div>
            <span class="text-xs text-gray-600 truncate max-w-[150px]">${user.list_name || ''}</span>
          </label>
        `;
      });

      html += '</div>';
      body.innerHTML = html;

      // Update contributor count function
      const updateCount = () => {
        const checkedCount = Array.from(currentState.values()).filter(
          (v) => v
        ).length;
        const countEl = document.getElementById(`contributor-count-${year}`);
        if (countEl) {
          countEl.textContent = checkedCount;
        }
        // Enable save button if there are changes
        const hasChanges = Array.from(originalState.entries()).some(
          ([userId, originalValue]) =>
            currentState.get(userId) !== originalValue
        );
        saveBtn.disabled = !hasChanges;
        saveBtn.textContent = hasChanges ? 'Save Changes' : 'No Changes';
      };

      // Attach checkbox handlers (local state only, no API calls)
      body.querySelectorAll('.contributor-checkbox').forEach((checkbox) => {
        checkbox.addEventListener('change', (e) => {
          const userId = e.target.dataset.userId;
          const isChecked = e.target.checked;
          currentState.set(userId, isChecked);
          updateCount();
        });
      });

      // Attach select all handler
      const selectAllBtn = body.querySelector(`#selectAllBtn-${year}`);
      if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
          body.querySelectorAll('.contributor-checkbox').forEach((checkbox) => {
            const userId = checkbox.dataset.userId;
            checkbox.checked = true;
            currentState.set(userId, true);
          });
          updateCount();
        });
      }

      // Attach deselect all handler
      const deselectAllBtn = body.querySelector(`#deselectAllBtn-${year}`);
      if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => {
          body.querySelectorAll('.contributor-checkbox').forEach((checkbox) => {
            const userId = checkbox.dataset.userId;
            checkbox.checked = false;
            currentState.set(userId, false);
          });
          updateCount();
        });
      }

      // Initial count update
      updateCount();

      // Save handler - batch all changes
      saveBtn.addEventListener('click', async () => {
        const hasChanges = Array.from(originalState.entries()).some(
          ([userId, originalValue]) =>
            currentState.get(userId) !== originalValue
        );

        if (!hasChanges) {
          showToast('No changes to save', 'info');
          return;
        }

        // Get final list of contributor user IDs
        const finalContributorIds = Array.from(currentState.entries())
          .filter(([_, isContributor]) => isContributor)
          .map(([userId, _]) => userId);

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
          const response = await apiCall(
            `/api/aggregate-list/${year}/contributors`,
            {
              method: 'PUT',
              body: JSON.stringify({ userIds: finalContributorIds }),
            }
          );

          if (response.success) {
            showToast(
              `Updated ${finalContributorIds.length} contributor${finalContributorIds.length !== 1 ? 's' : ''}`,
              'success'
            );

            // Reload admin data to refresh stats
            categoryData.admin = null;
            await loadCategoryData('admin');

            closeModal();
          } else {
            throw new Error(response.error || 'Failed to save contributors');
          }
        } catch (error) {
          console.error('Error saving contributors:', error);
          const errorMsg =
            error.data?.error || error.message || 'Failed to save contributors';
          showToast(errorMsg, 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Changes';
        }
      });
    } catch (error) {
      console.error('Error loading contributor manager:', error);
      const body = modal.querySelector('.settings-modal-body');
      body.innerHTML =
        '<p class="text-red-400 text-sm text-center py-4">Error loading users. Please try again.</p>';
      saveBtn.disabled = true;
    }

    return modal;
  }

  /**
   * Handle show contributor manager (opens modal)
   */
  async function handleShowContributorManager(year) {
    // Create and show modal
    const modal = await createContributorModal(year);
    document.body.appendChild(modal);

    // Trigger animation
    setTimeout(() => {
      modal.classList.remove('hidden');
    }, 10);
  }

  /**
   * Handle toggle contributor
   */
  async function _handleToggleContributor(
    year,
    userId,
    isContributor,
    checkbox
  ) {
    try {
      let response;
      if (isContributor) {
        response = await apiCall(`/api/aggregate-list/${year}/contributors`, {
          method: 'POST',
          body: JSON.stringify({ userId }),
        });
      } else {
        response = await apiCall(
          `/api/aggregate-list/${year}/contributors/${userId}`,
          {
            method: 'DELETE',
          }
        );
      }

      if (response.success) {
        // Update contributor count
        updateContributorCount(year);
        // Reload admin data to refresh stats
        categoryData.admin = null;
        await loadCategoryData('admin');
      } else {
        throw new Error(response.error || 'Failed to update contributor');
      }
    } catch (error) {
      console.error('Error toggling contributor:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to update contributor';
      showToast(errorMsg, 'error');
      // Revert checkbox
      if (checkbox) {
        checkbox.checked = !isContributor;
      }
    }
  }

  /**
   * Update contributor count display
   */
  function updateContributorCount(year) {
    const checkboxes = document.querySelectorAll(
      `input.contributor-checkbox[data-year="${year}"]:checked`
    );
    const countEl = document.getElementById(`contributor-count-${year}`);
    if (countEl) {
      countEl.textContent = checkboxes.length;
    }
  }

  /**
   * Handle select all contributors
   */
  async function _handleSelectAllContributors(year) {
    const checkboxes = document.querySelectorAll(
      `input.contributor-checkbox[data-year="${year}"]`
    );
    const userIds = Array.from(checkboxes).map((cb) => cb.dataset.userId);

    try {
      const response = await apiCall(
        `/api/aggregate-list/${year}/contributors`,
        {
          method: 'PUT',
          body: JSON.stringify({ userIds }),
        }
      );

      if (response.success) {
        checkboxes.forEach((cb) => (cb.checked = true));
        updateContributorCount(year);
        showToast(
          `All ${userIds.length} users selected as contributors`,
          'success'
        );

        // Reload admin data
        categoryData.admin = null;
        await loadCategoryData('admin');
      } else {
        throw new Error(response.error || 'Failed to select all');
      }
    } catch (error) {
      console.error('Error selecting all contributors:', error);
      const errorMsg =
        error.data?.error ||
        error.message ||
        'Failed to select all contributors';
      showToast(errorMsg, 'error');
    }
  }

  /**
   * Handle deselect all contributors
   */
  async function _handleDeselectAllContributors(year) {
    try {
      const response = await apiCall(
        `/api/aggregate-list/${year}/contributors`,
        {
          method: 'PUT',
          body: JSON.stringify({ userIds: [] }),
        }
      );

      if (response.success) {
        const checkboxes = document.querySelectorAll(
          `input.contributor-checkbox[data-year="${year}"]`
        );
        checkboxes.forEach((cb) => (cb.checked = false));
        updateContributorCount(year);
        showToast('All contributors removed', 'success');

        // Reload admin data
        categoryData.admin = null;
        await loadCategoryData('admin');
      } else {
        throw new Error(response.error || 'Failed to deselect all');
      }
    } catch (error) {
      console.error('Error deselecting all contributors:', error);
      const errorMsg =
        error.data?.error ||
        error.message ||
        'Failed to deselect all contributors';
      showToast(errorMsg, 'error');
    }
  }

  /**
   * Initialize the drawer
   */
  function initialize() {
    const drawer = document.getElementById('settingsDrawer');
    if (!drawer) return;

    // Attach nav item click handlers
    document.querySelectorAll('.settings-nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const category = btn.dataset.category;
        // Only allow admin category if user is admin
        if (category === 'admin' && window.currentUser?.role !== 'admin') {
          return;
        }
        switchCategory(category);
      });
    });

    // Attach backdrop click handler
    const backdrop = drawer.querySelector('.settings-drawer-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', closeDrawer);
    }

    // Attach close button handler
    const closeBtn = drawer.querySelector('.settings-drawer-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeDrawer);
    }

    // Attach Escape key handler
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        closeDrawer();
      }
    });

    // Add swipe-to-close gesture support for mobile
    const panel = drawer.querySelector('.settings-drawer-panel');
    if (panel) {
      let touchStartX = null;
      let touchStartY = null;
      let isSwiping = false;

      panel.addEventListener(
        'touchstart',
        (e) => {
          // Only allow swipe from the left edge or if already dragging
          const touch = e.touches[0];
          touchStartX = touch.clientX;
          touchStartY = touch.clientY;
          isSwiping = false;
        },
        { passive: true }
      );

      panel.addEventListener(
        'touchmove',
        (e) => {
          if (touchStartX === null) return;

          const touch = e.touches[0];
          const deltaX = touch.clientX - touchStartX;
          const deltaY = touch.clientY - touchStartY;

          // Only start swiping if horizontal movement is greater than vertical
          if (
            !isSwiping &&
            Math.abs(deltaX) > Math.abs(deltaY) &&
            Math.abs(deltaX) > 10
          ) {
            isSwiping = true;
          }

          // If swiping left (closing gesture), translate the panel
          if (isSwiping && deltaX < 0) {
            const translateX = Math.max(deltaX, -panel.offsetWidth);
            panel.style.transform = `translateX(${translateX}px)`;
            // Add opacity to backdrop based on swipe progress
            const backdrop = drawer.querySelector('.settings-drawer-backdrop');
            if (backdrop) {
              const progress = Math.abs(translateX) / panel.offsetWidth;
              backdrop.style.opacity = String(1 - progress * 0.5);
            }
          }
        },
        { passive: true }
      );

      panel.addEventListener(
        'touchend',
        (e) => {
          if (!isSwiping || touchStartX === null) {
            touchStartX = null;
            touchStartY = null;
            isSwiping = false;
            return;
          }

          const touch = e.changedTouches[0];
          const deltaX = touch.clientX - touchStartX;
          const swipeThreshold = panel.offsetWidth * 0.3; // 30% of panel width

          // If swiped left enough, close the drawer
          if (deltaX < -swipeThreshold) {
            closeDrawer();
          } else {
            // Otherwise, snap back to open position
            panel.style.transform = '';
            const backdrop = drawer.querySelector('.settings-drawer-backdrop');
            if (backdrop) {
              backdrop.style.opacity = '';
            }
          }

          touchStartX = null;
          touchStartY = null;
          isSwiping = false;
        },
        { passive: true }
      );

      // Reset transform on transition end (when drawer closes normally)
      panel.addEventListener('transitionend', () => {
        if (!isOpen) {
          panel.style.transform = '';
          const backdrop = drawer.querySelector('.settings-drawer-backdrop');
          if (backdrop) {
            backdrop.style.opacity = '';
          }
        }
      });
    }
  }

  return {
    openDrawer,
    closeDrawer,
    switchCategory,
    initialize,
  };
}
