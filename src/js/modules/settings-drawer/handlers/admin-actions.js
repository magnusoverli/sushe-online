/**
 * Settings drawer admin action flows.
 *
 * Owns admin event actions and restore-database modal workflow.
 */

export function createSettingsAdminActions(deps = {}) {
  const doc =
    deps.doc || (typeof document !== 'undefined' ? document : undefined);
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  const fetchImpl =
    deps.fetchImpl ||
    (typeof fetch === 'function' ? (...args) => fetch(...args) : null);

  const {
    showConfirmation,
    apiCall,
    showToast,
    categoryData,
    loadCategoryData,
    createSettingsModalBase,
  } = deps;

  function parseDownloadFilename(contentDisposition) {
    if (!contentDisposition || typeof contentDisposition !== 'string') {
      return 'sushe-db.dump';
    }

    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match && utf8Match[1]) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch (_error) {
        return utf8Match[1];
      }
    }

    const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    if (filenameMatch && filenameMatch[1]) {
      return filenameMatch[1];
    }

    return 'sushe-db.dump';
  }

  function triggerBlobDownload(blob, fileName) {
    if (
      !win ||
      !doc ||
      !win.URL ||
      typeof win.URL.createObjectURL !== 'function'
    ) {
      return false;
    }

    const objectUrl = win.URL.createObjectURL(blob);
    const link = doc.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.style.display = 'none';
    doc.body.appendChild(link);
    link.click();
    doc.body.removeChild(link);
    win.URL.revokeObjectURL(objectUrl);
    return true;
  }

  async function readBackupBlobWithProgress(response, progressText) {
    const reader = response?.body?.getReader?.();
    if (!reader) {
      return response.blob();
    }

    const contentLengthHeader = response.headers?.get?.('content-length');
    const totalBytes = Number.parseInt(contentLengthHeader || '', 10);
    const hasTotalBytes = Number.isFinite(totalBytes) && totalBytes > 0;

    const chunks = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      chunks.push(value);
      receivedBytes += value.byteLength;

      const receivedMB = (receivedBytes / (1024 * 1024)).toFixed(1);
      if (hasTotalBytes) {
        const percent = Math.min(
          100,
          Math.round((receivedBytes / totalBytes) * 100)
        );
        progressText.textContent = `Downloading backup... ${percent}% (${receivedMB} MB)`;
      } else {
        progressText.textContent = `Downloading backup... ${receivedMB} MB`;
      }
    }

    return new Blob(chunks, { type: 'application/octet-stream' });
  }

  function isNetworkFetchError(error) {
    const message = error?.message || '';
    return (
      error instanceof TypeError ||
      /failed to fetch|networkerror|err_socket_not_connected/i.test(message)
    );
  }

  async function fetchBackupResponse(progressText) {
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fetchImpl('/admin/backup', {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
        });
      } catch (error) {
        const hasAttemptsRemaining = attempt < maxAttempts;
        if (!hasAttemptsRemaining || !isNetworkFetchError(error)) {
          throw error;
        }

        progressText.textContent =
          'Connection interrupted. Retrying backup download...';
        await new Promise((resolve) => setTimeoutFn(resolve, 450));
      }
    }

    throw new Error('Failed to create backup');
  }

  function mapRestoreErrorMessage(error) {
    switch (error?.code) {
      case 'RESTORE_NO_FILE_UPLOADED':
        return 'No backup file was uploaded. Please choose a .dump file and try again.';
      case 'RESTORE_INVALID_DUMP':
        return 'Invalid backup file. Please select a PostgreSQL custom dump (.dump).';
      case 'RESTORE_FILE_TOO_LARGE':
        return 'Backup file is too large for restore. Try a smaller dump or increase restore limits.';
      case 'RESTORE_PRECHECK_FAILED':
        return 'Backup validation failed before restore. Please verify the dump was created correctly.';
      case 'RESTORE_TOOL_NOT_FOUND':
        return 'Restore tools are not available on the server. Contact an administrator.';
      case 'RESTORE_TIMEOUT':
        return 'Database restore timed out. Please try again with a smaller backup.';
      case 'RESTORE_PROCESS_FAILED':
        return 'Restore failed while applying the backup. Check server logs for details.';
      case 'RESTORE_UPLOAD_FAILED':
        return 'Upload failed before restore started. Please try again.';
      case 'RESTORE_IN_PROGRESS':
        return 'Another restore is already running. Wait for it to finish and try again.';
      case 'RESTORE_OPERATION_NOT_FOUND':
        return 'Could not find restore status. The server may have restarted already.';
      default:
        return error?.message || 'Failed to restore database';
    }
  }

  function mapRestoreStatusMessage(status) {
    switch (status) {
      case 'received':
        return 'Backup uploaded. Preparing restore...';
      case 'validating':
        return 'Validating backup...';
      case 'preflight':
        return 'Validating backup...';
      case 'dropping':
        return 'Preparing restore...';
      case 'restoring':
        return 'Restoring data...';
      case 'finalizing':
        return 'Restore completed successfully.';
      case 'logout_pending':
        return 'You will be logged out shortly...';
      case 'restarting':
        return 'Server is restarting...';
      case 'completed':
        return 'Done - refreshing...';
      case 'failed':
        return 'Restore failed.';
      default:
        return 'Restore in progress...';
    }
  }

  async function waitForRestoreStatus(restoreId, progressText) {
    const maxAttempts = 600;
    let sawRestarting = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const status = await apiCall(
          `/admin/restore/${encodeURIComponent(restoreId)}/status`
        );

        if (status?.status) {
          progressText.textContent = mapRestoreStatusMessage(status.status);
        }

        if (status?.status === 'failed') {
          const restoreError = new Error(
            status.errorMessage || 'Restore failed on server'
          );
          restoreError.code = status.errorCode || 'RESTORE_PROCESS_FAILED';
          throw restoreError;
        }

        if (status?.status === 'restarting' || status?.status === 'completed') {
          sawRestarting = true;
          return;
        }
      } catch (error) {
        if (sawRestarting || error?.code === 'RESTORE_OPERATION_NOT_FOUND') {
          return;
        }
        throw error;
      }

      await new Promise((resolve) => setTimeoutFn(resolve, 500));
    }
  }

  function scheduleRestoreLogoutFallback(progressText) {
    if (!win || !win.location) {
      return;
    }

    const restoreLogoutFallbackDelayMs = 6500;
    setTimeoutFn(() => {
      const href =
        typeof win.location.href === 'string' ? win.location.href : '';
      if (href.includes('/login') || href.includes('/logout')) {
        return;
      }

      progressText.textContent = 'Logging out...';
      win.location.href = '/logout';
    }, restoreLogoutFallbackDelayMs);
  }

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

  async function handleDownloadBackup(event) {
    if (event?.preventDefault) {
      event.preventDefault();
    }

    if (!fetchImpl || !win) {
      if (win) {
        win.location.href = '/admin/backup';
      }
      return;
    }

    const { modal, close } = createSettingsModalBase({
      id: 'downloadBackupModal',
      title:
        '<i class="fas fa-download mr-2 text-blue-400"></i>Download Backup',
      bodyHtml: `
          <div id="downloadBackupProgress" class="mt-2">
            <div class="flex items-center gap-2 text-sm text-gray-400">
              <i id="downloadBackupSpinner" class="fas fa-spinner fa-spin"></i>
              <span id="downloadBackupProgressText">Preparing backup...</span>
            </div>
          </div>
          <div id="downloadBackupError" class="text-red-500 text-sm mt-3 hidden"></div>`,
      footerHtml:
        '<button id="closeDownloadBackupModalBtn" class="settings-button">Close</button>',
      maxWidth: '500px',
      startHidden: true,
    });

    doc.body.appendChild(modal);

    setTimeoutFn(() => {
      modal.classList.remove('hidden');
    }, 10);

    const closeBtn = modal.querySelector('#closeDownloadBackupModalBtn');
    const spinnerEl = modal.querySelector('#downloadBackupSpinner');
    const progressText = modal.querySelector('#downloadBackupProgressText');
    const errorEl = modal.querySelector('#downloadBackupError');

    const closeModal = () => {
      modal.classList.add('hidden');
      setTimeoutFn(() => {
        if (doc.body.contains(modal)) {
          doc.body.removeChild(modal);
        }
      }, 300);
      close();
    };

    closeBtn?.addEventListener('click', closeModal);
    if (closeBtn) {
      closeBtn.disabled = true;
    }

    try {
      progressText.textContent = 'Generating backup...';

      const response = await fetchBackupResponse(progressText);

      if (response.status === 401) {
        win.location.href = '/login';
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to create backup');
      }

      progressText.textContent = 'Downloading backup...';

      const blob = await readBackupBlobWithProgress(response, progressText);
      const contentDisposition = response.headers.get('content-disposition');
      const fileName = parseDownloadFilename(contentDisposition);
      const downloaded = triggerBlobDownload(blob, fileName);

      if (!downloaded) {
        win.location.href = '/admin/backup';
        return;
      }

      progressText.textContent = 'Backup ready.';
      spinnerEl?.classList.remove('fa-spinner', 'fa-spin');
      spinnerEl?.classList.add('fa-check-circle', 'text-green-400');
      setTimeoutFn(() => {
        closeModal();
      }, 1200);
    } catch (error) {
      console.error('Error downloading backup:', error);

      if (isNetworkFetchError(error) && win?.location) {
        progressText.textContent =
          'Connection interrupted. Switching to direct download...';
        if (closeBtn) {
          closeBtn.disabled = false;
        }

        setTimeoutFn(() => {
          closeModal();
          win.location.href = '/admin/backup';
        }, 150);
        return;
      }

      errorEl.textContent = error.message || 'Failed to download backup';
      errorEl.classList.remove('hidden');
      progressText.textContent = 'Backup download failed.';
      spinnerEl?.classList.remove('fa-spinner', 'fa-spin');
      spinnerEl?.classList.add('fa-exclamation-circle', 'text-red-500');
      if (closeBtn) {
        closeBtn.disabled = false;
      }
    }
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

      if (result?.restoreId) {
        await waitForRestoreStatus(result.restoreId, progressText);
      }

      scheduleRestoreLogoutFallback(progressText);
    } catch (error) {
      console.error('Error restoring database:', error);
      errorEl.textContent = mapRestoreErrorMessage(error);
      errorEl.classList.remove('hidden');
      progressEl.classList.add('hidden');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Restore Database';
    }
  }

  return {
    handleAdminEventAction,
    handleDownloadBackup,
    handleRestoreDatabase,
  };
}
