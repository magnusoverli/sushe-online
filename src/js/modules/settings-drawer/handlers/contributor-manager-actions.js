/**
 * Settings drawer contributor manager flows.
 *
 * Owns the contributor access modal and save workflow.
 */

export function createSettingsContributorManagerActions(deps = {}) {
  const doc =
    deps.doc || (typeof document !== 'undefined' ? document : undefined);
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;

  const {
    apiCall,
    showToast,
    categoryData,
    loadCategoryData,
    createSettingsModalBase,
  } = deps;

  async function createContributorModal(year) {
    const { modal, close } = createSettingsModalBase({
      id: `contributor-modal-${year}`,
      title: '<i class="fas fa-users mr-2"></i>Manage Contributors - ' + year,
      bodyHtml: `
          <div class="text-center py-4">
            <i class="fas fa-spinner fa-spin text-gray-500"></i>
            <p class="text-gray-400 mt-2">Loading eligible users...</p>
          </div>`,
      footerHtml: `
          <button id="cancelContributorBtn-${year}" class="settings-button">Cancel</button>
          <button id="saveContributorBtn-${year}" class="settings-button" disabled>Save Changes</button>`,
      maxWidth: '600px',
      startHidden: true,
    });

    const cancelBtn = modal.querySelector(`#cancelContributorBtn-${year}`);
    const saveBtn = modal.querySelector(`#saveContributorBtn-${year}`);

    cancelBtn?.addEventListener('click', close);

    const originalState = new Map();
    const currentState = new Map();

    try {
      const response = await apiCall(
        `/api/aggregate-list/${year}/eligible-users`
      );
      const body = modal.querySelector('.settings-modal-body');

      if (!response.eligibleUsers || response.eligibleUsers.length === 0) {
        body.innerHTML =
          '<p class="text-gray-500 text-sm text-center py-4">No users have main lists for this year.</p>';
        saveBtn.disabled = true;
        return modal;
      }

      const eligibleUsers = response.eligibleUsers;
      const initialContributorCount = eligibleUsers.filter(
        (user) => user.is_contributor
      ).length;

      eligibleUsers.forEach((user) => {
        originalState.set(user.user_id, user.is_contributor);
        currentState.set(user.user_id, user.is_contributor);
      });

      let html = `
        <div class="mb-4 flex items-center justify-between flex-wrap gap-2">
          <span class="text-sm text-gray-400">
            <i class="fas fa-users mr-1"></i>
            <span id="contributor-count-${year}">${initialContributorCount}</span> of ${eligibleUsers.length} users selected as contributors
          </span>
          <div class="flex gap-2">
            <button id="selectAllBtn-${year}" class="settings-button" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;">Select All</button>
            <button id="deselectAllBtn-${year}" class="settings-button" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;">Deselect All</button>
          </div>
        </div>
        <div class="space-y-2 max-h-96 overflow-y-auto" id="user-list-${year}">
      `;

      eligibleUsers.forEach((user) => {
        const isChecked = user.is_contributor ? 'checked' : '';
        html += `
          <label class="flex items-center gap-3 p-2 bg-gray-900/50 rounded-sm cursor-pointer hover:bg-gray-800/50 transition border border-gray-700/50">
            <input type="checkbox" 
                   class="contributor-checkbox w-5 h-5 rounded-sm border-gray-600 bg-gray-800 text-purple-600 focus:ring-purple-500 focus:ring-offset-gray-900"
                   data-user-id="${user.user_id}" 
                   ${isChecked}>
            <div class="flex-1 min-w-0">
              <span class="text-white font-medium">${user.username || 'Unknown'}</span>
              <span class="text-gray-500 text-sm ml-2">(${user.album_count || 0} albums)</span>
            </div>
            <span class="text-xs text-gray-600 truncate max-w-[150px]">${user.list_name || ''}</span>
          </label>
        `;
      });

      html += '</div>';
      body.innerHTML = html;

      const updateCount = () => {
        const checkedCount = Array.from(currentState.values()).filter(
          (value) => value
        ).length;
        const countEl = doc.getElementById(`contributor-count-${year}`);
        if (countEl) {
          countEl.textContent = checkedCount;
        }

        const hasChanges = Array.from(originalState.entries()).some(
          ([userId, originalValue]) =>
            currentState.get(userId) !== originalValue
        );
        saveBtn.disabled = !hasChanges;
        saveBtn.textContent = hasChanges ? 'Save Changes' : 'No Changes';
      };

      body.querySelectorAll('.contributor-checkbox').forEach((checkbox) => {
        checkbox.addEventListener('change', (e) => {
          const userId = e.target.dataset.userId;
          const isChecked = e.target.checked;
          currentState.set(userId, isChecked);
          updateCount();
        });
      });

      const selectAllBtn = body.querySelector(`#selectAllBtn-${year}`);
      if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
          body.querySelectorAll('.contributor-checkbox').forEach((checkbox) => {
            const userId = checkbox.dataset.userId;
            checkbox.checked = true;
            currentState.set(userId, true);
          });
          updateCount();
        });
      }

      const deselectAllBtn = body.querySelector(`#deselectAllBtn-${year}`);
      if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => {
          body.querySelectorAll('.contributor-checkbox').forEach((checkbox) => {
            const userId = checkbox.dataset.userId;
            checkbox.checked = false;
            currentState.set(userId, false);
          });
          updateCount();
        });
      }

      updateCount();

      saveBtn.addEventListener('click', async () => {
        const hasChanges = Array.from(originalState.entries()).some(
          ([userId, originalValue]) =>
            currentState.get(userId) !== originalValue
        );

        if (!hasChanges) {
          showToast('No changes to save', 'info');
          return;
        }

        const finalContributorIds = Array.from(currentState.entries())
          .filter(([, isContributor]) => isContributor)
          .map(([userId]) => userId);

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
          const saveResponse = await apiCall(
            `/api/aggregate-list/${year}/contributors`,
            {
              method: 'PUT',
              body: JSON.stringify({ userIds: finalContributorIds }),
            }
          );

          if (saveResponse.success) {
            showToast(
              `Updated ${finalContributorIds.length} contributor${finalContributorIds.length !== 1 ? 's' : ''}`,
              'success'
            );

            categoryData.admin = null;
            await loadCategoryData('admin');
            close();
          } else {
            throw new Error(
              saveResponse.error || 'Failed to save contributors'
            );
          }
        } catch (error) {
          console.error('Error saving contributors:', error);
          const errorMsg =
            error.data?.error || error.message || 'Failed to save contributors';
          showToast(errorMsg, 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Changes';
        }
      });
    } catch (error) {
      console.error('Error loading contributor manager:', error);
      const body = modal.querySelector('.settings-modal-body');
      body.innerHTML =
        '<p class="text-red-400 text-sm text-center py-4">Error loading users. Please try again.</p>';
      saveBtn.disabled = true;
    }

    return modal;
  }

  async function handleShowContributorManager(year) {
    const modal = await createContributorModal(year);
    doc.body.appendChild(modal);

    setTimeoutFn(() => {
      modal.classList.remove('hidden');
    }, 10);
  }

  return {
    handleShowContributorManager,
  };
}
