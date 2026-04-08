/**
 * Settings drawer preference/integration/visual actions.
 *
 * Owns integration disconnects, preference sync/range selection,
 * and visual formatting updates.
 */

export function createSettingsPreferenceActions(deps = {}) {
  const doc =
    deps.doc || (typeof document !== 'undefined' ? document : undefined);
  const win = deps.win || (typeof window !== 'undefined' ? window : {});

  const {
    categoryData,
    showConfirmation,
    apiCall,
    showToast,
    loadCategoryData,
  } = deps;

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
      win.location.href = `/auth/${service}/disconnect`;
    } catch (error) {
      console.error('Error disconnecting service:', error);
      showToast(`Failed to disconnect ${serviceName}`, 'error');
    }
  }

  async function handleMusicServiceChange(service) {
    try {
      const result = await apiCall('/settings/update-music-service', {
        method: 'POST',
        body: JSON.stringify({ musicService: service || null }),
      });

      if (result.success) {
        showToast('Music service updated!');
        if (categoryData.integrations) {
          categoryData.integrations.musicService = service || '';
        }
        if (win.currentUser) {
          win.currentUser.musicService = service || null;
        }
      } else {
        showToast(result.error || 'Error updating music service', 'error');
      }
    } catch (error) {
      console.error('Error updating music service:', error);
      showToast('Error updating music service', 'error');
    }
  }

  async function handleSyncPreferences() {
    const syncBtn = doc.getElementById('syncPreferencesBtn');
    const syncIcon = doc.getElementById('syncIcon');
    const syncText = doc.getElementById('syncText');

    if (!syncBtn) return;

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
      categoryData.preferences = null;
      await loadCategoryData('preferences');
    } catch (error) {
      console.error('Error syncing preferences:', error);
      showToast('Failed to sync preferences', 'error');
    } finally {
      syncBtn.disabled = false;
      if (syncIcon) {
        syncIcon.classList.remove('fa-spin');
      }
      if (syncText) {
        syncText.textContent = 'Sync Now';
      }
    }
  }

  function handleSetTimeRange(service, range) {
    const buttonContainer = doc.getElementById(`${service}RangeButtons`);
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

        btn.classList.remove(
          'bg-green-600',
          'bg-red-600',
          'bg-gray-700',
          'text-white',
          'text-gray-300',
          'hover:bg-gray-600'
        );

        if (isActive) {
          activeClass.split(' ').forEach((c) => btn.classList.add(c));
        } else {
          inactiveClass.split(' ').forEach((c) => btn.classList.add(c));
        }
      });
    }

    const allSections = doc.querySelectorAll(
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

  async function handleAccentColorChange(color) {
    try {
      await apiCall('/settings/update-accent-color', {
        method: 'POST',
        body: JSON.stringify({ accentColor: color }),
      });

      doc.documentElement.style.setProperty('--accent-color', color);

      showToast('Accent color updated', 'success');

      if (categoryData.visual) {
        categoryData.visual.accentColor = color;
      }

      if (win.currentUser) {
        win.currentUser.accentColor = color;
      }
    } catch (error) {
      console.error('Error updating accent color:', error);
      showToast('Failed to update accent color', 'error');

      const input = doc.getElementById('accentColor');
      if (input && categoryData.visual) {
        input.value = categoryData.visual.accentColor;
      }
    }
  }

  async function handleTimeFormatChange(timeFormat) {
    try {
      await apiCall('/settings/update-time-format', {
        method: 'POST',
        body: JSON.stringify({ timeFormat }),
      });

      showToast('Time format updated', 'success');

      if (categoryData.visual) {
        categoryData.visual.timeFormat = timeFormat;
      }

      if (win.currentUser) {
        win.currentUser.timeFormat = timeFormat;
      }
    } catch (error) {
      console.error('Error updating time format:', error);
      showToast('Failed to update time format', 'error');

      const select = doc.getElementById('timeFormatSelect');
      if (select && categoryData.visual) {
        select.value = categoryData.visual.timeFormat;
      }
    }
  }

  async function handleDateFormatChange(dateFormat) {
    try {
      await apiCall('/settings/update-date-format', {
        method: 'POST',
        body: JSON.stringify({ dateFormat }),
      });

      showToast('Date format updated', 'success');

      if (categoryData.visual) {
        categoryData.visual.dateFormat = dateFormat;
      }

      if (win.currentUser) {
        win.currentUser.dateFormat = dateFormat;
      }
    } catch (error) {
      console.error('Error updating date format:', error);
      showToast('Failed to update date format', 'error');

      const select = doc.getElementById('dateFormatSelect');
      if (select && categoryData.visual) {
        select.value = categoryData.visual.dateFormat;
      }
    }
  }

  return {
    handleDisconnect,
    handleMusicServiceChange,
    handleSyncPreferences,
    handleSetTimeRange,
    handleAccentColorChange,
    handleTimeFormatChange,
    handleDateFormatChange,
  };
}
