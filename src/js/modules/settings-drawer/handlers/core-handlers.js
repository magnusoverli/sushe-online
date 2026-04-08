/**
 * Core settings drawer handler wiring.
 *
 * Keeps event listener attachment separate from drawer orchestration.
 */

export function createSettingsCoreHandlers(deps = {}) {
  const doc =
    deps.doc || (typeof document !== 'undefined' ? document : undefined);
  const win =
    deps.win || (typeof window !== 'undefined' ? window : { location: {} });

  const {
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
  } = deps;

  function attachActionBarHandlers(_categoryId) {
    const logoutBtn = doc.getElementById('actionBarLogout');
    const syncBtn = doc.getElementById('actionBarSync');
    const syncPrefsBtn = doc.getElementById('actionBarSyncPrefs');
    const refreshBtn = doc.getElementById('actionBarRefresh');

    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        win.location.href = '/logout';
      });
    }

    if (syncBtn) {
      syncBtn.addEventListener('click', async () => {
        syncBtn.disabled = true;
        syncBtn.innerHTML =
          '<i class="fas fa-spinner fa-spin mr-2"></i>Syncing...';
        try {
          await apiCall('/api/preferences/sync', { method: 'POST' });
          showToast('Services synced successfully');
          delete categoryData.integrations;
          loadCategoryData('integrations');
        } catch (_error) {
          showToast('Failed to sync services', 'error');
        } finally {
          syncBtn.disabled = false;
          syncBtn.innerHTML =
            '<i class="fas fa-sync-alt mr-2"></i>Sync Services';
        }
      });
    }

    if (syncPrefsBtn) {
      syncPrefsBtn.addEventListener('click', async () => {
        syncPrefsBtn.disabled = true;
        syncPrefsBtn.innerHTML =
          '<i class="fas fa-spinner fa-spin mr-2"></i>Syncing...';
        try {
          await apiCall('/api/preferences/sync', { method: 'POST' });
          showToast('Preferences synced successfully');
          delete categoryData.preferences;
          loadCategoryData('preferences');
        } catch (_error) {
          showToast('Failed to sync preferences', 'error');
        } finally {
          syncPrefsBtn.disabled = false;
          syncPrefsBtn.innerHTML =
            '<i class="fas fa-sync-alt mr-2"></i>Sync Now';
        }
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML =
          '<i class="fas fa-spinner fa-spin mr-2"></i>Refreshing...';
        try {
          delete categoryData.stats;
          await loadCategoryData('stats');
          showToast('Stats refreshed');
        } catch (_error) {
          showToast('Failed to refresh stats', 'error');
        } finally {
          refreshBtn.disabled = false;
          refreshBtn.innerHTML = '<i class="fas fa-redo mr-2"></i>Refresh';
        }
      });
    }
  }

  function attachAccountHandlers() {
    const changeEmailBtn = doc.getElementById('changeEmailBtn');
    const saveEmailBtn = doc.getElementById('saveEmailBtn');
    const cancelEmailBtn = doc.getElementById('cancelEmailBtn');
    const changePasswordBtn = doc.getElementById('changePasswordBtn');
    const editUsernameBtn = doc.getElementById('editUsernameBtn');
    const saveUsernameBtn = doc.getElementById('saveUsernameBtn');
    const cancelUsernameBtn = doc.getElementById('cancelUsernameBtn');
    const requestAdminBtn = doc.getElementById('requestAdminBtn');

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

  function attachIntegrationsHandlers() {
    const connectSpotifyBtn = doc.getElementById('connectSpotifyBtn');
    const reauthorizeSpotifyBtn = doc.getElementById('reauthorizeSpotifyBtn');
    const disconnectSpotifyBtn = doc.getElementById('disconnectSpotifyBtn');
    const connectTidalBtn = doc.getElementById('connectTidalBtn');
    const disconnectTidalBtn = doc.getElementById('disconnectTidalBtn');
    const connectLastfmBtn = doc.getElementById('connectLastfmBtn');
    const disconnectLastfmBtn = doc.getElementById('disconnectLastfmBtn');

    if (connectSpotifyBtn) {
      connectSpotifyBtn.addEventListener('click', () => {
        win.location.href = '/auth/spotify';
      });
    }

    if (reauthorizeSpotifyBtn) {
      reauthorizeSpotifyBtn.addEventListener('click', () => {
        win.location.href = '/auth/spotify?force=true';
      });
    }

    if (disconnectSpotifyBtn) {
      disconnectSpotifyBtn.addEventListener('click', () =>
        handleDisconnect('spotify')
      );
    }

    if (connectTidalBtn) {
      connectTidalBtn.addEventListener('click', () => {
        win.location.href = '/auth/tidal';
      });
    }

    if (disconnectTidalBtn) {
      disconnectTidalBtn.addEventListener('click', () =>
        handleDisconnect('tidal')
      );
    }

    if (connectLastfmBtn) {
      connectLastfmBtn.addEventListener('click', () => {
        win.location.href = '/auth/lastfm';
      });
    }

    if (disconnectLastfmBtn) {
      disconnectLastfmBtn.addEventListener('click', () =>
        handleDisconnect('lastfm')
      );
    }

    const musicServiceSelect = doc.getElementById('musicServiceSelect');
    if (musicServiceSelect) {
      musicServiceSelect.addEventListener('change', (e) => {
        handleMusicServiceChange(e.target.value);
      });
    }
  }

  function attachVisualHandlers() {
    const accentColorInput = doc.getElementById('accentColor');
    if (accentColorInput) {
      accentColorInput.addEventListener('change', (e) => {
        handleAccentColorChange(e.target.value);
      });
    }

    const timeFormatSelect = doc.getElementById('timeFormatSelect');
    if (timeFormatSelect) {
      timeFormatSelect.addEventListener('change', (e) => {
        handleTimeFormatChange(e.target.value);
      });
    }

    const dateFormatSelect = doc.getElementById('dateFormatSelect');
    if (dateFormatSelect) {
      dateFormatSelect.addEventListener('change', (e) => {
        handleDateFormatChange(e.target.value);
      });
    }

    const columnToggles = doc.getElementById('columnVisibilityToggles');
    if (columnToggles) {
      columnToggles
        .querySelectorAll('input[data-settings-column-id]')
        .forEach((cb) => {
          cb.addEventListener('change', () => {
            toggleColumnVisibility(cb.dataset.settingsColumnId);
          });
        });
    }
  }

  function attachPreferencesHandlers() {
    const syncBtn = doc.getElementById('syncPreferencesBtn');
    if (syncBtn) {
      syncBtn.addEventListener('click', handleSyncPreferences);
    }

    const spotifyRangeButtons = doc.getElementById('spotifyRangeButtons');
    if (spotifyRangeButtons) {
      spotifyRangeButtons.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          const service = btn.getAttribute('data-service');
          const range = btn.getAttribute('data-range');
          handleSetTimeRange(service, range);
        });
      });
    }

    const lastfmRangeButtons = doc.getElementById('lastfmRangeButtons');
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

  function attachStatsHandlers() {
    // Stats category is read-only.
  }

  return {
    attachActionBarHandlers,
    attachAccountHandlers,
    attachIntegrationsHandlers,
    attachVisualHandlers,
    attachPreferencesHandlers,
    attachStatsHandlers,
  };
}
