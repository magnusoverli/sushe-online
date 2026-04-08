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
          requestAnimationFrame(() => {
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

    loadAlbumSummaryStats();

    const refetchAlbumImagesBtn = doc.getElementById('refetchAlbumImagesBtn');
    const stopRefetchImagesBtn = doc.getElementById('stopRefetchImagesBtn');

    if (refetchAlbumImagesBtn) {
      refetchAlbumImagesBtn.addEventListener('click', handleRefetchAlbumImages);
    }

    if (stopRefetchImagesBtn) {
      stopRefetchImagesBtn.addEventListener('click', handleStopRefetchImages);
    }

    loadAlbumImageStats();

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
