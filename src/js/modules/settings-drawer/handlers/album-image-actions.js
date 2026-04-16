/**
 * Settings drawer album image refetch actions.
 *
 * Owns image stats rendering and refetch lifecycle controls.
 */

export function createSettingsAlbumImageActions(deps = {}) {
  const doc =
    deps.doc || (typeof document !== 'undefined' ? document : undefined);
  const setIntervalFn = deps.setIntervalFn || setInterval;
  const clearIntervalFn = deps.clearIntervalFn || clearInterval;

  const { apiCall, showToast, showConfirmation, categoryData } = deps;

  let imageRefetchPollInterval = null;
  let imageRefetchPollCount = 0;
  const STATS_REFRESH_INTERVAL = 10;

  function renderImageStats(stats) {
    return `
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
  }

  function applyImageStatsPayload(payload = {}) {
    const statsEl = doc.getElementById('albumImageStats');
    if (!statsEl) return;

    const stats = payload.stats;
    const isRunning = payload.isRunning;
    const progress = payload.progress || null;

    if (!stats) {
      statsEl.innerHTML =
        '<div class="text-gray-400 text-sm">No stats available</div>';
      return;
    }

    statsEl.innerHTML = renderImageStats(stats);
    updateImageRefetchUI(isRunning, progress);

    if (categoryData?.admin) {
      categoryData.admin.imageStats = {
        stats,
        isRunning,
        progress,
      };
    }
  }

  async function loadAlbumImageStats() {
    const statsEl = doc.getElementById('albumImageStats');
    if (!statsEl) return;

    try {
      const response = await apiCall('/api/admin/images/stats');
      const { stats, isRunning } = response;

      if (isRunning) {
        try {
          const progressResponse = await apiCall('/api/admin/images/progress');
          applyImageStatsPayload({
            stats,
            isRunning,
            progress: progressResponse.progress,
          });
        } catch {
          applyImageStatsPayload({ stats, isRunning, progress: null });
        }
      } else {
        applyImageStatsPayload({ stats, isRunning, progress: null });
      }
    } catch (error) {
      console.error('Error loading album image stats:', error);
      statsEl.innerHTML =
        '<div class="text-red-400 text-sm">Failed to load stats</div>';
    }
  }

  function updateImageRefetchUI(isRunning, progress = null) {
    const refetchBtn = doc.getElementById('refetchAlbumImagesBtn');
    const stopBtn = doc.getElementById('stopRefetchImagesBtn');
    const progressContainer = doc.getElementById('imageRefetchProgress');
    const progressBar = doc.getElementById('imageRefetchProgressBar');
    const progressPercent = doc.getElementById('imageRefetchProgressPercent');
    const progressLabel = doc.getElementById('imageRefetchProgressLabel');

    if (!refetchBtn || !stopBtn) return;

    if (isRunning) {
      refetchBtn.classList.add('hidden');
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
          const skippedInfo = progress.skipped
            ? ` (${progress.skipped} skipped)`
            : '';
          progressLabel.textContent = `Processing ${progress.processed || 0} of ${progress.total || 0}...${skippedInfo}`;
        }
      }

      if (!imageRefetchPollInterval) {
        imageRefetchPollCount = 0;
        imageRefetchPollInterval = setIntervalFn(
          pollImageRefetchProgress,
          1500
        );
      }
    } else {
      refetchBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');

      if (progressContainer) {
        progressContainer.classList.add('hidden');
      }

      if (imageRefetchPollInterval) {
        clearIntervalFn(imageRefetchPollInterval);
        imageRefetchPollInterval = null;
      }
    }
  }

  async function pollImageRefetchProgress() {
    try {
      const response = await apiCall('/api/admin/images/progress');
      const { isRunning, progress } = response;

      updateImageRefetchUI(isRunning, progress);
      imageRefetchPollCount++;

      if (isRunning && imageRefetchPollCount % STATS_REFRESH_INTERVAL === 0) {
        await refreshImageStatsOnly();
      }

      if (!isRunning && imageRefetchPollInterval) {
        clearIntervalFn(imageRefetchPollInterval);
        imageRefetchPollInterval = null;
        imageRefetchPollCount = 0;
        await loadAlbumImageStats();
      }
    } catch (error) {
      console.error('Error polling image refetch progress:', error);
    }
  }

  async function refreshImageStatsOnly() {
    const statsEl = doc.getElementById('albumImageStats');
    if (!statsEl) return;

    try {
      const response = await apiCall('/api/admin/images/stats');
      const { stats } = response;

      if (!stats) return;

      statsEl.innerHTML = renderImageStats(stats);

      if (categoryData?.admin?.imageStats) {
        categoryData.admin.imageStats = {
          ...categoryData.admin.imageStats,
          stats,
        };
      }
    } catch (error) {
      console.error('Error refreshing image stats:', error);
    }
  }

  async function handleRefetchAlbumImages() {
    const refetchBtn = doc.getElementById('refetchAlbumImagesBtn');
    const resultEl = doc.getElementById('imageRefetchResult');
    const resultTextEl = doc.getElementById('imageRefetchResultText');

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

      resultEl.classList.add('hidden');

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

  async function handleStopRefetchImages() {
    const stopBtn = doc.getElementById('stopRefetchImagesBtn');

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
    loadAlbumImageStats,
    applyImageStatsPayload,
    handleRefetchAlbumImages,
    handleStopRefetchImages,
  };
}
