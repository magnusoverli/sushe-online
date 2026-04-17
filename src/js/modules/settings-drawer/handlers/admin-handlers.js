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

  function escapeText(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderCleanupSampleList(sampleAlbums) {
    if (!Array.isArray(sampleAlbums) || sampleAlbums.length === 0) {
      return '<div class="mt-2 text-xs text-gray-500" id="catalogCleanupSampleList">No candidate sample available.</div>';
    }

    const items = sampleAlbums
      .map((album) => {
        const artist = escapeText(album.artist || '(unknown artist)');
        const title = escapeText(album.album || '(unknown album)');
        const albumId = escapeText(album.album_id || '(null album_id)');
        return `<li class="text-xs text-gray-500 truncate">${artist} - ${title} <span class="text-gray-600">[${albumId}]</span></li>`;
      })
      .join('');

    return `<div class="mt-2"><div class="text-xs text-gray-400 mb-1">Sample candidates:</div><ul id="catalogCleanupSampleList" class="space-y-1">${items}</ul></div>`;
  }

  function updateCatalogCleanupPreview(preview) {
    const orphanCountEl = doc.getElementById('catalogCleanupOrphanCount');
    const statsRefCountEl = doc.getElementById('catalogCleanupStatsRefCount');
    const pairCountEl = doc.getElementById('catalogCleanupDistinctPairCount');
    const minAgeInput = doc.getElementById('catalogCleanupMinAgeDays');
    const statusEl = doc.getElementById('catalogCleanupStatus');
    const sampleContainer = doc.getElementById('catalogCleanupSampleContainer');

    if (orphanCountEl) {
      orphanCountEl.textContent = String(preview?.orphanAlbums || 0);
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

    if (statusEl) {
      const generatedAt = preview?.generatedAt
        ? new Date(preview.generatedAt).toLocaleString()
        : 'just now';
      statusEl.textContent = `Preview generated at ${generatedAt}`;
    }

    if (sampleContainer) {
      sampleContainer.innerHTML = renderCleanupSampleList(
        preview?.sampleAlbums
      );
    }
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
    const cleanupStatusEl = doc.getElementById('catalogCleanupStatus');

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
          if (cleanupStatusEl) {
            cleanupStatusEl.textContent = 'Refreshing cleanup preview...';
          }

          await runCleanupPreview(minAgeDays);
          showToast('Cleanup preview refreshed', 'success');
        } catch (error) {
          console.error('Error loading cleanup preview:', error);
          if (cleanupStatusEl) {
            cleanupStatusEl.textContent =
              error?.data?.error || 'Failed to refresh cleanup preview';
          }
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
          if (cleanupStatusEl) {
            cleanupStatusEl.textContent =
              'Refreshing preview before cleanup...';
          }

          const preview = await runCleanupPreview(minAgeDays);
          const orphanAlbums = preview?.orphanAlbums || 0;

          if (orphanAlbums === 0) {
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
            if (cleanupStatusEl) {
              cleanupStatusEl.textContent = 'Cleanup cancelled.';
            }
            return;
          }

          if (cleanupStatusEl) {
            cleanupStatusEl.textContent = 'Running catalog cleanup...';
          }

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

          if (cleanupStatusEl) {
            cleanupStatusEl.textContent = 'Cleanup completed.';
          }
        } catch (error) {
          console.error('Error executing catalog cleanup:', error);
          const errorMessage =
            error?.data?.error || 'Failed to execute catalog cleanup';
          if (cleanupStatusEl) {
            cleanupStatusEl.textContent = errorMessage;
          }
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
