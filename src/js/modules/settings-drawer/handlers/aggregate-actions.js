/**
 * Settings drawer aggregate list action flows.
 *
 * Owns reveal confirmation, lock toggles, recompute, and audit workflows.
 */

export function createSettingsAggregateActions(deps = {}) {
  const doc =
    deps.doc || (typeof document !== 'undefined' ? document : undefined);
  const win = deps.win || (typeof window !== 'undefined' ? window : undefined);

  const {
    showConfirmation,
    apiCall,
    showToast,
    categoryData,
    loadCategoryData,
    handleShowContributorManager,
    handleShowRecommenderManager,
    createSettingsModalBase,
  } = deps;

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
        await updateSingleYearLockStatus(year, !isCurrentlyLocked);

        if (win?.refreshLockedYearStatus) {
          await win.refreshLockedYearStatus(year);
        }
      }
    } catch (error) {
      console.error(`Error ${action}ing year:`, error);
      const errorMsg =
        error.data?.error || error.message || `Failed to ${action} year`;
      showToast(errorMsg, 'error');
    }
  }

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

        const lockButton = doc.querySelector(
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

        const recommenderButton = doc.querySelector(
          `.recommendation-manage-access[data-year="${year}"]`
        );
        const disabledRecommenderButton = doc.querySelector(
          `button[disabled][data-year="${year}"][title*="Unlock recommendations"]`
        );

        if (newLockStatus) {
          if (recommenderButton) {
            const newButton = doc.createElement('button');
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
          if (disabledRecommenderButton) {
            const newButton = doc.createElement('button');
            newButton.className =
              'settings-button recommendation-manage-access';
            newButton.dataset.year = year;
            newButton.innerHTML = `
              <i class="fas fa-thumbs-up mr-2 text-blue-400"></i><i class="fas fa-user-check mr-1"></i>Manage Recommenders
            `;
            newButton.addEventListener('click', async () => {
              await handleShowRecommenderManager(year);
            });
            disabledRecommenderButton.replaceWith(newButton);
          }
        }

        if (win?.invalidateLockedRecommendationYearsCache) {
          win.invalidateLockedRecommendationYearsCache();
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

  async function updateSingleYearLockStatus(year, newLockStatus) {
    const lockButton = doc.querySelector(
      `.aggregate-toggle-lock[data-year="${year}"]`
    );
    if (!lockButton) return;

    const buttonText = newLockStatus ? 'Unlock Year' : 'Lock Year';
    const iconClass = newLockStatus ? 'unlock' : 'lock';
    lockButton.innerHTML = `<i class="fas fa-${iconClass} mr-2"></i>${buttonText}`;
    lockButton.dataset.locked = newLockStatus;

    const yearHeader = doc.querySelector(
      `.aggregate-year-toggle[data-year="${year}"]`
    );
    if (yearHeader) {
      const existingLockIcon = yearHeader.querySelector('.fa-lock');
      if (newLockStatus && !existingLockIcon) {
        const lockIcon = doc.createElement('i');
        lockIcon.className = 'fas fa-lock text-yellow-500 ml-2';
        yearHeader.appendChild(lockIcon);
      } else if (!newLockStatus && existingLockIcon) {
        existingLockIcon.remove();
      }
    }

    const contributorsButton = doc.querySelector(
      `.aggregate-manage-contributors[data-year="${year}"]`
    );
    const disabledContributorsButton = doc.querySelector(
      `button[disabled][data-year="${year}"][title*="Unlock"]`
    );

    if (newLockStatus) {
      if (contributorsButton) {
        const newButton = doc.createElement('button');
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
      if (disabledContributorsButton) {
        const newButton = doc.createElement('button');
        newButton.className = 'settings-button aggregate-manage-contributors';
        newButton.dataset.year = year;
        newButton.innerHTML = `
          <i class="fas fa-users mr-2"></i>Manage Contributors
        `;
        newButton.addEventListener('click', async () => {
          await handleShowContributorManager(year);
        });
        disabledContributorsButton.replaceWith(newButton);
      }
    }

    if (categoryData.admin?.aggregateStatus) {
      const statusIndex = categoryData.admin.aggregateStatus.findIndex(
        (status) => status.year === year
      );
      if (statusIndex !== -1) {
        categoryData.admin.aggregateStatus[statusIndex].locked = newLockStatus;
      }
    }
  }

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

        if (response.status && categoryData.admin?.aggregateStatus) {
          const yearIndex = categoryData.admin.aggregateStatus.findIndex(
            (status) => status.year === year
          );
          if (yearIndex !== -1) {
            categoryData.admin.aggregateStatus[yearIndex] = response.status;
          }

          const yearContent = doc.getElementById(
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

  async function handleAuditAggregateList(year) {
    try {
      showToast('Running audit...', 'info');

      const [auditResponse, diagnosticResponse] = await Promise.all([
        apiCall(`/api/admin/aggregate-audit/${year}`),
        apiCall(`/api/admin/aggregate-audit/${year}/diagnose`),
      ]);

      if (!auditResponse) {
        showToast('Failed to run audit', 'error');
        return;
      }

      await showAuditResultsModal(year, auditResponse, diagnosticResponse);
    } catch (error) {
      console.error('Error auditing aggregate list:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to run audit';
      showToast(errorMsg, 'error');
    }
  }

  async function showAuditResultsModal(year, auditData, diagnosticData = null) {
    const { summary, duplicates } = auditData;
    const hasDuplicates = duplicates && duplicates.length > 0;

    const overlapStats = diagnosticData?.overlapStats || null;
    const missedByBasic = diagnosticData?.missedByBasic || [];

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

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        close();
        doc.removeEventListener('keydown', handleEscape);
      }
    };
    doc.addEventListener('keydown', handleEscape);
  }

  return {
    handleConfirmAggregateReveal,
    handleRevokeAggregateConfirm,
    handleResetAggregateReveal,
    handleToggleYearLock,
    handleToggleRecommendationLock,
    handleRecomputeAggregateList,
    handleAuditAggregateList,
  };
}
