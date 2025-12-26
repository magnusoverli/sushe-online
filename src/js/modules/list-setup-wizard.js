/**
 * List Setup Wizard Module
 * Prompts users to complete list setup (year assignment + official designation)
 */

import { apiCall } from './utils.js';
import { showToast } from './ui-utils.js';

// State for the wizard
let setupData = null;
const pendingUpdates = new Map();

/**
 * Check if user needs to complete list setup and show wizard if needed
 */
export async function checkListSetupStatus() {
  try {
    const status = await apiCall('/api/lists/setup-status');

    // Check if wizard was dismissed recently
    if (status.dismissedUntil) {
      const dismissedUntil = new Date(status.dismissedUntil);
      if (dismissedUntil > new Date()) {
        console.log('List setup wizard dismissed until', dismissedUntil);
        return;
      }
    }

    if (status.needsSetup) {
      setupData = status;
      showListSetupWizard();
    }
  } catch (err) {
    console.warn('Failed to check list setup status:', err);
    // Don't show error to user - this is a non-critical feature
  }
}

/**
 * Show the list setup wizard modal
 */
function showListSetupWizard() {
  const modal = document.getElementById('listSetupWizard');
  const content = document.getElementById('listSetupContent');

  if (!modal || !content) {
    console.warn('List setup wizard elements not found');
    return;
  }

  pendingUpdates.clear();
  renderWizardContent(content);
  modal.classList.remove('hidden');

  // Setup event handlers
  const saveBtn = document.getElementById('listSetupSave');
  const dismissBtn = document.getElementById('listSetupDismiss');

  if (saveBtn) {
    saveBtn.onclick = handleSave;
  }

  if (dismissBtn) {
    dismissBtn.onclick = handleDismiss;
  }
}

/**
 * Render the wizard content based on setup data
 */
function renderWizardContent(container) {
  const { listsWithoutYear, yearsSummary } = setupData;

  let html = '';

  // Section 1: Lists without years
  if (listsWithoutYear.length > 0) {
    html += `
      <div class="mb-6">
        <h4 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
          <i class="fas fa-calendar-alt mr-2 text-amber-500"></i>
          Lists missing a year (${listsWithoutYear.length})
        </h4>
        <div class="space-y-2">
          ${listsWithoutYear
            .map(
              (list) => `
            <div class="flex items-center gap-3 bg-gray-800/50 rounded p-3" data-list-id="${list.id}">
              <span class="flex-1 text-white font-medium truncate">${escapeHtml(list.name)}</span>
              <select class="year-select bg-gray-700 border border-gray-600 text-white rounded px-3 py-1 text-sm focus:border-red-500 focus:outline-none" data-list-id="${list.id}">
                <option value="">Select year</option>
                ${generateYearOptions()}
              </select>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  }

  // Section 2: Years needing official list designation
  const yearsNeedingOfficial = yearsSummary.filter((y) => !y.hasOfficial);

  if (yearsNeedingOfficial.length > 0) {
    html += `
      <div class="mb-6">
        <h4 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
          <i class="fas fa-star mr-2 text-amber-500"></i>
          Choose official list for each year
        </h4>
        <p class="text-xs text-gray-500 mb-3">Your official list represents your definitive ranking for that year and contributes to the collaborative Album of the Year list.</p>
        <div class="space-y-4">
          ${yearsNeedingOfficial
            .map(
              (yearData) => `
            <div class="bg-gray-800/50 rounded p-3">
              <div class="text-sm font-bold text-red-500 mb-2">${yearData.year}</div>
              <div class="space-y-1">
                ${yearData.lists
                  .map(
                    (list) => `
                  <label class="flex items-center gap-3 p-2 hover:bg-gray-700/50 rounded cursor-pointer group">
                    <input type="radio" name="official-${yearData.year}" value="${list.id}" 
                           class="official-radio text-red-600 focus:ring-red-500 focus:ring-offset-gray-800"
                           data-year="${yearData.year}" data-list-id="${list.id}"
                           ${list.isOfficial ? 'checked' : ''}>
                    <span class="text-gray-200 group-hover:text-white">${escapeHtml(list.name)}</span>
                    ${list.isOfficial ? '<span class="text-xs text-green-500 ml-auto"><i class="fas fa-check"></i> Current</span>' : ''}
                  </label>
                `
                  )
                  .join('')}
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  }

  // If there's nothing to show (shouldn't happen but just in case)
  if (!html) {
    html = `
      <div class="text-center py-8">
        <i class="fas fa-check-circle text-green-500 text-4xl mb-3"></i>
        <p class="text-gray-300">All your lists are properly configured!</p>
      </div>
    `;
  }

  container.innerHTML = html;

  // Add event listeners for tracking changes
  container.querySelectorAll('.year-select').forEach((select) => {
    select.addEventListener('change', handleYearChange);
  });

  container.querySelectorAll('.official-radio').forEach((radio) => {
    radio.addEventListener('change', handleOfficialChange);
  });

  updateSaveButton();
}

/**
 * Generate year options from current year back to 1950
 */
function generateYearOptions() {
  const currentYear = new Date().getFullYear();
  let options = '';
  for (let year = currentYear; year >= 1950; year--) {
    options += `<option value="${year}">${year}</option>`;
  }
  return options;
}

/**
 * Handle year selection change
 */
function handleYearChange(e) {
  const listId = e.target.dataset.listId;
  const year = e.target.value ? parseInt(e.target.value, 10) : null;

  if (year) {
    const existing = pendingUpdates.get(listId) || {};
    pendingUpdates.set(listId, { ...existing, listId, year });
  } else {
    const existing = pendingUpdates.get(listId);
    if (existing) {
      delete existing.year;
      if (Object.keys(existing).length <= 1) {
        pendingUpdates.delete(listId);
      }
    }
  }

  updateSaveButton();
}

/**
 * Handle official list radio change
 */
function handleOfficialChange(e) {
  const listId = e.target.dataset.listId;
  const year = parseInt(e.target.dataset.year, 10);

  // Mark this list as official
  const existing = pendingUpdates.get(listId) || {};
  pendingUpdates.set(listId, { ...existing, listId, isOfficial: true });

  // Mark other lists in the same year as not official
  document
    .querySelectorAll(`input[name="official-${year}"]`)
    .forEach((radio) => {
      if (radio.dataset.listId !== listId) {
        const otherId = radio.dataset.listId;
        const otherExisting = pendingUpdates.get(otherId) || {};
        if (otherExisting.isOfficial) {
          delete otherExisting.isOfficial;
          if (Object.keys(otherExisting).length <= 1) {
            pendingUpdates.delete(otherId);
          } else {
            pendingUpdates.set(otherId, otherExisting);
          }
        }
      }
    });

  updateSaveButton();
}

/**
 * Update save button state
 */
function updateSaveButton() {
  const saveBtn = document.getElementById('listSetupSave');
  if (!saveBtn) return;

  // Check if all lists without years now have a year assigned
  const listsWithoutYear = setupData?.listsWithoutYear || [];
  const allYearsAssigned = listsWithoutYear.every((list) => {
    const update = pendingUpdates.get(list.id);
    return update && update.year;
  });

  // Check if all years needing official have one selected
  const yearsNeedingOfficial =
    setupData?.yearsSummary?.filter((y) => !y.hasOfficial) || [];
  const allOfficialsSet = yearsNeedingOfficial.every((yearData) => {
    const radios = document.querySelectorAll(
      `input[name="official-${yearData.year}"]:checked`
    );
    return radios.length > 0;
  });

  // Enable save if all required fields are set
  saveBtn.disabled = !(allYearsAssigned && allOfficialsSet);

  // Update button text
  if (pendingUpdates.size > 0) {
    saveBtn.innerHTML = `<i class="fas fa-check mr-2"></i>Save Changes (${pendingUpdates.size})`;
  } else {
    saveBtn.innerHTML = `<i class="fas fa-check mr-2"></i>Save Changes`;
  }
}

/**
 * Handle save button click
 */
async function handleSave() {
  const saveBtn = document.getElementById('listSetupSave');
  if (!saveBtn || saveBtn.disabled) return;

  // Collect all updates
  const updates = [];

  // Add year updates
  pendingUpdates.forEach((update) => {
    updates.push(update);
  });

  // Also add official selections that weren't already in pendingUpdates
  const yearsNeedingOfficial =
    setupData?.yearsSummary?.filter((y) => !y.hasOfficial) || [];
  yearsNeedingOfficial.forEach((yearData) => {
    const checked = document.querySelector(
      `input[name="official-${yearData.year}"]:checked`
    );
    if (checked) {
      const listId = checked.dataset.listId;
      if (!pendingUpdates.has(listId)) {
        updates.push({ listId, isOfficial: true });
      }
    }
  });

  if (updates.length === 0) {
    hideWizard();
    return;
  }

  // Show loading state
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';

  try {
    await apiCall('/api/lists/bulk-update', {
      method: 'POST',
      body: JSON.stringify({ updates }),
    });

    showToast('Lists updated successfully!', 'success');
    hideWizard();

    // Refresh the lists in the sidebar
    if (typeof window.loadLists === 'function') {
      window.loadLists();
    }
  } catch (err) {
    console.error('Failed to save list updates:', err);
    showToast('Failed to save changes: ' + err.message, 'error');
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<i class="fas fa-check mr-2"></i>Save Changes`;
  }
}

/**
 * Handle dismiss button click
 */
async function handleDismiss() {
  try {
    await apiCall('/api/lists/setup-dismiss', { method: 'POST' });
  } catch (err) {
    console.warn('Failed to dismiss wizard:', err);
  }

  hideWizard();
}

/**
 * Hide the wizard modal
 */
function hideWizard() {
  const modal = document.getElementById('listSetupWizard');
  if (modal) {
    modal.classList.add('hidden');
  }
  setupData = null;
  pendingUpdates.clear();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Export for use in app initialization
export default {
  checkListSetupStatus,
};
