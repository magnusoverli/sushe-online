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
import { createSettingsModal as createSettingsModalBase } from './ui-factories.js';
import {
  getToggleableColumns,
  isColumnVisible,
  toggleColumn as toggleColumnVisibility,
} from './column-config.js';
import { createSettingsDataLoaders } from './settings-drawer/data-loaders.js';
import { createSettingsCoreRenderers } from './settings-drawer/renderers/core-renderers.js';
import { createSettingsPreferencesRenderer } from './settings-drawer/renderers/preferences-renderer.js';
import { createSettingsAdminRenderer } from './settings-drawer/renderers/admin-renderer.js';
import { createSettingsAccountActions } from './settings-drawer/handlers/account-actions.js';
import { createSettingsPreferenceActions } from './settings-drawer/handlers/preference-actions.js';
import { createSettingsTelegramActions } from './settings-drawer/handlers/telegram-actions.js';
import { createSettingsCoreHandlers } from './settings-drawer/handlers/core-handlers.js';
import { createSettingsAuditHandlers } from './settings-drawer/handlers/audit-handlers.js';
import { createSettingsAdminHandlers } from './settings-drawer/handlers/admin-handlers.js';

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
  const categoryScrollPositions = {};
  let isOpen = false;

  const {
    loadAccountData,
    loadIntegrationsData,
    loadVisualData,
    loadPreferencesData,
    loadStatsData,
    loadAdminData,
  } = createSettingsDataLoaders({ apiCall });

  const {
    renderAccountCategory,
    renderIntegrationsCategory,
    renderVisualCategory,
    renderStatsCategory,
  } = createSettingsCoreRenderers({
    categoryData,
    getToggleableColumns,
    isColumnVisible,
  });

  const { renderPreferencesCategory } = createSettingsPreferencesRenderer();
  const { renderAdminCategory } = createSettingsAdminRenderer();

  const accountHandlerBinding = {
    attach: () => {},
  };

  const {
    handleEditEmail,
    handleSaveEmail,
    handleCancelEmail,
    handleChangePassword,
    handleEditUsername,
    handleSaveUsername,
    handleCancelUsername,
    handleRequestAdmin,
  } = createSettingsAccountActions({
    categoryData,
    renderCategoryContent,
    reattachAccountHandlers: () => {
      accountHandlerBinding.attach();
    },
    showToast,
    showConfirmation,
    apiCall,
    loadCategoryData,
    createSettingsModalBase,
  });

  const {
    handleDisconnect,
    handleMusicServiceChange,
    handleSyncPreferences,
    handleSetTimeRange,
    handleAccentColorChange,
    handleTimeFormatChange,
    handleDateFormatChange,
  } = createSettingsPreferenceActions({
    categoryData,
    showConfirmation,
    apiCall,
    showToast,
    loadCategoryData,
  });

  const {
    attachActionBarHandlers,
    attachAccountHandlers,
    attachIntegrationsHandlers,
    attachVisualHandlers,
    attachPreferencesHandlers,
    attachStatsHandlers,
  } = createSettingsCoreHandlers({
    apiCall,
    showToast,
    categoryData,
    loadCategoryData,
    handleEditEmail,
    handleSaveEmail,
    handleCancelEmail,
    handleChangePassword,
    handleEditUsername,
    handleSaveUsername,
    handleCancelUsername,
    handleRequestAdmin,
    handleDisconnect,
    handleMusicServiceChange,
    handleAccentColorChange,
    handleTimeFormatChange,
    handleDateFormatChange,
    toggleColumnVisibility,
    handleSyncPreferences,
    handleSetTimeRange,
  });

  accountHandlerBinding.attach = attachAccountHandlers;

  const { handleScanDuplicates, handleAuditManualAlbums } =
    createSettingsAuditHandlers({
      apiCall,
      showToast,
      openDuplicateReviewModal,
      openManualAlbumAudit,
    });

  const {
    handleConfigureTelegram,
    handleDisconnectTelegram,
    handleToggleTelegramRecommendations,
    handleTestTelegramRecommendations,
  } = createSettingsTelegramActions({
    createSettingsModalBase,
    showToast,
    apiCall,
    categoryData,
    loadCategoryData,
    showConfirmation,
  });

  const { attachAdminHandlers } = createSettingsAdminHandlers({
    showConfirmation,
    apiCall,
    showToast,
    loadAlbumSummaryStats,
    pollAlbumSummaryStatus,
    getAlbumSummaryPollInterval: () => albumSummaryPollInterval,
    setAlbumSummaryPollInterval: (value) => {
      albumSummaryPollInterval = value;
    },
    loadAlbumImageStats,
    handleAdminEventAction,
    handleConfigureTelegram,
    handleDisconnectTelegram,
    handleToggleTelegramRecommendations,
    handleTestTelegramRecommendations,
    handleRestoreDatabase,
    handleGrantAdmin,
    handleRevokeAdmin,
    handleViewUserLists,
    handleDeleteUser,
    handleConfirmAggregateReveal,
    handleRevokeAggregateConfirm,
    handleResetAggregateReveal,
    handleRecomputeAggregateList,
    handleAuditAggregateList,
    handleShowContributorManager,
    handleToggleYearLock,
    handleToggleRecommendationLock,
    handleShowRecommenderManager,
    handleFetchAlbumSummaries,
    handleStopAlbumSummaries,
    handleRefetchAlbumImages,
    handleStopRefetchImages,
    handleScanDuplicates,
    handleAuditManualAlbums,
  });

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

    const mainContent = document.querySelector('.settings-drawer-main');
    if (mainContent) {
      categoryScrollPositions[currentCategory] = mainContent.scrollTop;
    }

    // Update active nav item
    document.querySelectorAll('.settings-nav-item').forEach((btn) => {
      btn.classList.remove('active');
      if (btn.dataset.category === categoryId) {
        btn.classList.add('active');
      }
    });

    const activeNavItem = document.querySelector('.settings-nav-item.active');
    if (activeNavItem && window.innerWidth <= 1023) {
      activeNavItem.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }

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

    // Re-trigger fade-in animation by removing and adding animation
    contentEl.style.animation = 'none';
    // Force reflow to ensure animation restart
    void contentEl.offsetHeight;
    contentEl.style.animation = '';

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

    const mainContent = document.querySelector('.settings-drawer-main');
    if (mainContent) {
      const savedPosition = categoryScrollPositions[categoryId];
      mainContent.scrollTop =
        typeof savedPosition === 'number' ? savedPosition : 0;
    }

    // Update bottom action bar for mobile
    updateActionBar(categoryId);
  }

  /**
   * Update the bottom action bar with context-appropriate actions
   * @param {string} categoryId - Current category ID
   */
  function updateActionBar(categoryId) {
    const actionBar = document.getElementById('settingsActionBar');
    if (!actionBar || window.innerWidth >= 1024) return;

    const actions = {
      account:
        '<button class="settings-button" id="actionBarLogout"><i class="fas fa-sign-out-alt mr-2"></i>Log Out</button>',
      integrations:
        '<button class="settings-button" id="actionBarSync"><i class="fas fa-sync-alt mr-2"></i>Sync Services</button>',
      preferences:
        '<button class="settings-button" id="actionBarSyncPrefs"><i class="fas fa-sync-alt mr-2"></i>Sync Now</button>',
      stats:
        '<button class="settings-button" id="actionBarRefresh"><i class="fas fa-redo mr-2"></i>Refresh</button>',
      visual: '', // No primary action needed
      admin: '', // Admin has inline actions
    };

    actionBar.innerHTML = actions[categoryId] || '';

    // Attach handlers for action bar buttons
    attachActionBarHandlers(categoryId);
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
    const { modal, close } = createSettingsModalBase({
      id: 'restoreDatabaseModal',
      title: '<i class="fas fa-upload mr-2 text-red-500"></i>Restore Database',
      bodyHtml: `
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
          </form>`,
      footerHtml: `
          <button id="cancelRestoreBtn" class="settings-button">Cancel</button>
          <button id="confirmRestoreBtn" class="settings-button settings-button-danger" disabled>Restore Database</button>`,
      maxWidth: '500px',
      startHidden: true,
    });

    // Attach handlers
    const cancelBtn = modal.querySelector('#cancelRestoreBtn');
    const confirmBtn = modal.querySelector('#confirmRestoreBtn');
    const form = modal.querySelector('#restoreDatabaseForm');
    const fileInput = modal.querySelector('#backupFileInput');
    const errorEl = modal.querySelector('#restoreError');

    cancelBtn?.addEventListener('click', close);

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

      const result = await apiCall('/admin/restore', {
        method: 'POST',
        body: formData,
      });

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
    const { modal, close } = createSettingsModalBase({
      id: 'userListsModal',
      title: 'User Lists',
      bodyHtml: `
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
          }`,
      footerHtml: `
          <button id="closeUserListsBtn" class="settings-button">Close</button>`,
      maxWidth: '32rem',
    });

    // Attach handlers
    const closeUserListsBtn = modal.querySelector('#closeUserListsBtn');
    closeUserListsBtn?.addEventListener('click', close);

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
   * Handle toggle recommendation lock
   */
  async function handleToggleRecommendationLock(year, isCurrentlyLocked) {
    const action = isCurrentlyLocked ? 'unlock' : 'lock';
    const confirmed = await showConfirmation(
      `${action === 'lock' ? 'Lock' : 'Unlock'} Recommendations for ${year}`,
      `Are you sure you want to ${action} recommendations for ${year}?`,
      action === 'lock'
        ? 'This will prevent users from adding new recommendations for this year.'
        : 'This will allow users to add recommendations for this year again.',
      action === 'lock' ? 'Lock Recommendations' : 'Unlock Recommendations'
    );

    if (!confirmed) return;

    try {
      const response = await apiCall(`/api/recommendations/${year}/${action}`, {
        method: 'POST',
      });

      if (response.success) {
        showToast(
          `Recommendations for ${year} have been ${action}ed successfully`,
          'success'
        );

        // Update the button state
        const lockButton = document.querySelector(
          `.recommendation-toggle-lock[data-year="${year}"]`
        );
        const newLockStatus = !isCurrentlyLocked;
        if (lockButton) {
          const buttonText = newLockStatus
            ? 'Unlock Recommendations'
            : 'Lock Recommendations';
          const iconClass = newLockStatus ? 'unlock' : 'lock';
          lockButton.innerHTML = `<i class="fas fa-thumbs-up mr-2 text-blue-400"></i><i class="fas fa-${iconClass} mr-1"></i>${buttonText}`;
          lockButton.dataset.locked = newLockStatus;
        }

        // Update Manage Recommenders button
        const recommenderButton = document.querySelector(
          `.recommendation-manage-access[data-year="${year}"]`
        );
        const disabledRecommenderButton = document.querySelector(
          `button[disabled][data-year="${year}"][title*="Unlock recommendations"]`
        );

        if (newLockStatus) {
          // Lock engaged: Disable recommenders button
          if (recommenderButton) {
            const newButton = document.createElement('button');
            newButton.className =
              'settings-button opacity-50 cursor-not-allowed';
            newButton.disabled = true;
            newButton.dataset.year = year;
            newButton.title = 'Unlock recommendations to manage recommenders';
            newButton.innerHTML = `
              <i class="fas fa-thumbs-up mr-2 text-blue-400"></i><i class="fas fa-user-check mr-1"></i>Manage Recommenders
              <i class="fas fa-lock text-yellow-500 ml-2 text-xs"></i>
            `;
            recommenderButton.replaceWith(newButton);
          }
        } else {
          // Lock removed: Enable recommenders button
          if (disabledRecommenderButton) {
            const newButton = document.createElement('button');
            newButton.className =
              'settings-button recommendation-manage-access';
            newButton.dataset.year = year;
            newButton.innerHTML = `
              <i class="fas fa-thumbs-up mr-2 text-blue-400"></i><i class="fas fa-user-check mr-1"></i>Manage Recommenders
            `;
            // Re-attach event listener
            newButton.addEventListener('click', async () => {
              await handleShowRecommenderManager(year);
            });
            disabledRecommenderButton.replaceWith(newButton);
          }
        }

        // Invalidate recommendation lock cache
        if (window.invalidateLockedRecommendationYearsCache) {
          window.invalidateLockedRecommendationYearsCache();
        }
      }
    } catch (error) {
      console.error(`Error ${action}ing recommendations:`, error);
      const errorMsg =
        error.data?.error ||
        error.message ||
        `Failed to ${action} recommendations`;
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
        newButton.className = 'settings-button opacity-50 cursor-not-allowed';
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

    const { modal, close } = createSettingsModalBase({
      id: `audit-modal-${year}`,
      title: '<i class="fas fa-search mr-2"></i>Data Audit Results - ' + year,
      bodyHtml: `
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
          }`,
      footerHtml: `
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
          }`,
      maxWidth: '700px',
      maxHeight: '80vh',
      bodyStyle: 'max-height: 60vh; overflow-y: auto;',
      appendToBody: true,
    });

    // Attach handlers
    const closeAuditBtn = modal.querySelector(`#closeAuditBtn-${year}`);
    const previewFixBtn = modal.querySelector(`#previewFixBtn-${year}`);
    const applyFixBtn = modal.querySelector(`#applyFixBtn-${year}`);

    closeAuditBtn?.addEventListener('click', close);

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
            close();

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
        close();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  }

  /**
   * Create contributor management modal
   */
  async function createContributorModal(year) {
    const { modal, close } = createSettingsModalBase({
      id: `contributor-modal-${year}`,
      title: '<i class="fas fa-users mr-2"></i>Manage Contributors - ' + year,
      bodyHtml: `
          <div class="text-center py-4">
            <i class="fas fa-spinner fa-spin text-gray-500"></i>
            <p class="text-gray-400 mt-2">Loading eligible users...</p>
          </div>`,
      footerHtml: `
          <button id="cancelContributorBtn-${year}" class="settings-button">Cancel</button>
          <button id="saveContributorBtn-${year}" class="settings-button" disabled>Save Changes</button>`,
      maxWidth: '600px',
      startHidden: true,
    });

    // Attach handlers
    const cancelBtn = modal.querySelector(`#cancelContributorBtn-${year}`);
    const saveBtn = modal.querySelector(`#saveContributorBtn-${year}`);

    cancelBtn?.addEventListener('click', close);

    // Track original state and current state
    const originalState = new Map();
    const currentState = new Map();

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

            close();
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
   * Create recommender management modal
   */
  async function createRecommenderModal(year) {
    const { modal, close } = createSettingsModalBase({
      id: `recommender-modal-${year}`,
      title:
        '<i class="fas fa-thumbs-up text-blue-400 mr-2"></i>Manage Recommenders - ' +
        year,
      bodyHtml: `
          <div class="text-center py-4">
            <i class="fas fa-spinner fa-spin text-gray-500"></i>
            <p class="text-gray-400 mt-2">Loading users...</p>
          </div>`,
      footerHtml: `
          <button id="cancelRecommenderBtn-${year}" class="settings-button">Cancel</button>
          <button id="saveRecommenderBtn-${year}" class="settings-button" disabled>Save Changes</button>`,
      maxWidth: '600px',
      startHidden: true,
    });

    // Attach handlers
    const cancelBtn = modal.querySelector(`#cancelRecommenderBtn-${year}`);
    const saveBtn = modal.querySelector(`#saveRecommenderBtn-${year}`);

    cancelBtn?.addEventListener('click', close);

    // Track original state and current state
    const originalState = new Map();
    const currentState = new Map();

    // Load users
    try {
      const response = await apiCall(
        `/api/recommendations/${year}/eligible-users`
      );
      const body = modal.querySelector('.settings-modal-body');

      if (!response.users || response.users.length === 0) {
        body.innerHTML =
          '<p class="text-gray-500 text-sm text-center py-4">No approved users found.</p>';
        saveBtn.disabled = true;
        return modal;
      }

      const users = response.users;
      const initialSelectedCount = users.filter((u) => u.has_access).length;

      // Store original state
      users.forEach((user) => {
        originalState.set(user.user_id, user.has_access);
        currentState.set(user.user_id, user.has_access);
      });

      // Build HTML
      let html = `
        <div class="mb-3 p-3 bg-blue-900/30 border border-blue-700/50 rounded-sm">
          <p class="text-sm text-blue-300">
            <i class="fas fa-info-circle mr-1"></i>
            By default, all users can recommend albums. Select specific users below to restrict recommendations to only those users.
          </p>
        </div>
        <div class="mb-4 flex items-center justify-between flex-wrap gap-2">
          <span class="text-sm text-gray-400">
            <i class="fas fa-user-check mr-1"></i>
            <span id="recommender-count-${year}">${initialSelectedCount}</span> of ${users.length} users selected
            ${initialSelectedCount === 0 ? '<span class="text-green-400 ml-1">(all users can recommend)</span>' : '<span class="text-yellow-400 ml-1">(restricted)</span>'}
          </span>
          <div class="flex gap-2">
            <button id="selectAllRecsBtn-${year}" class="settings-button" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;">Select All</button>
            <button id="deselectAllRecsBtn-${year}" class="settings-button" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;">Clear All</button>
          </div>
        </div>
        <div class="space-y-2 max-h-96 overflow-y-auto" id="recommender-list-${year}">
      `;

      users.forEach((user) => {
        const isChecked = user.has_access ? 'checked' : '';
        html += `
          <label class="flex items-center gap-3 p-2 bg-gray-900/50 rounded-sm cursor-pointer hover:bg-gray-800/50 transition border border-gray-700/50">
            <input type="checkbox" 
                   class="recommender-checkbox w-5 h-5 rounded-sm border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-900"
                   data-user-id="${user.user_id}" 
                   ${isChecked}>
            <div class="flex-1 min-w-0">
              <span class="text-white font-medium">${user.username || 'Unknown'}</span>
            </div>
            <span class="text-xs text-gray-600 truncate max-w-[150px]">${user.email || ''}</span>
          </label>
        `;
      });

      html += '</div>';
      body.innerHTML = html;

      // Update count and restriction status function
      const updateCountAndStatus = () => {
        const checkedCount = Array.from(currentState.values()).filter(
          (v) => v
        ).length;
        const countEl = document.getElementById(`recommender-count-${year}`);
        if (countEl) {
          const statusText =
            checkedCount === 0
              ? '<span class="text-green-400 ml-1">(all users can recommend)</span>'
              : '<span class="text-yellow-400 ml-1">(restricted)</span>';
          countEl.parentElement.innerHTML = `
            <i class="fas fa-user-check mr-1"></i>
            <span id="recommender-count-${year}">${checkedCount}</span> of ${users.length} users selected
            ${statusText}
          `;
        }
        // Enable save button if there are changes
        const hasChanges = Array.from(originalState.entries()).some(
          ([userId, originalValue]) =>
            currentState.get(userId) !== originalValue
        );
        saveBtn.disabled = !hasChanges;
        saveBtn.textContent = hasChanges ? 'Save Changes' : 'No Changes';
      };

      // Attach checkbox handlers
      modal.querySelectorAll('.recommender-checkbox').forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
          const userId = checkbox.dataset.userId;
          currentState.set(userId, checkbox.checked);
          updateCountAndStatus();
        });
      });

      // Select All / Deselect All
      const selectAllBtn = modal.querySelector(`#selectAllRecsBtn-${year}`);
      const deselectAllBtn = modal.querySelector(`#deselectAllRecsBtn-${year}`);

      selectAllBtn.addEventListener('click', () => {
        modal.querySelectorAll('.recommender-checkbox').forEach((checkbox) => {
          checkbox.checked = true;
          currentState.set(checkbox.dataset.userId, true);
        });
        updateCountAndStatus();
      });

      deselectAllBtn.addEventListener('click', () => {
        modal.querySelectorAll('.recommender-checkbox').forEach((checkbox) => {
          checkbox.checked = false;
          currentState.set(checkbox.dataset.userId, false);
        });
        updateCountAndStatus();
      });

      // Save button handler
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
          // Get only selected user IDs
          const selectedUserIds = Array.from(currentState.entries())
            .filter(([, isSelected]) => isSelected)
            .map(([userId]) => userId);

          const response = await apiCall(
            `/api/recommendations/${year}/access`,
            {
              method: 'PUT',
              body: JSON.stringify({ userIds: selectedUserIds }),
            }
          );

          if (response.success) {
            showToast(
              selectedUserIds.length === 0
                ? `Recommendations for ${year} are now open to all users`
                : `Recommendation access updated for ${year}`,
              'success'
            );
            close();

            // Reload admin data
            categoryData.admin = null;
            await loadCategoryData('admin');
          } else {
            throw new Error(response.error || 'Failed to save');
          }
        } catch (error) {
          console.error('Error saving recommender access:', error);
          const errorMsg =
            error.data?.error || error.message || 'Failed to save access list';
          showToast(errorMsg, 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Changes';
        }
      });
    } catch (error) {
      console.error('Error loading recommender manager:', error);
      const body = modal.querySelector('.settings-modal-body');
      body.innerHTML =
        '<p class="text-red-400 text-sm text-center py-4">Error loading users. Please try again.</p>';
      saveBtn.disabled = true;
    }

    return modal;
  }

  /**
   * Handle show recommender manager (opens modal)
   */
  async function handleShowRecommenderManager(year) {
    // Create and show modal
    const modal = await createRecommenderModal(year);
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
      let allowSwipe = false;
      const header = panel.querySelector('.settings-drawer-header');
      const swipeEdgeSize = 44;
      const swipeIntentThreshold = 30;
      const swipeIntentRatio = 2;

      const updateSwipeFeedback = (progress) => {
        if (!closeBtn) return;
        closeBtn.style.opacity = String(1 - progress * 0.4);
        closeBtn.style.transform = `scale(${1 - progress * 0.1})`;
      };

      const resetSwipeFeedback = () => {
        if (!closeBtn) return;
        closeBtn.style.opacity = '';
        closeBtn.style.transform = '';
      };

      panel.addEventListener(
        'touchstart',
        (e) => {
          // Track the initial touch position for swipe-to-close
          const touch = e.touches[0];
          touchStartX = touch.clientX;
          touchStartY = touch.clientY;
          isSwiping = false;
          allowSwipe =
            (header && header.contains(e.target)) ||
            touchStartX >= window.innerWidth - swipeEdgeSize;
        },
        { passive: true }
      );

      panel.addEventListener(
        'touchmove',
        (e) => {
          if (touchStartX === null) return;
          if (!allowSwipe) return;

          const touch = e.touches[0];
          const deltaX = touch.clientX - touchStartX;
          const deltaY = touch.clientY - touchStartY;

          // Only start swiping if horizontal movement is greater than vertical
          if (
            !isSwiping &&
            Math.abs(deltaX) > Math.abs(deltaY) * swipeIntentRatio &&
            Math.abs(deltaX) > swipeIntentThreshold
          ) {
            isSwiping = true;
          }

          // If swiping right (closing gesture), translate the panel
          if (isSwiping && deltaX > 0) {
            const translateX = Math.min(deltaX, panel.offsetWidth);
            panel.style.transform = `translateX(${translateX}px)`;
            const progress = translateX / panel.offsetWidth;
            // Add opacity to backdrop based on swipe progress
            const backdrop = drawer.querySelector('.settings-drawer-backdrop');
            if (backdrop) {
              backdrop.style.opacity = String(1 - progress * 0.5);
            }
            updateSwipeFeedback(progress);
          }
        },
        { passive: true }
      );

      panel.addEventListener(
        'touchend',
        (e) => {
          if (!isSwiping || touchStartX === null || !allowSwipe) {
            touchStartX = null;
            touchStartY = null;
            isSwiping = false;
            allowSwipe = false;
            return;
          }

          const touch = e.changedTouches[0];
          const deltaX = touch.clientX - touchStartX;
          const swipeThreshold = panel.offsetWidth * 0.3; // 30% of panel width

          // If swiped right enough, close the drawer
          if (deltaX > swipeThreshold) {
            closeDrawer();
          } else {
            // Otherwise, snap back to open position
            panel.style.transform = '';
            const backdrop = drawer.querySelector('.settings-drawer-backdrop');
            if (backdrop) {
              backdrop.style.opacity = '';
            }
            resetSwipeFeedback();
          }

          touchStartX = null;
          touchStartY = null;
          isSwiping = false;
          allowSwipe = false;
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
          resetSwipeFeedback();
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
