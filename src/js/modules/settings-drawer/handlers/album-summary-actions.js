/**
 * Settings drawer album summary batch actions.
 *
 * Owns summary stats rendering and batch lifecycle controls.
 */

export function createSettingsAlbumSummaryActions(deps = {}) {
  const doc =
    deps.doc || (typeof document !== 'undefined' ? document : undefined);
  const setIntervalFn = deps.setIntervalFn || setInterval;
  const clearIntervalFn = deps.clearIntervalFn || clearInterval;

  const {
    apiCall,
    showToast,
    categoryData,
    getAlbumSummaryPollInterval,
    setAlbumSummaryPollInterval,
  } = deps;
  const STATS_REFRESH_INTERVAL = 10;
  let statusPollCount = 0;

  function renderSummaryStats(stats) {
    return `
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
  }

  function applySummaryStatsPayload(payload = {}) {
    const statsEl = doc.getElementById('albumSummaryStats');
    if (!statsEl) return;

    const stats = payload.stats;
    const batchStatus = payload.batchStatus;

    if (!stats) {
      statsEl.innerHTML =
        '<div class="text-gray-400 text-sm">No stats available</div>';
      return;
    }

    statsEl.innerHTML = renderSummaryStats(stats);
    updateAlbumSummaryUI(batchStatus);

    if (categoryData?.admin) {
      categoryData.admin.summaryStats = {
        stats,
        batchStatus,
      };
    }
  }

  async function loadAlbumSummaryStats() {
    const statsEl = doc.getElementById('albumSummaryStats');
    if (!statsEl) return;

    try {
      const response = await apiCall('/api/admin/album-summaries/stats');
      applySummaryStatsPayload(response);
    } catch (error) {
      console.error('Error loading album summary stats:', error);
      statsEl.innerHTML =
        '<div class="text-red-400 text-sm">Failed to load stats</div>';
    }
  }

  function updateAlbumSummaryUI(status) {
    const fetchBtn = doc.getElementById('fetchAlbumSummariesBtn');
    const regenerateBtn = doc.getElementById('regenerateAllSummariesBtn');
    const stopBtn = doc.getElementById('stopAlbumSummariesBtn');
    const progressEl = doc.getElementById('albumSummaryProgress');
    const progressBar = doc.getElementById('albumSummaryProgressBar');
    const progressText = doc.getElementById('albumSummaryProgressText');

    if (!fetchBtn || !stopBtn || !progressEl) return;

    if (status?.running) {
      fetchBtn.classList.add('hidden');
      if (regenerateBtn) regenerateBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
      progressEl.classList.remove('hidden');

      const progress = status.progress || 0;
      progressBar.style.width = `${progress}%`;
      progressText.textContent = `Processing: ${status.processed || 0}/${status.total || 0} (${status.found || 0} found, ${status.notFound || 0} not found, ${status.errors || 0} errors)`;

      if (!getAlbumSummaryPollInterval()) {
        statusPollCount = 0;
        setAlbumSummaryPollInterval(
          setIntervalFn(pollAlbumSummaryStatus, 2000)
        );
      }
    } else {
      fetchBtn.classList.remove('hidden');
      if (regenerateBtn) regenerateBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');
      progressEl.classList.add('hidden');

      if (getAlbumSummaryPollInterval()) {
        clearIntervalFn(getAlbumSummaryPollInterval());
        setAlbumSummaryPollInterval(null);
      }

      statusPollCount = 0;
    }
  }

  async function pollAlbumSummaryStatus() {
    try {
      const response = await apiCall('/api/admin/album-summaries/status');
      updateAlbumSummaryUI(response.status);

      if (response.status?.running) {
        statusPollCount++;
        if (statusPollCount % STATS_REFRESH_INTERVAL === 0) {
          await loadAlbumSummaryStats();
        }
      } else {
        statusPollCount = 0;
        try {
          await loadAlbumSummaryStats();
        } catch (statsError) {
          console.error(
            'Error loading album summary stats after batch completion:',
            statsError
          );
        }
      }
    } catch (error) {
      console.error('Error polling album summary status:', error);
    }
  }

  async function handleFetchAlbumSummaries() {
    const fetchBtn = doc.getElementById('fetchAlbumSummariesBtn');

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

  async function handleStopAlbumSummaries() {
    const stopBtn = doc.getElementById('stopAlbumSummariesBtn');

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

  return {
    loadAlbumSummaryStats,
    applySummaryStatsPayload,
    pollAlbumSummaryStatus,
    handleFetchAlbumSummaries,
    handleStopAlbumSummaries,
  };
}
