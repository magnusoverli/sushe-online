/**
 * Import/Export Module
 *
 * Handles list import/export functionality including JSON export,
 * PDF export, conflict resolution, and merge operations.
 *
 * @module import-export
 */

import { showToast, getAlbumKey, apiCall } from './utils.js';
import { jsPDF } from 'jspdf';

/**
 * Trigger a browser file download from a Blob.
 * Creates a temporary <a> element, clicks it, then cleans up.
 *
 * @param {Blob} blob - File content
 * @param {string} filename - Suggested download filename
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Download list as JSON file with embedded images
 * @param {string} listId - ID of the list to export
 */
export async function downloadListAsJSON(listId) {
  try {
    // Fetch list with embedded base64 images from server
    showToast('Preparing export with images...', 'info', 2000);

    const exportData = await apiCall(
      `/api/lists/${encodeURIComponent(listId)}?export=true`
    );

    // Get list name from metadata for filename
    const listName = exportData._metadata?.list_name || listId;

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    downloadBlob(blob, `${listName}.json`);

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
    showToast(
      error.status === 404 ? 'List not found' : 'Error exporting list',
      'error'
    );
  }
}

/**
 * Download list as PDF file with embedded images
 * @param {string} listId - ID of the list to export
 */
export async function downloadListAsPDF(listId) {
  try {
    // Fetch list with embedded base64 images from server
    showToast('Preparing PDF export...', 'info', 2000);

    const exportData = await apiCall(
      `/api/lists/${encodeURIComponent(listId)}?export=true`
    );

    // Get list name from metadata for filename
    const listName = exportData._metadata?.list_name || listId;

    // Filter out comments and points as specified
    // Export data structure: { _metadata: {...}, albums: [...] }
    const rawAlbums = exportData.albums || [];
    const albums = rawAlbums.map((album) => {
      const {
        comments: _unusedComments,
        points: _unusedPoints,
        ...albumData
      } = album;
      // _unusedComments and _unusedPoints are intentionally unused (filtered out)
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
          doc.addImage(
            dataUrl,
            imageFormat,
            margin,
            yPos,
            coverSize,
            coverSize
          );
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
    showToast(
      error.status === 404 ? 'List not found' : 'Error exporting PDF',
      'error'
    );
  }
}

/**
 * Escape a CSV field value
 * @param {string} value - Value to escape
 * @returns {string} Escaped CSV field
 */
function escapeCSVField(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);

  // If field contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Download list as CSV file with all album data
 * @param {string} listId - ID of the list to export
 */
export async function downloadListAsCSV(listId) {
  try {
    // Fetch list with embedded base64 images from server
    showToast('Preparing CSV export...', 'info', 2000);

    const exportData = await apiCall(
      `/api/lists/${encodeURIComponent(listId)}?export=true`
    );

    // Get list name from metadata for filename
    const listName = exportData._metadata?.list_name || listId;

    // Export data structure: { _metadata: {...}, albums: [...] }
    const albums = exportData.albums || [];

    // CSV column headers
    const headers = [
      'rank',
      'artist',
      'album',
      'album_id',
      'release_date',
      'country',
      'genre_1',
      'genre_2',
      'primary_track',
      'secondary_track',
      'comments',
      'comments_2',
      'tracks',
      'points',
      'cover_image_format',
    ];

    // Build CSV rows
    const rows = [headers.map(escapeCSVField).join(',')];

    for (const album of albums) {
      // Serialize tracks array as JSON string if it exists
      let tracksValue = '';
      if (album.tracks) {
        if (Array.isArray(album.tracks)) {
          tracksValue = JSON.stringify(album.tracks);
        } else {
          tracksValue = String(album.tracks);
        }
      }

      const row = [
        album.rank || '',
        album.artist || '',
        album.album || '',
        album.album_id || '',
        album.release_date || '',
        album.country || '',
        album.genre_1 || '',
        album.genre_2 || '',
        album.primary_track || album.track_pick || '',
        album.secondary_track || '',
        album.comments || '',
        album.comments_2 || '',
        tracksValue,
        album.points || '',
        album.cover_image_format || '',
      ];

      rows.push(row.map(escapeCSVField).join(','));
    }

    // Create CSV content
    const csvContent = rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `${listName}.csv`);

    showToast('CSV exported successfully!', 'success');
  } catch (error) {
    console.error('CSV export error:', error);
    showToast(
      error.status === 404 ? 'List not found' : 'Error exporting CSV',
      'error'
    );
  }
}

/**
 * Factory function to create import conflict handling with injected dependencies
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getListData - Get album array for a list by ID
 * @param {Function} deps.getLists - Get all lists object (keyed by ID)
 * @param {Function} deps.findListByName - Find a list by name, returns list object with _id
 * @param {Function} deps.saveList - Save list to server (by ID)
 * @param {Function} deps.selectList - Select a list (by ID)
 * @param {Function} deps.updateListNav - Update list navigation
 * @param {Function} deps.getPendingImport - Get pending import state
 * @param {Function} deps.setPendingImport - Set pending import state
 * @returns {Object} Import conflict handling API
 */
export function createImportConflictHandler(deps = {}) {
  const {
    getListData,
    getLists: _getLists, // Available but not currently used
    findListByName,
    saveList,
    importList,
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
        // Handle both old format (array) and new format (object with albums/metadata)
        let albums;
        if (Array.isArray(pendingImportData)) {
          albums = pendingImportData;
        } else {
          albums = pendingImportData.albums || [];
        }

        // Find the existing list by name to get its ID
        const existingList = findListByName(pendingImportFilename);
        if (!existingList) {
          showToast('List not found for overwrite', 'error');
          setPendingImport(null, null);
          return;
        }

        const listId = existingList._id;

        // Clean albums data (remove rank/points)
        const cleanedAlbums = albums.map((album) => {
          const cleaned = { ...album };
          delete cleaned.points;
          delete cleaned.rank;
          delete cleaned._id;
          return cleaned;
        });

        // Replace list items using PUT
        await apiCall(`/api/lists/${encodeURIComponent(listId)}`, {
          method: 'PUT',
          body: JSON.stringify({ data: cleanedAlbums }),
        });

        updateListNav();
        selectList(listId);
        showToast(
          `Overwritten "${pendingImportFilename}" with ${albums.length} albums`
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

      conflictModal.classList.add('hidden');
      originalImportNameSpan.textContent = pendingImportFilename;

      // Suggest a new name - check by name, not by ID
      let suggestedName = pendingImportFilename;
      let counter = 1;
      while (findListByName(suggestedName)) {
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
        // Handle both old format (array) and new format (object with albums/metadata)
        let albums;
        if (Array.isArray(pendingImportData)) {
          albums = pendingImportData;
        } else {
          albums = pendingImportData.albums || [];
          // Note: metadata not used in merge (existing list keeps its organization)
        }

        // Find existing list by name to get its ID
        const existingListMeta = findListByName(pendingImportFilename);
        if (!existingListMeta) {
          showToast('List not found for merge', 'error');
          setPendingImport(null, null);
          return;
        }

        const listId = existingListMeta._id;

        // Get existing list data using helper function with ID
        const existingListData = getListData(listId) || [];

        // Merge the lists (avoiding duplicates based on artist + album)
        const existingKeys = new Set(existingListData.map(getAlbumKey));

        const newAlbums = albums.filter(
          (album) => !existingKeys.has(getAlbumKey(album))
        );

        const mergedList = [...existingListData, ...newAlbums];

        // Use saveList for merge (don't import track picks/summaries for existing albums)
        await saveList(listId, mergedList);

        // Fetch the saved list to get list item IDs (needed for track picks API)
        let savedList = [];
        try {
          savedList = await apiCall(`/api/lists/${encodeURIComponent(listId)}`);
        } catch (_fetchErr) {
          // Non-critical: track picks won't be imported but merge still succeeds
        }

        // Build a map from album_id to list_item_id for track picks
        const albumToListItemMap = new Map();
        for (const item of savedList) {
          if (item.album_id && item._id) {
            albumToListItemMap.set(item.album_id, item._id);
          }
        }

        // Import track picks and summaries for new albums only
        for (const album of newAlbums) {
          const albumId = album.album_id;
          if (!albumId) continue;

          // Import track picks (now uses list item ID, not album ID)
          const listItemId = albumToListItemMap.get(albumId);
          if (listItemId && (album.primary_track || album.secondary_track)) {
            try {
              if (album.primary_track) {
                await apiCall(`/api/track-picks/${listItemId}`, {
                  method: 'POST',
                  body: JSON.stringify({
                    trackIdentifier: album.primary_track,
                    priority: 1,
                  }),
                });
              }
              if (album.secondary_track) {
                await apiCall(`/api/track-picks/${listItemId}`, {
                  method: 'POST',
                  body: JSON.stringify({
                    trackIdentifier: album.secondary_track,
                    priority: 2,
                  }),
                });
              }
            } catch (err) {
              console.warn(
                'Failed to import track picks for list item',
                listItemId,
                err
              );
            }
          }

          // Import summary (still uses album_id)
          if (album.summary || album.summary_source) {
            try {
              await apiCall(`/api/albums/${albumId}/summary`, {
                method: 'PUT',
                body: JSON.stringify({
                  summary: album.summary || '',
                  summary_source: album.summary_source || '',
                }),
              });
            } catch (err) {
              console.warn('Failed to import summary for album', albumId, err);
            }
          }
        }

        updateListNav();
        selectList(listId);

        const addedCount = newAlbums.length;
        const skippedCount = albums.length - addedCount;

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
        const newName = importNewNameInput.value.trim();

        if (!newName) {
          showToast('Please enter a new name', 'error');
          return;
        }

        // Check if a list with this name already exists
        if (findListByName(newName)) {
          showToast('A list with this name already exists', 'error');
          return;
        }

        renameModal.classList.add('hidden');

        try {
          // Handle both old format (array) and new format (object with albums/metadata)
          let albums, metadata;
          if (Array.isArray(pendingImportData)) {
            albums = pendingImportData;
            metadata = null;
          } else {
            albums = pendingImportData.albums || [];
            metadata = pendingImportData.metadata || null;
          }

          // importList returns the new list ID
          const newListId = await importList(newName, albums, metadata);
          updateListNav();
          selectList(newListId);
          showToast(`Imported as "${newName}" with ${albums.length} albums`);
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
