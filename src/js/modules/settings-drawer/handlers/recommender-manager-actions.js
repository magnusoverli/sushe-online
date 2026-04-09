/**
 * Settings drawer recommender manager flows.
 *
 * Owns the recommender access modal and save workflow.
 */

export function createSettingsRecommenderManagerActions(deps = {}) {
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

  async function createRecommenderModal(year) {
    const { modal, close } = createSettingsModalBase({
      id: `recommender-modal-${year}`,
      title:
        '<i class="fas fa-thumbs-up text-blue-400 mr-2"></i>Manage Recommenders - ' +
        year,
      bodyHtml: `
          <div class="text-center py-4">
            <i class="fas fa-spinner fa-spin text-gray-500"></i>
            <p class="text-gray-400 mt-2">Loading users...</p>
          </div>`,
      footerHtml: `
          <button id="cancelRecommenderBtn-${year}" class="settings-button">Cancel</button>
          <button id="saveRecommenderBtn-${year}" class="settings-button" disabled>Save Changes</button>`,
      maxWidth: '600px',
      startHidden: true,
    });

    const cancelBtn = modal.querySelector(`#cancelRecommenderBtn-${year}`);
    const saveBtn = modal.querySelector(`#saveRecommenderBtn-${year}`);

    cancelBtn?.addEventListener('click', close);

    const originalState = new Map();
    const currentState = new Map();

    try {
      const response = await apiCall(
        `/api/recommendations/${year}/eligible-users`
      );
      const body = modal.querySelector('.settings-modal-body');

      if (!response.users || response.users.length === 0) {
        body.innerHTML =
          '<p class="text-gray-500 text-sm text-center py-4">No approved users found.</p>';
        saveBtn.disabled = true;
        return modal;
      }

      const users = response.users;
      const initialSelectedCount = users.filter(
        (user) => user.has_access
      ).length;

      users.forEach((user) => {
        originalState.set(user.user_id, user.has_access);
        currentState.set(user.user_id, user.has_access);
      });

      let html = `
        <div class="mb-3 p-3 bg-blue-900/30 border border-blue-700/50 rounded-sm">
          <p class="text-sm text-blue-300">
            <i class="fas fa-info-circle mr-1"></i>
            By default, all users can recommend albums. Select specific users below to restrict recommendations to only those users.
          </p>
        </div>
        <div class="mb-4 flex items-center justify-between flex-wrap gap-2">
          <span class="text-sm text-gray-400">
            <i class="fas fa-user-check mr-1"></i>
            <span id="recommender-count-${year}">${initialSelectedCount}</span> of ${users.length} users selected
            ${initialSelectedCount === 0 ? '<span class="text-green-400 ml-1">(all users can recommend)</span>' : '<span class="text-yellow-400 ml-1">(restricted)</span>'}
          </span>
          <div class="flex gap-2">
            <button id="selectAllRecsBtn-${year}" class="settings-button" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;">Select All</button>
            <button id="deselectAllRecsBtn-${year}" class="settings-button" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;">Clear All</button>
          </div>
        </div>
        <div class="space-y-2 max-h-96 overflow-y-auto" id="recommender-list-${year}">
      `;

      users.forEach((user) => {
        const isChecked = user.has_access ? 'checked' : '';
        html += `
          <label class="flex items-center gap-3 p-2 bg-gray-900/50 rounded-sm cursor-pointer hover:bg-gray-800/50 transition border border-gray-700/50">
            <input type="checkbox" 
                   class="recommender-checkbox w-5 h-5 rounded-sm border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-900"
                   data-user-id="${user.user_id}" 
                   ${isChecked}>
            <div class="flex-1 min-w-0">
              <span class="text-white font-medium">${user.username || 'Unknown'}</span>
            </div>
            <span class="text-xs text-gray-600 truncate max-w-[150px]">${user.email || ''}</span>
          </label>
        `;
      });

      html += '</div>';
      body.innerHTML = html;

      const updateCountAndStatus = () => {
        const checkedCount = Array.from(currentState.values()).filter(
          (value) => value
        ).length;
        const countEl = doc.getElementById(`recommender-count-${year}`);
        if (countEl) {
          const statusText =
            checkedCount === 0
              ? '<span class="text-green-400 ml-1">(all users can recommend)</span>'
              : '<span class="text-yellow-400 ml-1">(restricted)</span>';
          countEl.parentElement.innerHTML = `
            <i class="fas fa-user-check mr-1"></i>
            <span id="recommender-count-${year}">${checkedCount}</span> of ${users.length} users selected
            ${statusText}
          `;
        }

        const hasChanges = Array.from(originalState.entries()).some(
          ([userId, originalValue]) =>
            currentState.get(userId) !== originalValue
        );
        saveBtn.disabled = !hasChanges;
        saveBtn.textContent = hasChanges ? 'Save Changes' : 'No Changes';
      };

      modal.querySelectorAll('.recommender-checkbox').forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
          const userId = checkbox.dataset.userId;
          currentState.set(userId, checkbox.checked);
          updateCountAndStatus();
        });
      });

      const selectAllBtn = modal.querySelector(`#selectAllRecsBtn-${year}`);
      const deselectAllBtn = modal.querySelector(`#deselectAllRecsBtn-${year}`);

      selectAllBtn.addEventListener('click', () => {
        modal.querySelectorAll('.recommender-checkbox').forEach((checkbox) => {
          checkbox.checked = true;
          currentState.set(checkbox.dataset.userId, true);
        });
        updateCountAndStatus();
      });

      deselectAllBtn.addEventListener('click', () => {
        modal.querySelectorAll('.recommender-checkbox').forEach((checkbox) => {
          checkbox.checked = false;
          currentState.set(checkbox.dataset.userId, false);
        });
        updateCountAndStatus();
      });

      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
          const selectedUserIds = Array.from(currentState.entries())
            .filter(([, isSelected]) => isSelected)
            .map(([userId]) => userId);

          const saveResponse = await apiCall(
            `/api/recommendations/${year}/access`,
            {
              method: 'PUT',
              body: JSON.stringify({ userIds: selectedUserIds }),
            }
          );

          if (saveResponse.success) {
            showToast(
              selectedUserIds.length === 0
                ? `Recommendations for ${year} are now open to all users`
                : `Recommendation access updated for ${year}`,
              'success'
            );
            close();

            categoryData.admin = null;
            await loadCategoryData('admin');
          } else {
            throw new Error(saveResponse.error || 'Failed to save');
          }
        } catch (error) {
          console.error('Error saving recommender access:', error);
          const errorMsg =
            error.data?.error || error.message || 'Failed to save access list';
          showToast(errorMsg, 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Changes';
        }
      });
    } catch (error) {
      console.error('Error loading recommender manager:', error);
      const body = modal.querySelector('.settings-modal-body');
      body.innerHTML =
        '<p class="text-red-400 text-sm text-center py-4">Error loading users. Please try again.</p>';
      saveBtn.disabled = true;
    }

    return modal;
  }

  async function handleShowRecommenderManager(year) {
    const modal = await createRecommenderModal(year);
    doc.body.appendChild(modal);

    setTimeoutFn(() => {
      modal.classList.remove('hidden');
    }, 10);
  }

  return {
    handleShowRecommenderManager,
  };
}
