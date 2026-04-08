/**
 * Settings drawer admin action flows.
 *
 * Owns admin event actions and restore-database modal workflow.
 */

export function createSettingsAdminActions(deps = {}) {
  const doc =
    deps.doc || (typeof document !== 'undefined' ? document : undefined);
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;

  const {
    showConfirmation,
    apiCall,
    showToast,
    categoryData,
    loadCategoryData,
    createSettingsModalBase,
  } = deps;

  async function handleAdminEventAction(eventId, action, eventData) {
    try {
      let title = 'Confirm Action';
      let message = 'Are you sure you want to proceed with this action?';
      let confirmText = 'Confirm';

      if (
        action === 'approve' &&
        eventData?.event_type === 'account_approval'
      ) {
        title = 'Approve User Registration';
        const username = eventData.data?.username || 'this user';
        const email = eventData.data?.email || '';
        message = `Are you sure you want to approve the registration for <strong>${username}</strong>?`;
        if (email) {
          message += `<br><span class="text-sm text-gray-400">${email}</span>`;
        }
        confirmText = 'Approve User';
      } else if (
        action === 'reject' &&
        eventData?.event_type === 'account_approval'
      ) {
        title = 'Reject User Registration';
        const username = eventData.data?.username || 'this user';
        const email = eventData.data?.email || '';
        message = `Are you sure you want to reject the registration for <strong>${username}</strong>?`;
        if (email) {
          message += `<br><span class="text-sm text-gray-400">${email}</span>`;
        }
        message +=
          '<br><br><span class="text-yellow-400">This user will not be able to access the application.</span>';
        confirmText = 'Reject User';
      }

      const confirmed = await showConfirmation(
        title,
        message,
        null,
        confirmText
      );

      if (!confirmed) {
        return;
      }

      const response = await apiCall(
        `/api/admin/events/${eventId}/action/${action}`,
        {
          method: 'POST',
        }
      );

      if (response.success) {
        showToast(
          response.message || 'Action completed successfully',
          'success'
        );
        categoryData.admin = null;
        await loadCategoryData('admin');
      }
    } catch (error) {
      console.error('Error executing event action:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to execute action';
      showToast(errorMsg, 'error');
    }
  }

  async function handleRestoreDatabase() {
    const modal = await createRestoreModal();
    doc.body.appendChild(modal);

    setTimeoutFn(() => {
      modal.classList.remove('hidden');
    }, 10);
  }

  async function createRestoreModal() {
    const { modal, close } = createSettingsModalBase({
      id: 'restoreDatabaseModal',
      title: '<i class="fas fa-upload mr-2 text-red-500"></i>Restore Database',
      bodyHtml: `
          <div class="bg-red-900/20 border border-red-800/50 rounded-lg p-4 mb-4">
            <p class="text-red-400 text-sm font-semibold mb-2">⚠️ Warning</p>
            <p class="text-gray-300 text-sm">This will replace the entire database with the backup file. All current data will be permanently lost. The server will restart automatically after restoration.</p>
          </div>
          <form id="restoreDatabaseForm">
            <div class="settings-form-group">
              <label class="settings-label" for="backupFileInput">Backup File (.dump)</label>
              <input type="file" id="backupFileInput" class="settings-input" accept=".dump" required />
              <p class="settings-description">Select a PostgreSQL dump file to restore</p>
            </div>
            <div id="restoreError" class="text-red-500 text-sm mt-2 hidden"></div>
            <div id="restoreProgress" class="hidden mt-4">
              <div class="flex items-center gap-2 text-sm text-gray-400">
                <i class="fas fa-spinner fa-spin"></i>
                <span id="restoreProgressText">Uploading backup...</span>
              </div>
            </div>
          </form>`,
      footerHtml: `
          <button id="cancelRestoreBtn" class="settings-button">Cancel</button>
          <button id="confirmRestoreBtn" class="settings-button settings-button-danger" disabled>Restore Database</button>`,
      maxWidth: '500px',
      startHidden: true,
    });

    const cancelBtn = modal.querySelector('#cancelRestoreBtn');
    const confirmBtn = modal.querySelector('#confirmRestoreBtn');
    const form = modal.querySelector('#restoreDatabaseForm');
    const fileInput = modal.querySelector('#backupFileInput');
    const errorEl = modal.querySelector('#restoreError');

    cancelBtn?.addEventListener('click', close);

    fileInput.addEventListener('change', () => {
      const hasFile = fileInput.files && fileInput.files.length > 0;
      confirmBtn.disabled = !hasFile;
      errorEl.classList.add('hidden');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleConfirmRestore(modal);
    });

    confirmBtn.addEventListener('click', async () => {
      await handleConfirmRestore(modal);
    });

    return modal;
  }

  async function handleConfirmRestore(modal) {
    const fileInput = modal.querySelector('#backupFileInput');
    const errorEl = modal.querySelector('#restoreError');
    const progressEl = modal.querySelector('#restoreProgress');
    const progressText = modal.querySelector('#restoreProgressText');
    const confirmBtn = modal.querySelector('#confirmRestoreBtn');

    const closeModal = () => {
      modal.classList.add('hidden');
      setTimeoutFn(() => {
        if (doc.body.contains(modal)) {
          doc.body.removeChild(modal);
        }
      }, 300);
    };

    if (!fileInput.files || fileInput.files.length === 0) {
      errorEl.textContent = 'Please select a backup file';
      errorEl.classList.remove('hidden');
      return;
    }

    const file = fileInput.files[0];
    if (!file.name.endsWith('.dump')) {
      errorEl.textContent = 'Please select a valid .dump file';
      errorEl.classList.remove('hidden');
      return;
    }

    errorEl.classList.add('hidden');
    progressEl.classList.remove('hidden');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Restoring...';

    try {
      const formData = new FormData();
      formData.append('backup', file);

      progressText.textContent = 'Uploading backup...';

      const result = await apiCall('/admin/restore', {
        method: 'POST',
        body: formData,
      });

      progressText.textContent =
        result.message || 'Restore completed. Server restarting...';

      showToast(
        'Database restored successfully. Server will restart...',
        'success'
      );

      setTimeoutFn(() => {
        closeModal();
      }, 2000);
    } catch (error) {
      console.error('Error restoring database:', error);
      errorEl.textContent = error.message || 'Failed to restore database';
      errorEl.classList.remove('hidden');
      progressEl.classList.add('hidden');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Restore Database';
    }
  }

  return {
    handleAdminEventAction,
    handleRestoreDatabase,
  };
}
