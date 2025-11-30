/**
 * Import/Export Module
 *
 * Handles list import/export functionality including JSON export,
 * conflict resolution, and merge operations.
 *
 * @module import-export
 */

import { showToast, getAlbumKey } from './utils.js';

/**
 * Download list as JSON file with embedded images
 * @param {string} listName - Name of the list to export
 */
export async function downloadListAsJSON(listName) {
  try {
    // Fetch list with embedded base64 images from server
    showToast('Preparing export with images...', 'info', 2000);

    const response = await fetch(
      `/api/lists/${encodeURIComponent(listName)}?export=true`,
      { credentials: 'include' }
    );

    if (!response.ok) {
      if (response.status === 404) {
        showToast('List not found', 'error');
        return;
      }
      throw new Error(`Failed to fetch list: ${response.status}`);
    }

    // Server returns data with rank, points, and cover_image already included
    const exportData = await response.json();

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${listName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    try {
      await navigator.clipboard.writeText(jsonStr);
      if (navigator.share) {
        await navigator.share({
          title: `Album List: ${listName}`,
          text: `Album list export: ${listName}`,
          files: [
            new File([blob], `${listName}.json`, {
              type: 'application/json',
            }),
          ],
        });
      }
    } catch (shareErr) {
      console.log('Share not available or cancelled', shareErr);
    }

    showToast('List exported successfully!', 'success');
  } catch (error) {
    console.error('Export error:', error);
    showToast('Error exporting list', 'error');
  }
}

/**
 * Factory function to create import conflict handling with injected dependencies
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getListData - Get album array for a list
 * @param {Function} deps.getLists - Get all lists object
 * @param {Function} deps.saveList - Save list to server
 * @param {Function} deps.selectList - Select a list
 * @param {Function} deps.updateListNav - Update list navigation
 * @param {Function} deps.getPendingImport - Get pending import state
 * @param {Function} deps.setPendingImport - Set pending import state
 * @returns {Object} Import conflict handling API
 */
export function createImportConflictHandler(deps = {}) {
  const {
    getListData,
    getLists,
    saveList,
    selectList,
    updateListNav,
    getPendingImport,
    setPendingImport,
  } = deps;

  /**
   * Initialize import conflict modal handlers
   */
  function initializeImportConflictHandling() {
    const conflictModal = document.getElementById('importConflictModal');
    const renameModal = document.getElementById('importRenameModal');
    const originalImportNameSpan =
      document.getElementById('originalImportName');
    const importNewNameInput = document.getElementById('importNewName');

    // Check if elements exist before setting handlers
    const importOverwriteBtn = document.getElementById('importOverwriteBtn');
    const importRenameBtn = document.getElementById('importRenameBtn');
    const importMergeBtn = document.getElementById('importMergeBtn');
    const importCancelBtn = document.getElementById('importCancelBtn');
    const confirmImportRenameBtn = document.getElementById(
      'confirmImportRenameBtn'
    );
    const cancelImportRenameBtn = document.getElementById(
      'cancelImportRenameBtn'
    );

    if (
      !importOverwriteBtn ||
      !importRenameBtn ||
      !importMergeBtn ||
      !importCancelBtn
    ) {
      // Elements don't exist on this page, skip initialization
      return;
    }

    // Overwrite option
    importOverwriteBtn.onclick = async () => {
      const { data: pendingImportData, filename: pendingImportFilename } =
        getPendingImport();
      if (!pendingImportData || !pendingImportFilename) return;

      conflictModal.classList.add('hidden');

      try {
        await saveList(pendingImportFilename, pendingImportData);
        updateListNav();
        selectList(pendingImportFilename);
        showToast(
          `Overwritten "${pendingImportFilename}" with ${pendingImportData.length} albums`
        );
      } catch (err) {
        console.error('Import overwrite error:', err);
        showToast('Error overwriting list', 'error');
      }

      setPendingImport(null, null);
    };

    // Rename option
    importRenameBtn.onclick = () => {
      const { filename: pendingImportFilename } = getPendingImport();
      const lists = getLists();

      conflictModal.classList.add('hidden');
      originalImportNameSpan.textContent = pendingImportFilename;

      // Suggest a new name
      let suggestedName = pendingImportFilename;
      let counter = 1;
      while (lists[suggestedName]) {
        suggestedName = `${pendingImportFilename} (${counter})`;
        counter++;
      }
      importNewNameInput.value = suggestedName;

      renameModal.classList.remove('hidden');

      setTimeout(() => {
        importNewNameInput.focus();
        importNewNameInput.select();
      }, 100);
    };

    // Merge option
    importMergeBtn.onclick = async () => {
      const { data: pendingImportData, filename: pendingImportFilename } =
        getPendingImport();
      if (!pendingImportData || !pendingImportFilename) return;

      conflictModal.classList.add('hidden');

      try {
        // Get existing list data using helper function
        const existingList = getListData(pendingImportFilename) || [];

        // Merge the lists (avoiding duplicates based on artist + album)
        const existingKeys = new Set(existingList.map(getAlbumKey));

        const newAlbums = pendingImportData.filter(
          (album) => !existingKeys.has(getAlbumKey(album))
        );

        const mergedList = [...existingList, ...newAlbums];

        await saveList(pendingImportFilename, mergedList);
        updateListNav();
        selectList(pendingImportFilename);

        const addedCount = newAlbums.length;
        const skippedCount = pendingImportData.length - addedCount;

        if (skippedCount > 0) {
          showToast(
            `Added ${addedCount} new albums, skipped ${skippedCount} duplicates`
          );
        } else {
          showToast(`Added ${addedCount} albums to "${pendingImportFilename}"`);
        }
      } catch (err) {
        console.error('Import merge error:', err);
        showToast('Error merging lists', 'error');
      }

      setPendingImport(null, null);
    };

    // Cancel import
    importCancelBtn.onclick = () => {
      conflictModal.classList.add('hidden');
      setPendingImport(null, null);
      showToast('Import cancelled');
    };

    // Rename modal handlers
    if (confirmImportRenameBtn) {
      confirmImportRenameBtn.onclick = async () => {
        const { data: pendingImportData } = getPendingImport();
        const lists = getLists();
        const newName = importNewNameInput.value.trim();

        if (!newName) {
          showToast('Please enter a new name', 'error');
          return;
        }

        if (lists[newName]) {
          showToast('A list with this name already exists', 'error');
          return;
        }

        renameModal.classList.add('hidden');

        try {
          await saveList(newName, pendingImportData);
          updateListNav();
          selectList(newName);
          showToast(
            `Imported as "${newName}" with ${pendingImportData.length} albums`
          );
        } catch (err) {
          console.error('Import with rename error:', err);
          showToast('Error importing list', 'error');
        }

        setPendingImport(null, null);
      };
    }

    if (cancelImportRenameBtn) {
      cancelImportRenameBtn.onclick = () => {
        const { filename: pendingImportFilename } = getPendingImport();
        renameModal.classList.add('hidden');
        // Go back to conflict modal
        document.getElementById('conflictListName').textContent =
          pendingImportFilename;
        conflictModal.classList.remove('hidden');
      };
    }

    // Enter key in rename input
    if (importNewNameInput) {
      importNewNameInput.onkeypress = (e) => {
        if (e.key === 'Enter' && confirmImportRenameBtn) {
          confirmImportRenameBtn.click();
        }
      };
    }
  }

  // Return public API
  return {
    initializeImportConflictHandling,
  };
}
