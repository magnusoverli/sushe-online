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
import { createSettingsAdminActions } from './settings-drawer/handlers/admin-actions.js';
import { createSettingsAlbumSummaryActions } from './settings-drawer/handlers/album-summary-actions.js';
import { createSettingsAlbumImageActions } from './settings-drawer/handlers/album-image-actions.js';
import { createSettingsAdminUserActions } from './settings-drawer/handlers/admin-user-actions.js';
import { createSettingsAggregateActions } from './settings-drawer/handlers/aggregate-actions.js';
import { createSettingsContributorManagerActions } from './settings-drawer/handlers/contributor-manager-actions.js';
import { createSettingsRecommenderManagerActions } from './settings-drawer/handlers/recommender-manager-actions.js';
import { createSettingsCoreHandlers } from './settings-drawer/handlers/core-handlers.js';
import { createSettingsAuditHandlers } from './settings-drawer/handlers/audit-handlers.js';
import { createSettingsAdminHandlers } from './settings-drawer/handlers/admin-handlers.js';
import { getCurrentListId } from './app-state.js';

/**
 * Create settings drawer utilities with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Function} deps.showToast - Toast notification function
 * @param {Function} deps.showConfirmation - Modal confirmation function
 * @param {Function} deps.apiCall - API call function
 * @param {Function} deps.refreshLockedYearStatus - Refresh lock UI for one year
 */
export function createSettingsDrawer(deps = {}) {
  const showToast = deps.showToast || (() => {});
  const showConfirmation =
    deps.showConfirmation || (() => Promise.resolve(false));
  const apiCall =
    deps.apiCall || (() => Promise.reject(new Error('apiCall not provided')));
  const refreshLockedYearStatus = deps.refreshLockedYearStatus;

  let currentCategory = 'account';
  const categoryData = {};
  const categoryLoadPromises = {};
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

  const { handleAdminEventAction, handleRestoreDatabase } =
    createSettingsAdminActions({
      showConfirmation,
      apiCall,
      showToast,
      categoryData,
      loadCategoryData,
      createSettingsModalBase,
    });

  const {
    handleGrantAdmin,
    handleRevokeAdmin,
    handleViewUserLists,
    handleDeleteUser,
  } = createSettingsAdminUserActions({
    showConfirmation,
    apiCall,
    showToast,
    categoryData,
    loadCategoryData,
    createSettingsModalBase,
  });

  let albumSummaryPollInterval = null;

  const {
    loadAlbumSummaryStats,
    pollAlbumSummaryStatus,
    handleFetchAlbumSummaries,
    handleStopAlbumSummaries,
    applySummaryStatsPayload,
  } = createSettingsAlbumSummaryActions({
    apiCall,
    showToast,
    categoryData,
    getAlbumSummaryPollInterval: () => albumSummaryPollInterval,
    setAlbumSummaryPollInterval: (value) => {
      albumSummaryPollInterval = value;
    },
  });

  const {
    loadAlbumImageStats,
    handleRefetchAlbumImages,
    handleStopRefetchImages,
    applyImageStatsPayload,
  } = createSettingsAlbumImageActions({
    apiCall,
    showToast,
    showConfirmation,
    categoryData,
  });

  const { handleShowContributorManager } =
    createSettingsContributorManagerActions({
      apiCall,
      showToast,
      categoryData,
      loadCategoryData,
      createSettingsModalBase,
    });

  const { handleShowRecommenderManager } =
    createSettingsRecommenderManagerActions({
      apiCall,
      showToast,
      categoryData,
      loadCategoryData,
      createSettingsModalBase,
    });

  const {
    handleConfirmAggregateReveal,
    handleRevokeAggregateConfirm,
    handleResetAggregateReveal,
    handleToggleYearLock,
    handleToggleRecommendationLock,
    handleRecomputeAggregateList,
    handleAuditAggregateList,
  } = createSettingsAggregateActions({
    showConfirmation,
    apiCall,
    showToast,
    categoryData,
    loadCategoryData,
    handleShowContributorManager,
    handleShowRecommenderManager,
    createSettingsModalBase,
    refreshLockedYearStatus,
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
    applySummaryStatsPayload,
    applyImageStatsPayload,
    categoryData,
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
      void ensureCategoryDataLoaded(currentCategory);
    }

    if (
      window.currentUser?.role === 'admin' &&
      !categoryData.admin &&
      !categoryLoadPromises.admin
    ) {
      void ensureCategoryDataLoaded('admin');
    }
  }

  async function ensureCategoryDataLoaded(categoryId) {
    if (categoryData[categoryId]) {
      return categoryData[categoryId];
    }

    if (!categoryLoadPromises[categoryId]) {
      categoryLoadPromises[categoryId] = loadCategoryData(categoryId).finally(
        () => {
          delete categoryLoadPromises[categoryId];
        }
      );
    }

    await categoryLoadPromises[categoryId];
    return categoryData[categoryId];
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
    const currentList = getCurrentListId();

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
      await ensureCategoryDataLoaded(categoryId);
    }

    renderCategoryContent(categoryId, {
      skipAnimation: categoryId === 'admin',
    });
  }

  /**
   * Load data for a category
   * @param {string} categoryId - Category ID
   */
  async function loadCategoryData(categoryId) {
    const contentEl = document.getElementById('settingsCategoryContent');
    if (!contentEl) return;

    if (categoryId !== 'admin') {
      // Show loading state
      contentEl.innerHTML = `
      <div class="flex items-center justify-center py-12">
        <div class="text-center">
          <i class="fas fa-spinner fa-spin text-2xl text-gray-400 mb-2"></i>
          <p class="text-gray-500">Loading...</p>
        </div>
      </div>
    `;
    }

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

      if (currentCategory === categoryId) {
        renderCategoryContent(categoryId, {
          skipAnimation: categoryId === 'admin',
        });
      }
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
  function renderCategoryContent(categoryId, options = {}) {
    const skipAnimation = options.skipAnimation === true;
    const contentEl = document.getElementById('settingsCategoryContent');
    if (!contentEl) return;

    if (!skipAnimation) {
      // Re-trigger fade-in animation by removing and adding animation
      contentEl.style.animation = 'none';
      // Force reflow to ensure animation restart
      void contentEl.offsetHeight;
      contentEl.style.animation = '';
    }

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
