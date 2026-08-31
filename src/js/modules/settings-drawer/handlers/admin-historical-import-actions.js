import { escapeHtml, escapeHtmlAttr } from '../../html-utils.js';

const PREVIEW_URL = '/api/admin/historical-list-import/preview';
const COMMIT_URL = '/api/admin/historical-list-import/commit';

function validateHistoricalListPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['Expected a JSON object'];
  }

  if (payload.version !== 1) {
    errors.push('version must be 1');
  }

  if (!payload.list || typeof payload.list !== 'object') {
    errors.push('list must be an object');
  } else {
    if (typeof payload.list.name !== 'string') {
      errors.push('list.name must be a string');
    }
    if (!Number.isInteger(payload.list.year)) {
      errors.push('list.year must be an integer');
    }
  }

  if (!Array.isArray(payload.albums)) {
    errors.push('albums must be an array');
  }

  return errors;
}

async function defaultReadFileText(file) {
  if (typeof file.text === 'function') {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(reader.error || new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export function createSettingsAdminHistoricalImportActions(deps = {}) {
  const {
    apiCall,
    showToast = () => {},
    categoryData,
    createSettingsModalBase,
    readFileText = defaultReadFileText,
  } = deps;

  let nextClientId = 1;

  function escapeValue(value) {
    return escapeHtml(String(value));
  }

  function handleHistoricalListImport() {
    let records = [];
    let previewHash = null;
    let previewCanCommit = false;
    let requestInProgress = false;
    let fileGeneration = 0;
    let stateRevision = 0;
    let disposed = false;

    const users = categoryData?.admin?.users || [];
    const { modal, close } = createSettingsModalBase({
      id: 'historicalListImportModal',
      appendToBody: true,
      title: 'Historical List Import',
      maxWidth: '64rem',
      maxHeight: '90vh',
      bodyStyle: 'overflow-y: auto;',
      bodyHtml: `
        <div class="space-y-4">
          <div>
            <label for="historicalImportFiles" class="settings-label">List JSON files</label>
            <input id="historicalImportFiles" type="file" accept=".json,application/json" multiple class="block w-full text-sm text-gray-300 mt-2 file:mr-3 file:rounded-sm file:border-0 file:bg-gray-700 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-gray-600" />
            <p class="settings-description mt-2">Each file must use the version 1 historical list format. Select a target user for every file before previewing.</p>
          </div>
          <div id="historicalImportStatus" class="hidden text-sm text-gray-300" role="status"></div>
          <div id="historicalImportRows" class="space-y-3"></div>
        </div>`,
      footerHtml: `
        <button id="cancelHistoricalImportBtn" class="settings-button">Cancel</button>
        <button id="previewHistoricalImportBtn" class="settings-button" disabled>Preview</button>
        <button id="commitHistoricalImportBtn" class="settings-button" disabled>Commit Import</button>`,
      onClose: () => {
        disposed = true;
        fileGeneration += 1;
        records = [];
      },
    });

    const fileInput = modal.querySelector('#historicalImportFiles');
    const rowsContainer = modal.querySelector('#historicalImportRows');
    const statusElement = modal.querySelector('#historicalImportStatus');
    const cancelButton = modal.querySelector('#cancelHistoricalImportBtn');
    const previewButton = modal.querySelector('#previewHistoricalImportBtn');
    const commitButton = modal.querySelector('#commitHistoricalImportBtn');

    function setStatus(message = '', type = 'info') {
      if (!statusElement) return;

      statusElement.textContent = message;
      statusElement.classList.toggle('hidden', !message);
      statusElement.classList.toggle('text-red-400', type === 'error');
      statusElement.classList.toggle('text-green-400', type === 'success');
      statusElement.classList.toggle(
        'text-gray-300',
        type !== 'error' && type !== 'success'
      );
    }

    function getRequestImports() {
      return records.map((record) => ({
        clientId: record.clientId,
        fileName: record.fileName,
        targetUserId: record.targetUserId,
        payload: record.payload,
      }));
    }

    function updateButtons() {
      const hasInvalidRecord = records.some(
        (record) => record.errors.length > 0 || !record.targetUserId
      );
      previewButton.disabled =
        requestInProgress || records.length === 0 || hasInvalidRecord;
      commitButton.disabled = requestInProgress || !previewCanCommit;
    }

    function renderMessageList(messages, className) {
      if (!messages?.length) return '';

      return `<ul class="mt-2 space-y-1 ${className}">${messages
        .map((message) => `<li>${escapeHtml(message)}</li>`)
        .join('')}</ul>`;
    }

    function renderUserOptions(selectedUserId) {
      return users
        .map((user) => {
          const userId = String(user._id || '');
          const label = user.username || user.email || 'Unnamed user';
          const selected = userId === selectedUserId ? ' selected' : '';
          return `<option value="${escapeHtmlAttr(userId)}"${selected}>${escapeHtml(label)}</option>`;
        })
        .join('');
    }

    function renderRecordStatus(record) {
      if (record.commitResult) {
        if (record.commitResult.status === 'imported') {
          const listId = record.commitResult.listId
            ? ` (list ${escapeValue(record.commitResult.listId)})`
            : '';
          return `<div class="mt-2 text-sm text-green-400">Imported${listId}</div>`;
        }

        return `<div class="mt-2 text-sm text-red-400">Failed: ${escapeHtml(record.commitResult.error || 'Import failed')}</div>`;
      }

      if (record.errors.length > 0) {
        return renderMessageList(record.errors, 'text-sm text-red-400');
      }

      if (!record.previewResult) {
        return '<div class="mt-2 text-xs text-gray-500">Ready for preview</div>';
      }

      const result = record.previewResult;
      return `
        <div class="mt-2 text-xs text-gray-300">
          Target: ${escapeHtml(result.targetUsername || 'Unknown')} · Existing: ${escapeValue(result.existingCanonicalCount ?? 0)} · New: ${escapeValue(result.newCanonicalCount ?? 0)}
        </div>
        ${renderMessageList(result.warnings, 'text-xs text-yellow-400')}
        ${renderMessageList(result.errors, 'text-xs text-red-400')}`;
    }

    function renderRows() {
      if (!rowsContainer) return;

      if (records.length === 0) {
        rowsContainer.innerHTML =
          '<p class="text-sm text-gray-500 py-3">No files selected.</p>';
        updateButtons();
        return;
      }

      rowsContainer.innerHTML = records
        .map((record) => {
          const listName =
            record.previewResult?.listName ??
            record.payload?.list?.name ??
            'Unavailable';
          const year =
            record.previewResult?.year ??
            record.payload?.list?.year ??
            'Unavailable';
          const albumCount =
            record.previewResult?.albumCount ??
            (Array.isArray(record.payload?.albums)
              ? record.payload.albums.length
              : 'Unavailable');

          return `
            <div data-import-row data-client-id="${escapeHtmlAttr(record.clientId)}" class="border border-gray-700 bg-gray-800/50 rounded-sm p-3">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0 flex-1">
                  <div class="font-medium text-white wrap-break-word">${escapeHtml(record.fileName)}</div>
                  <div class="mt-1 text-xs text-gray-400 wrap-break-word">
                    ${escapeValue(listName)} · ${escapeValue(year)} · ${escapeValue(albumCount)} albums
                  </div>
                </div>
                <div class="sm:w-56">
                  <label class="block text-xs text-gray-400 mb-1" for="historical-user-${escapeHtmlAttr(record.clientId)}">Target user</label>
                  <select id="historical-user-${escapeHtmlAttr(record.clientId)}" data-client-id="${escapeHtmlAttr(record.clientId)}" class="historical-import-user w-full bg-gray-700 text-white text-sm rounded px-2 py-2 border border-gray-600" required>
                    <option value="">Select user</option>
                    ${renderUserOptions(record.targetUserId)}
                  </select>
                </div>
              </div>
              ${renderRecordStatus(record)}
            </div>`;
        })
        .join('');

      updateButtons();
    }

    function invalidatePreview() {
      stateRevision += 1;
      requestInProgress = false;
      previewHash = null;
      previewCanCommit = false;
      records.forEach((record) => {
        record.previewResult = null;
        record.commitResult = null;
      });
      setStatus('');
    }

    async function parseFile(file, clientId) {
      const fileName = String(file.name || '');
      const record = {
        clientId,
        fileName,
        targetUserId: '',
        payload: null,
        errors: [],
        previewResult: null,
        commitResult: null,
      };

      if (!fileName.toLowerCase().endsWith('.json')) {
        record.errors.push('File must have a .json extension');
        return record;
      }

      try {
        const text = await readFileText(file);
        record.payload = JSON.parse(text);
        record.errors = validateHistoricalListPayload(record.payload);
      } catch (error) {
        record.errors.push(
          error instanceof SyntaxError
            ? 'Invalid JSON'
            : error?.message || 'Failed to read file'
        );
      }

      return record;
    }

    fileInput?.addEventListener('change', async () => {
      const generation = ++fileGeneration;
      invalidatePreview();
      requestInProgress = true;
      records = [];
      setStatus('Reading files...');
      updateButtons();

      const selectedFiles = Array.from(fileInput.files || []);
      const pendingRecords = selectedFiles.map((file) =>
        parseFile(file, `historical-import-${nextClientId++}`)
      );
      const parsedRecords = await Promise.all(pendingRecords);

      if (disposed || generation !== fileGeneration) return;

      records = parsedRecords;
      requestInProgress = false;
      setStatus('');
      renderRows();
    });

    rowsContainer?.addEventListener('change', (event) => {
      const select = event.target;
      if (!select?.matches?.('.historical-import-user')) return;

      const record = records.find(
        (item) => item.clientId === select.dataset.clientId
      );
      if (!record) return;

      record.targetUserId = select.value;
      invalidatePreview();
      renderRows();
    });

    previewButton?.addEventListener('click', async () => {
      if (previewButton.disabled) return;

      const requestRevision = stateRevision;
      requestInProgress = true;
      previewCanCommit = false;
      setStatus('Generating preview...');
      updateButtons();

      try {
        const response = await apiCall(PREVIEW_URL, {
          method: 'POST',
          body: JSON.stringify({ imports: getRequestImports() }),
        });
        if (disposed || requestRevision !== stateRevision) return;

        previewHash = response.previewHash;
        const resultsByClientId = new Map(
          (response.imports || []).map((result) => [result.clientId, result])
        );
        records.forEach((record) => {
          record.previewResult = resultsByClientId.get(record.clientId) || null;
        });

        previewCanCommit =
          response.canCommit === true &&
          typeof previewHash === 'string' &&
          previewHash.length > 0 &&
          records.every((record) => record.previewResult?.canCommit === true);
        setStatus(
          previewCanCommit
            ? 'Preview complete. Ready to commit.'
            : 'Preview found errors that must be resolved.',
          previewCanCommit ? 'success' : 'error'
        );
      } catch (error) {
        if (disposed || requestRevision !== stateRevision) return;
        previewHash = null;
        previewCanCommit = false;
        setStatus(error?.error || error?.message || 'Preview failed', 'error');
        showToast('Historical import preview failed', 'error');
      } finally {
        if (!disposed && requestRevision === stateRevision) {
          requestInProgress = false;
          renderRows();
        }
      }
    });

    commitButton?.addEventListener('click', async () => {
      if (commitButton.disabled || !previewHash) return;

      const requestRevision = stateRevision;
      requestInProgress = true;
      setStatus('Importing lists...');
      updateButtons();

      try {
        const response = await apiCall(COMMIT_URL, {
          method: 'POST',
          body: JSON.stringify({
            imports: getRequestImports(),
            previewHash,
          }),
        });
        if (disposed || requestRevision !== stateRevision) return;

        const resultsByClientId = new Map(
          (response.results || []).map((result) => [result.clientId, result])
        );
        records.forEach((record) => {
          record.commitResult = resultsByClientId.get(record.clientId) || {
            status: 'failed',
            error: 'No result returned',
          };
        });

        previewHash = null;
        previewCanCommit = false;
        const summary = `${response.imported || 0} imported, ${response.failed || 0} failed`;
        setStatus(summary, response.failed ? 'error' : 'success');
        showToast(
          `Historical import complete: ${summary}`,
          response.failed ? 'error' : 'success'
        );
      } catch (error) {
        if (disposed || requestRevision !== stateRevision) return;
        previewHash = null;
        previewCanCommit = false;
        setStatus(error?.error || error?.message || 'Import failed', 'error');
        showToast('Historical list import failed', 'error');
      } finally {
        if (!disposed && requestRevision === stateRevision) {
          requestInProgress = false;
          renderRows();
        }
      }
    });

    cancelButton?.addEventListener('click', close);
    renderRows();

    return modal;
  }

  return { handleHistoricalListImport };
}

export { validateHistoricalListPayload };
