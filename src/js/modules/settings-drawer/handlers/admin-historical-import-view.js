import { escapeHtml, escapeHtmlAttr } from '../../html-utils.js';

export function validateHistoricalListPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['Expected a JSON object'];
  }
  if (payload.version !== 1) errors.push('version must be 1');
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
  if (!Array.isArray(payload.albums)) errors.push('albums must be an array');
  return errors;
}

export async function defaultReadFileText(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(reader.error || new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

function renderMessageList(messages, className) {
  if (!messages?.length) return '';
  return `<ul class="mt-2 space-y-1 ${className}">${messages
    .map((message) => `<li>${escapeHtml(message)}</li>`)
    .join('')}</ul>`;
}

function renderUserOptions(users, selectedUserId) {
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
  if (record.commitResult?.status === 'imported') {
    const listId = record.commitResult.listId
      ? ` (list ${escapeHtml(record.commitResult.listId)})`
      : '';
    return `<div class="mt-2 text-sm text-green-400">Imported${listId}</div>`;
  }
  if (record.commitResult) {
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
      Target: ${escapeHtml(result.targetUsername || 'Unknown')} · Existing: ${escapeHtml(result.existingCanonicalCount ?? 0)} · New: ${escapeHtml(result.newCanonicalCount ?? 0)}
    </div>
    ${renderMessageList(result.warnings, 'text-xs text-yellow-400')}
    ${renderMessageList(result.errors, 'text-xs text-red-400')}`;
}

function renderRecord(record, users) {
  const result = record.previewResult;
  const listName =
    result?.listName ?? record.payload?.list?.name ?? 'Unavailable';
  const year = result?.year ?? record.payload?.list?.year ?? 'Unavailable';
  const albumCount =
    result?.albumCount ??
    (Array.isArray(record.payload?.albums)
      ? record.payload.albums.length
      : 'Unavailable');
  const clientId = escapeHtmlAttr(record.clientId);
  return `
    <div data-import-row data-client-id="${clientId}" class="border border-gray-700 bg-gray-800/50 rounded-sm p-3">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0 flex-1">
          <div class="font-medium text-white wrap-break-word">${escapeHtml(record.fileName)}</div>
          <div class="mt-1 text-xs text-gray-400 wrap-break-word">
            ${escapeHtml(listName)} · ${escapeHtml(year)} · ${escapeHtml(albumCount)} albums
          </div>
        </div>
        <div class="sm:w-56">
          <label class="block text-xs text-gray-400 mb-1" for="historical-user-${clientId}">Target user</label>
          <select id="historical-user-${clientId}" data-client-id="${clientId}" class="historical-import-user w-full bg-gray-700 text-white text-sm rounded px-2 py-2 border border-gray-600" required>
            <option value="">Select user</option>
            ${renderUserOptions(users, record.targetUserId)}
          </select>
        </div>
      </div>
      ${renderRecordStatus(record)}
    </div>`;
}

export function renderHistoricalImportRows(records, users) {
  if (records.length === 0) {
    return '<p class="text-sm text-gray-500 py-3">No files selected.</p>';
  }
  return records.map((record) => renderRecord(record, users)).join('');
}
