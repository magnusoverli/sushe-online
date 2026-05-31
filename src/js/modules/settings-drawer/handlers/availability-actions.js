/**
 * Settings drawer streaming-availability resolution actions.
 *
 * Owns availability-coverage stats rendering and the resolution job lifecycle
 * controls. Mirrors the album-image refetch actions: trigger, then poll progress.
 */

import { renderAvailabilityStatsGrid } from '../renderers/availability-panel.js';

export function createSettingsAvailabilityActions(deps = {}) {
  const doc =
    deps.doc || (typeof document !== 'undefined' ? document : undefined);
  const setIntervalFn = deps.setIntervalFn || setInterval;
  const clearIntervalFn = deps.clearIntervalFn || clearInterval;

  const { apiCall, showToast, showConfirmation, categoryData } = deps;

  let availabilityPollInterval = null;
  let availabilityPollCount = 0;
  const STATS_REFRESH_INTERVAL = 10;

  function applyAvailabilityStatsPayload(payload = {}) {
    const statsEl = doc.getElementById('availabilityStats');
    if (!statsEl) return;

    const stats = payload.stats;
    const isRunning = payload.isRunning;
    const progress = payload.progress || null;

    if (!stats) {
      statsEl.innerHTML =
        '<div class="text-gray-400 text-sm">No stats available</div>';
      return;
    }

    statsEl.innerHTML = renderAvailabilityStatsGrid(stats);
    updateAvailabilityUI(isRunning, progress);

    if (categoryData?.admin) {
      categoryData.admin.availabilityStats = {
        stats,
        isRunning,
        progress,
      };
    }
  }

  async function loadAvailabilityStats() {
    const statsEl = doc.getElementById('availabilityStats');
    if (!statsEl) return;

    try {
      const response = await apiCall('/api/admin/availability/stats');
      const { stats, isRunning } = response;

      if (isRunning) {
        try {
          const progressResponse = await apiCall(
            '/api/admin/availability/progress'
          );
          applyAvailabilityStatsPayload({
            stats,
            isRunning,
            progress: progressResponse.progress,
          });
        } catch {
          applyAvailabilityStatsPayload({ stats, isRunning, progress: null });
        }
      } else {
        applyAvailabilityStatsPayload({ stats, isRunning, progress: null });
      }
    } catch (error) {
      console.error('Error loading availability stats:', error);
      statsEl.innerHTML =
        '<div class="text-red-400 text-sm">Failed to load stats</div>';
    }
  }

  function updateAvailabilityUI(isRunning, progress = null) {
    const resolveBtn = doc.getElementById('resolveAvailabilityBtn');
    const reresolveBtn = doc.getElementById('reresolveAvailabilityBtn');
    const stopBtn = doc.getElementById('stopAvailabilityBtn');
    const progressContainer = doc.getElementById('availabilityProgress');
    const progressBar = doc.getElementById('availabilityProgressBar');
    const progressPercent = doc.getElementById('availabilityProgressPercent');
    const progressLabel = doc.getElementById('availabilityProgressLabel');

    if (!resolveBtn || !stopBtn) return;

    if (isRunning) {
      resolveBtn.classList.add('hidden');
      if (reresolveBtn) reresolveBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');

      if (progressContainer) {
        progressContainer.classList.remove('hidden');
      }

      if (progress && progressBar) {
        const percent = progress.percentComplete || 0;
        progressBar.style.width = `${percent}%`;
        if (progressPercent) {
          progressPercent.textContent = `${percent}%`;
        }
        if (progressLabel) {
          const foundInfo = progress.resolved
            ? ` (${progress.resolved} found)`
            : '';
          progressLabel.textContent = `Resolving ${progress.processed || 0} of ${progress.total || 0}...${foundInfo}`;
        }
      }

      if (!availabilityPollInterval) {
        availabilityPollCount = 0;
        availabilityPollInterval = setIntervalFn(
          pollAvailabilityProgress,
          1500
        );
      }
    } else {
      resolveBtn.classList.remove('hidden');
      if (reresolveBtn) reresolveBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');

      if (progressContainer) {
        progressContainer.classList.add('hidden');
      }

      if (availabilityPollInterval) {
        clearIntervalFn(availabilityPollInterval);
        availabilityPollInterval = null;
      }
    }
  }

  async function pollAvailabilityProgress() {
    try {
      const response = await apiCall('/api/admin/availability/progress');
      const { isRunning, progress } = response;

      updateAvailabilityUI(isRunning, progress);
      availabilityPollCount++;

      if (isRunning && availabilityPollCount % STATS_REFRESH_INTERVAL === 0) {
        await refreshAvailabilityStatsOnly();
      }

      if (!isRunning && availabilityPollInterval) {
        clearIntervalFn(availabilityPollInterval);
        availabilityPollInterval = null;
        availabilityPollCount = 0;
        await loadAvailabilityStats();
      }
    } catch (error) {
      console.error('Error polling availability progress:', error);
    }
  }

  async function refreshAvailabilityStatsOnly() {
    const statsEl = doc.getElementById('availabilityStats');
    if (!statsEl) return;

    try {
      const response = await apiCall('/api/admin/availability/stats');
      const { stats } = response;
      if (!stats) return;

      statsEl.innerHTML = renderAvailabilityStatsGrid(stats);

      if (categoryData?.admin?.availabilityStats) {
        categoryData.admin.availabilityStats = {
          ...categoryData.admin.availabilityStats,
          stats,
        };
      }
    } catch (error) {
      console.error('Error refreshing availability stats:', error);
    }
  }

  async function startResolution({ all }) {
    const resolveBtn = doc.getElementById('resolveAvailabilityBtn');
    const reresolveBtn = doc.getElementById('reresolveAvailabilityBtn');
    const resultEl = doc.getElementById('availabilityResult');
    const resultTextEl = doc.getElementById('availabilityResultText');

    const confirmed = await showConfirmation(
      all ? 'Re-resolve All Availability' : 'Resolve Streaming Availability',
      all
        ? 'This re-resolves availability for every album, including already-resolved ones (non-destructive). It can take a long time.'
        : 'This resolves streaming-platform availability for albums not yet resolved.',
      'Resolution is paced by external rate limits and can be stopped at any time.',
      all ? 'Re-resolve All' : 'Start Resolving'
    );

    if (!confirmed) return;

    try {
      if (resolveBtn) resolveBtn.disabled = true;
      if (reresolveBtn) reresolveBtn.disabled = true;

      resultEl?.classList.add('hidden');

      updateAvailabilityUI(true, {
        total: 0,
        processed: 0,
        resolved: 0,
        percentComplete: 0,
      });

      showToast(
        'Availability resolution started. This may take a while...',
        'info'
      );

      const response = await apiCall('/api/admin/availability/resolve', {
        method: 'POST',
        body: JSON.stringify({ all }),
      });

      if (response.success && response.summary) {
        const s = response.summary;
        const duration = formatDuration(s.durationSeconds);

        if (resultTextEl) {
          resultTextEl.innerHTML = `
            <div class="font-semibold text-white mb-2">
              ${s.stoppedEarly ? 'Resolution Stopped Early' : 'Resolution Complete'}
            </div>
            <div class="grid grid-cols-2 gap-2 text-sm">
              <div><span class="text-gray-400">Total:</span> ${s.total}</div>
              <div><span class="text-gray-400">Duration:</span> ${duration}</div>
              <div><span class="text-green-400">Resolved:</span> ${s.resolved}</div>
              <div><span class="text-yellow-400">Skipped:</span> ${s.skipped}</div>
              <div><span class="text-red-400">Failed:</span> ${s.failed}</div>
            </div>
          `;
        }
        resultEl?.classList.remove('hidden');

        showToast(
          `Availability ${s.stoppedEarly ? 'stopped' : 'completed'}: ${s.resolved} resolved, ${s.skipped} skipped, ${s.failed} failed`,
          s.stoppedEarly ? 'warning' : 'success'
        );

        await loadAvailabilityStats();
      }
    } catch (error) {
      console.error('Error resolving availability:', error);
      showToast(error.data?.error || 'Failed to resolve availability', 'error');
    } finally {
      if (resolveBtn) resolveBtn.disabled = false;
      if (reresolveBtn) reresolveBtn.disabled = false;
      updateAvailabilityUI(false);
    }
  }

  function handleResolveAvailability() {
    return startResolution({ all: false });
  }

  function handleReresolveAvailability() {
    return startResolution({ all: true });
  }

  async function handleStopAvailability() {
    const stopBtn = doc.getElementById('stopAvailabilityBtn');

    try {
      if (stopBtn) {
        stopBtn.disabled = true;
        stopBtn.textContent = 'Stopping...';
      }

      const response = await apiCall('/api/admin/availability/stop', {
        method: 'POST',
      });

      if (response.success) {
        showToast('Availability resolution stopping...', 'info');
      }
    } catch (error) {
      console.error('Error stopping availability resolution:', error);
      showToast('Failed to stop resolution', 'error');
    } finally {
      if (stopBtn) {
        stopBtn.disabled = false;
        stopBtn.textContent = 'Stop';
      }
    }
  }

  function formatDuration(seconds) {
    if (seconds < 60) {
      return `${seconds}s`;
    }

    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}m ${secs}s`;
    }

    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }

  return {
    loadAvailabilityStats,
    applyAvailabilityStatsPayload,
    handleResolveAvailability,
    handleReresolveAvailability,
    handleStopAvailability,
  };
}
