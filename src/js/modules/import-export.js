/**
 * Import/Export Module
 *
 * Handles list import/export functionality including JSON export,
 * PDF export, conflict resolution, and merge operations.
 *
 * @module import-export
 */

import { showToast, getAlbumKey } from './utils.js';
import { jsPDF } from 'jspdf';

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
 * Download list as PDF file with embedded images
 * @param {string} listName - Name of the list to export
 */
export async function downloadListAsPDF(listName) {
  try {
    // Fetch list with embedded base64 images from server
    showToast('Preparing PDF export...', 'info', 2000);

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

    // Filter out comments and points as specified
    const albums = exportData.map((album) => {
      const { comments, points, ...albumData } = album;
      return albumData;
    });

    // Create PDF document
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    // Page dimensions
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - 2 * margin;
    let yPos = margin;

    // Header
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(listName, margin, yPos);
    yPos += 8;

    // Export date
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const exportDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    doc.text(`Exported on ${exportDate}`, margin, yPos);
    yPos += 10;

    // Album list
    const coverSize = 20; // mm
    const coverSpacing = 5; // mm between cover and text
    const rowHeight = coverSize + 4; // mm per row
    const textStartX = margin + coverSize + coverSpacing;
    const textWidth = contentWidth - coverSize - coverSpacing;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');

    for (let i = 0; i < albums.length; i++) {
      const album = albums[i];

      // Check if we need a new page
      if (yPos + rowHeight > pageHeight - margin) {
        doc.addPage();
        yPos = margin;
      }

      // Rank (left side, before cover)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      const rankX = 5; // Fixed position from left edge
      doc.text(`#${album.rank || i + 1}`, rankX, yPos + coverSize / 2);

      // Cover image
      if (album.cover_image && album.cover_image_format) {
        try {
          const imageFormat = album.cover_image_format.toLowerCase();
          const dataUrl = `data:image/${imageFormat};base64,${album.cover_image}`;

          // Add image with error handling
          doc.addImage(dataUrl, imageFormat, margin, yPos, coverSize, coverSize);
        } catch (imgError) {
          console.warn('Failed to add cover image:', imgError);
          // Draw placeholder rectangle if image fails
          doc.setDrawColor(200);
          doc.setFillColor(240);
          doc.rect(margin, yPos, coverSize, coverSize, 'FD');
        }
      } else {
        // Draw placeholder rectangle if no cover
        doc.setDrawColor(200);
        doc.setFillColor(240);
        doc.rect(margin, yPos, coverSize, coverSize, 'FD');
      }

      // Album info (right side of cover)
      let textY = yPos + 5;

      // Artist and Album (bold)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      const artistAlbumText = `${album.artist || 'Unknown Artist'} - ${album.album || 'Unknown Album'}`;
      const artistAlbumLines = doc.splitTextToSize(artistAlbumText, textWidth);
      doc.text(artistAlbumLines, textStartX, textY);
      textY += artistAlbumLines.length * 5 + 2;

      // Release date and country
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const details = [];
      if (album.release_date) details.push(album.release_date);
      if (album.country) details.push(album.country);
      if (details.length > 0) {
        doc.text(details.join(' • '), textStartX, textY);
        textY += 5;
      }

      // Genres
      const genres = [];
      if (album.genre_1) genres.push(album.genre_1);
      if (album.genre_2) genres.push(album.genre_2);
      if (genres.length > 0) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.text(genres.join(' • '), textStartX, textY);
        doc.setTextColor(0); // Reset to black
        textY += 4;
      }

      // Move to next row
      yPos += rowHeight;

      // Add subtle separator line (except for last item)
      if (i < albums.length - 1) {
        doc.setDrawColor(220);
        doc.line(margin, yPos - 2, pageWidth - margin, yPos - 2);
      }
    }

    // Save PDF
    doc.save(`${listName}.pdf`);

    showToast('PDF exported successfully!', 'success');
  } catch (error) {
    console.error('PDF export error:', error);
    showToast('Error exporting PDF', 'error');
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
