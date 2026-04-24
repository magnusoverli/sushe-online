/**
 * Admin settings drawer handler wiring.
 *
 * Keeps admin event listener attachment separate from drawer orchestration.
 */

export function createSettingsAdminHandlers(deps = {}) {
  const doc =
    deps.doc || (typeof document !== 'undefined' ? document : undefined);
  const setIntervalFn = deps.setIntervalFn || setInterval;

  const {
    showConfirmation,
    apiCall,
    showToast,
    loadAlbumSummaryStats,
    pollAlbumSummaryStatus,
    getAlbumSummaryPollInterval,
    setAlbumSummaryPollInterval,
    loadAlbumImageStats,
    applySummaryStatsPayload,
    applyImageStatsPayload,
    categoryData,
    handleAdminEventAction,
    handleConfigureTelegram,
    handleDisconnectTelegram,
    handleToggleTelegramRecommendations,
    handleTestTelegramRecommendations,
    handleDownloadBackup,
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
  } = deps;

  function normalizeCleanupMinAgeDays(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      return 90;
    }

    return Math.min(Math.max(parsed, 0), 3650);
  }

  function updateCatalogCleanupPreview(preview) {
    const totalAlbumsEl = doc.getElementById('catalogCleanupTotalAlbums');
    const orphanTotalEl = doc.getElementById('catalogCleanupOrphanTotal');
    const orphanYoungEl = doc.getElementById('catalogCleanupOrphanYoungCount');
    const statsRefCountEl = doc.getElementById('catalogCleanupStatsRefCount');
    const pairCountEl = doc.getElementById('catalogCleanupDistinctPairCount');
    const minAgeInput = doc.getElementById('catalogCleanupMinAgeDays');

    if (totalAlbumsEl) {
      totalAlbumsEl.textContent = String(preview?.totalAlbums || 0);
    }

    if (orphanTotalEl) {
      orphanTotalEl.textContent = String(preview?.orphanAlbumsTotal || 0);
    }

    if (orphanYoungEl) {
      orphanYoungEl.textContent = String(preview?.orphanAlbumsTooYoung || 0);
    }

    if (statsRefCountEl) {
      statsRefCountEl.textContent = String(
        preview?.userAlbumStatsReferences || 0
      );
    }

    if (pairCountEl) {
      pairCountEl.textContent = String(preview?.distinctPairReferences || 0);
    }

    if (minAgeInput && preview?.minAgeDays !== undefined) {
      minAgeInput.value = String(preview.minAgeDays);
    }
  }

  function setCleanupStatus(message = '') {
    const statusEl = doc.getElementById('catalogCleanupStatus');
    if (!statusEl) return;

    if (message) {
      statusEl.textContent = message;
      statusEl.classList.remove('hidden');
      return;
    }

    statusEl.textContent = '';
    statusEl.classList.add('hidden');
  }

  function attachAdminHandlers() {
    doc.querySelectorAll('.admin-event-action').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const eventId = btn.dataset.eventId;
        const action = btn.dataset.action;

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

    const configureTelegramBtn = doc.getElementById('configureTelegramBtn');
    const disconnectTelegramBtn = doc.getElementById('disconnectTelegramBtn');

    if (configureTelegramBtn) {
      configureTelegramBtn.addEventListener('click', handleConfigureTelegram);
    }

    if (disconnectTelegramBtn) {
      disconnectTelegramBtn.addEventListener('click', handleDisconnectTelegram);
    }

    const toggleTelegramRecsBtn = doc.getElementById('toggleTelegramRecsBtn');
    const testTelegramRecsBtn = doc.getElementById('testTelegramRecsBtn');

    if (toggleTelegramRecsBtn) {
      toggleTelegramRecsBtn.addEventListener(
        'click',
        handleToggleTelegramRecommendations
      );
    }

    if (testTelegramRecsBtn) {
      testTelegramRecsBtn.addEventListener(
        'click',
        handleTestTelegramRecommendations
      );
    }

    const restoreDatabaseBtn = doc.getElementById('restoreDatabaseBtn');
    if (restoreDatabaseBtn) {
      restoreDatabaseBtn.addEventListener('click', handleRestoreDatabase);
    }

    const downloadBackupBtn = doc.getElementById('downloadBackupBtn');
    if (downloadBackupBtn) {
      downloadBackupBtn.addEventListener('click', handleDownloadBackup);
    }

    doc.querySelectorAll('.admin-grant-admin').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        await handleGrantAdmin(userId);
      });
    });

    doc.querySelectorAll('.admin-revoke-admin').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        await handleRevokeAdmin(userId);
      });
    });

    doc.querySelectorAll('.admin-view-lists').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        await handleViewUserLists(userId);
      });
    });

    doc.querySelectorAll('.admin-delete-user').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        await handleDeleteUser(userId);
      });
    });

    doc.querySelectorAll('.aggregate-year-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const year = btn.dataset.year;
        const content = doc.getElementById(`aggregate-year-content-${year}`);
        const chevron = btn.querySelector('.aggregate-year-chevron');
        const isExpanded = btn.getAttribute('aria-expanded') === 'true';

        if (isExpanded) {
          content.style.maxHeight = `${content.scrollHeight}px`;
          content.style.opacity = '1';
          void content.offsetHeight;
          content.style.maxHeight = '0';
          content.style.opacity = '0';
          setTimeout(() => {
            content.classList.add('hidden');
          }, 300);
          chevron.style.transform = 'rotate(0deg)';
          btn.setAttribute('aria-expanded', 'false');
        } else {
          content.classList.remove('hidden');
          content.style.maxHeight = 'none';
          content.style.opacity = '0';
          const height = content.scrollHeight;
          content.style.maxHeight = '0';
          void content.offsetHeight;
          const raf =
            typeof requestAnimationFrame === 'function'
              ? requestAnimationFrame
              : (callback) => setTimeout(callback, 0);
          raf(() => {
            content.style.maxHeight = `${height}px`;
            content.style.opacity = '1';
          });
          chevron.style.transform = 'rotate(90deg)';
          btn.setAttribute('aria-expanded', 'true');
        }
      });

      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          btn.click();
        }
      });
    });

    doc.querySelectorAll('.aggregate-confirm-reveal').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const year = parseInt(btn.dataset.year, 10);
        await handleConfirmAggregateReveal(year);
      });
    });

    doc.querySelectorAll('.aggregate-revoke-confirm').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const year = parseInt(btn.dataset.year, 10);
        await handleRevokeAggregateConfirm(year);
      });
    });

    doc.querySelectorAll('.aggregate-reset-reveal').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const year = parseInt(btn.dataset.year, 10);
        await handleResetAggregateReveal(year);
      });
    });

    doc.querySelectorAll('.aggregate-recompute').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const year = parseInt(btn.dataset.year, 10);
        await handleRecomputeAggregateList(year);
      });
    });

    doc.querySelectorAll('.aggregate-audit').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const year = parseInt(btn.dataset.year, 10);
        await handleAuditAggregateList(year);
      });
    });

    doc.querySelectorAll('.aggregate-manage-contributors').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const year = parseInt(btn.dataset.year, 10);
        await handleShowContributorManager(year);
      });
    });

    doc.querySelectorAll('.aggregate-toggle-lock').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const year = parseInt(btn.dataset.year, 10);
        const isCurrentlyLocked = btn.dataset.locked === 'true';
        await handleToggleYearLock(year, isCurrentlyLocked);
      });
    });

    doc.querySelectorAll('.recommendation-toggle-lock').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const year = parseInt(btn.dataset.year, 10);
        const isCurrentlyLocked = btn.dataset.locked === 'true';
        await handleToggleRecommendationLock(year, isCurrentlyLocked);
      });
    });

    doc.querySelectorAll('.recommendation-manage-access').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const year = parseInt(btn.dataset.year, 10);
        await handleShowRecommenderManager(year);
      });
    });

    const fetchAlbumSummariesBtn = doc.getElementById('fetchAlbumSummariesBtn');
    const regenerateAllSummariesBtn = doc.getElementById(
      'regenerateAllSummariesBtn'
    );
    const stopAlbumSummariesBtn = doc.getElementById('stopAlbumSummariesBtn');

    if (fetchAlbumSummariesBtn) {
      fetchAlbumSummariesBtn.addEventListener(
        'click',
        handleFetchAlbumSummaries
      );
    }

    if (regenerateAllSummariesBtn) {
      regenerateAllSummariesBtn.addEventListener('click', async () => {
        const confirmed = await showConfirmation(
          'Regenerate All Album Summaries',
          'Are you sure you want to regenerate ALL album summaries?',
          'This will regenerate summaries for all albums (including those with existing summaries) and will incur API costs. This action should only be used when necessary.',
          'Regenerate All'
        );

        if (!confirmed) return;

        const fetchBtn = doc.getElementById('fetchAlbumSummariesBtn');
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
            if (!getAlbumSummaryPollInterval()) {
              const intervalRef = setIntervalFn(pollAlbumSummaryStatus, 2000);
              setAlbumSummaryPollInterval(intervalRef);
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

    const initialSummaryPayload = categoryData?.admin?.summaryStats;
    if (initialSummaryPayload?.stats && applySummaryStatsPayload) {
      applySummaryStatsPayload(initialSummaryPayload);
    } else {
      loadAlbumSummaryStats();
    }

    const refetchAlbumImagesBtn = doc.getElementById('refetchAlbumImagesBtn');
    const stopRefetchImagesBtn = doc.getElementById('stopRefetchImagesBtn');

    if (refetchAlbumImagesBtn) {
      refetchAlbumImagesBtn.addEventListener('click', handleRefetchAlbumImages);
    }

    if (stopRefetchImagesBtn) {
      stopRefetchImagesBtn.addEventListener('click', handleStopRefetchImages);
    }

    const initialImagePayload = categoryData?.admin?.imageStats;
    if (initialImagePayload?.stats && applyImageStatsPayload) {
      applyImageStatsPayload(initialImagePayload);
    } else {
      loadAlbumImageStats();
    }

    const cleanupMinAgeInput = doc.getElementById('catalogCleanupMinAgeDays');
    const cleanupPreviewBtn = doc.getElementById('catalogCleanupPreviewBtn');
    const cleanupExecuteBtn = doc.getElementById('catalogCleanupExecuteBtn');

    const runCleanupPreview = async (minAgeDays) => {
      const response = await apiCall(
        `/api/admin/catalog-cleanup/preview?minAgeDays=${minAgeDays}`
      );
      if (response?.preview) {
        if (categoryData?.admin) {
          categoryData.admin.catalogCleanupPreview = response.preview;
        }
        updateCatalogCleanupPreview(response.preview);
      }
      return response?.preview || null;
    };

    if (cleanupPreviewBtn) {
      cleanupPreviewBtn.addEventListener('click', async () => {
        const minAgeDays = normalizeCleanupMinAgeDays(
          cleanupMinAgeInput?.value
        );

        try {
          cleanupPreviewBtn.disabled = true;
          setCleanupStatus('Refreshing cleanup preview...');

          const preview = await runCleanupPreview(minAgeDays);
          setCleanupStatus(
            `Preview: ${preview?.orphanAlbums || 0} will be removed, ${preview?.orphanAlbumsTooYoung || 0} are too new.`
          );
          showToast('Cleanup preview refreshed', 'success');
        } catch (error) {
          console.error('Error loading cleanup preview:', error);
          setCleanupStatus(
            error?.data?.error || 'Failed to refresh cleanup preview'
          );
          showToast('Failed to refresh cleanup preview', 'error');
        } finally {
          cleanupPreviewBtn.disabled = false;
        }
      });
    }

    if (cleanupExecuteBtn) {
      cleanupExecuteBtn.addEventListener('click', async () => {
        const minAgeDays = normalizeCleanupMinAgeDays(
          cleanupMinAgeInput?.value
        );

        try {
          cleanupExecuteBtn.disabled = true;
          setCleanupStatus('Refreshing preview before cleanup...');

          const preview = await runCleanupPreview(minAgeDays);
          const orphanAlbums = preview?.orphanAlbums || 0;

          if (orphanAlbums === 0) {
            setCleanupStatus('No orphan albums to clean up.');
            showToast('No orphan albums to clean up', 'info');
            return;
          }

          const confirmed = await showConfirmation(
            'Delete Safe Orphan Albums',
            `Delete ${orphanAlbums} orphan album${orphanAlbums === 1 ? '' : 's'}?`,
            'This removes albums not referenced by lists, recommendations, service mappings, or alias source links. Historical user album stats references will be preserved by setting album_id to null.',
            'Delete Orphans'
          );

          if (!confirmed) {
            setCleanupStatus('Cleanup cancelled.');
            return;
          }

          setCleanupStatus('Running catalog cleanup...');

          const executeResponse = await apiCall(
            '/api/admin/catalog-cleanup/execute',
            {
              method: 'POST',
              body: JSON.stringify({
                minAgeDays,
                expectedDeleteCount: orphanAlbums,
              }),
            }
          );

          const result = executeResponse?.result || {};
          if (categoryData?.admin) {
            categoryData.admin.catalogCleanupPreview =
              result.postCleanupPreview;
          }

          if (result.postCleanupPreview) {
            updateCatalogCleanupPreview(result.postCleanupPreview);
          }

          await Promise.all([loadAlbumSummaryStats(), loadAlbumImageStats()]);

          showToast(
            `Deleted ${result.deletedAlbums || 0} orphan album${result.deletedAlbums === 1 ? '' : 's'}${result.nullifiedUserAlbumStats ? `, nulled ${result.nullifiedUserAlbumStats} stats refs` : ''}`,
            'success'
          );

          setCleanupStatus('Cleanup completed.');
        } catch (error) {
          console.error('Error executing catalog cleanup:', error);
          const errorMessage =
            error?.data?.error || 'Failed to execute catalog cleanup';
          setCleanupStatus(errorMessage);
          showToast(errorMessage, 'error');
        } finally {
          cleanupExecuteBtn.disabled = false;
        }
      });
    }

    const scanDuplicatesBtn = doc.getElementById('scanDuplicatesBtn');
    if (scanDuplicatesBtn) {
      scanDuplicatesBtn.addEventListener('click', handleScanDuplicates);
    }

    const auditManualAlbumsBtn = doc.getElementById('auditManualAlbumsBtn');
    if (auditManualAlbumsBtn) {
      auditManualAlbumsBtn.addEventListener('click', handleAuditManualAlbums);
    }
  }

  return {
    attachAdminHandlers,
  };
}
