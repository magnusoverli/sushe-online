/**
 * Import/Export Module
 *
 * Handles list import/export functionality including JSON export,
 * PDF export, conflict resolution, and merge operations.
 *
 * @module import-export
 */

import { showToast, getAlbumKey, apiCall } from './utils.js';
// jsPDF is imported dynamically inside downloadListAsPDF so the ~127KB-gzipped
// PDF library stays out of the eagerly-loaded bundle and is fetched only when
// a user actually exports a list as PDF.

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

const TAXONOMY_ARRAY_FIELDS = [
  'primary_genres',
  'secondary_genres',
  'descriptors',
  'languages',
  'scenes',
  'movements',
];
const MANUAL_GENRE_FIELDS = ['genre_1', 'genre_2'];

function parseJSONValue(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getImportedTaxonomy(album) {
  const taxonomy = parseJSONValue(album?.taxonomy);
  if (taxonomy && !Array.isArray(taxonomy)) return taxonomy;

  const hasCSVTaxonomy = [
    'rym_primary_genres_json',
    'rym_secondary_genres_json',
    'rym_descriptors_json',
    'rym_languages_json',
    'rym_scenes_json',
    'rym_movements_json',
    'rym_taxonomy_provenance_json',
    'manual_genre_overrides_json',
  ].some((field) => Object.hasOwn(album || {}, field));
  if (!hasCSVTaxonomy) return null;

  const provenance = parseJSONValue(album.rym_taxonomy_provenance_json);
  const manualOverrides = parseJSONValue(album.manual_genre_overrides_json);
  const primaryGenres = parseJSONValue(album.rym_primary_genres_json);
  const secondaryGenres = parseJSONValue(album.rym_secondary_genres_json);
  const descriptors = parseJSONValue(album.rym_descriptors_json);
  const languages = parseJSONValue(album.rym_languages_json);
  const scenes = parseJSONValue(album.rym_scenes_json);
  const movements = parseJSONValue(album.rym_movements_json);
  const hasRymTaxonomy =
    (provenance && !Array.isArray(provenance)) ||
    Array.isArray(primaryGenres) ||
    Array.isArray(secondaryGenres) ||
    Array.isArray(descriptors) ||
    Array.isArray(languages) ||
    Array.isArray(scenes) ||
    Array.isArray(movements);

  return {
    schema_version: 1,
    manual_overrides:
      manualOverrides && !Array.isArray(manualOverrides) ? manualOverrides : {},
    ...(hasRymTaxonomy && {
      rym: {
        ...(provenance && !Array.isArray(provenance) ? provenance : {}),
        primary_genres: Array.isArray(primaryGenres) ? primaryGenres : [],
        secondary_genres: Array.isArray(secondaryGenres) ? secondaryGenres : [],
        descriptors: Array.isArray(descriptors) ? descriptors : [],
        ...(Array.isArray(languages) ? { languages } : {}),
        ...(Array.isArray(scenes) ? { scenes } : {}),
        ...(Array.isArray(movements) ? { movements } : {}),
      },
    }),
  };
}

export function getTaxonomyCSVFields(album) {
  const taxonomy = getImportedTaxonomy(album) || {};
  const rym =
    taxonomy.rym && typeof taxonomy.rym === 'object' ? taxonomy.rym : {};
  const provenance = Object.fromEntries(
    Object.entries(rym).filter(
      ([field]) => !TAXONOMY_ARRAY_FIELDS.includes(field)
    )
  );
  const manualOverrides =
    taxonomy.manual_overrides &&
    typeof taxonomy.manual_overrides === 'object' &&
    !Array.isArray(taxonomy.manual_overrides)
      ? taxonomy.manual_overrides
      : {};

  return {
    rym_primary_genres_json: JSON.stringify(
      Array.isArray(rym.primary_genres) ? rym.primary_genres : []
    ),
    rym_secondary_genres_json: JSON.stringify(
      Array.isArray(rym.secondary_genres) ? rym.secondary_genres : []
    ),
    rym_descriptors_json: JSON.stringify(
      Array.isArray(rym.descriptors) ? rym.descriptors : []
    ),
    rym_languages_json: Object.hasOwn(rym, 'languages')
      ? JSON.stringify(Array.isArray(rym.languages) ? rym.languages : [])
      : '',
    rym_scenes_json: Object.hasOwn(rym, 'scenes')
      ? JSON.stringify(Array.isArray(rym.scenes) ? rym.scenes : [])
      : '',
    rym_movements_json: Object.hasOwn(rym, 'movements')
      ? JSON.stringify(Array.isArray(rym.movements) ? rym.movements : [])
      : '',
    rym_taxonomy_provenance_json: JSON.stringify(provenance),
    manual_genre_overrides_json: JSON.stringify(manualOverrides),
    taxonomy_updated_at: album?.taxonomy_updated_at || '',
  };
}

export function taxonomyToSourceObservation(album) {
  const rym = getImportedTaxonomy(album)?.rym || {};
  const canonicalUrl = album.rym_canonical_url || rym.source_url;
  if (typeof canonicalUrl !== 'string' || !canonicalUrl) return null;
  const availabilityLinks =
    parseJSONValue(album.availability_links) ||
    parseJSONValue(album.availability_links_json) ||
    [];

  const completeTaxonomy =
    rym.complete === true &&
    Array.isArray(rym.primary_genres) &&
    Array.isArray(rym.secondary_genres) &&
    Array.isArray(rym.descriptors) &&
    typeof rym.extractor_version === 'string';

  return {
    schemaVersion: 1,
    source: 'rateyourmusic',
    identity: {
      numericId: album.rym_numeric_id || null,
      artist: album.artist || '',
      title: album.album || '',
      canonicalUrl,
    },
    platformLinks: Array.isArray(availabilityLinks)
      ? availabilityLinks.map(({ service, url }) => ({ service, url }))
      : [],
    ...(completeTaxonomy && {
      taxonomy: {
        complete: true,
        primaryGenres: [...rym.primary_genres],
        secondaryGenres: [...rym.secondary_genres],
        descriptors: [...rym.descriptors],
        ...(Array.isArray(rym.languages)
          ? { languages: [...rym.languages] }
          : {}),
        ...(Array.isArray(rym.scenes) ? { scenes: [...rym.scenes] } : {}),
        ...(Array.isArray(rym.movements)
          ? { movements: [...rym.movements] }
          : {}),
        sourceUrl: canonicalUrl,
        extractorVersion: rym.extractor_version,
        capturedAt: rym.captured_at || null,
      },
    }),
  };
}

export function getManualGenreOverrides(album) {
  const manualOverrides = getImportedTaxonomy(album)?.manual_overrides;
  if (
    !manualOverrides ||
    typeof manualOverrides !== 'object' ||
    Array.isArray(manualOverrides)
  ) {
    return null;
  }

  const overrides = {};
  for (const field of MANUAL_GENRE_FIELDS) {
    if (!Object.hasOwn(manualOverrides, field)) continue;
    const entry = manualOverrides[field];
    const value =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? entry.value
        : entry;
    if (typeof value === 'string' || value === null) overrides[field] = value;
  }
  return Object.keys(overrides).length > 0 ? overrides : null;
}

export function prepareAlbumForImport(album) {
  const prepared = { ...album };
  const sourceObservation = taxonomyToSourceObservation(album);
  if (sourceObservation && prepared.sourceObservation === undefined) {
    prepared.sourceObservation = sourceObservation;
  }
  delete prepared.taxonomy_updated_at;
  return prepared;
}

export function resolveImportedAlbum(album, savedAlbums) {
  const hasIdentity = album?.artist && album?.album;
  const byKey = hasIdentity
    ? savedAlbums.find(
        (savedAlbum) =>
          savedAlbum?.artist &&
          savedAlbum?.album &&
          getAlbumKey(savedAlbum) === getAlbumKey(album)
      )
    : null;
  return (
    byKey ||
    savedAlbums.find(
      (savedAlbum) => album.album_id && savedAlbum.album_id === album.album_id
    ) ||
    null
  );
}

export function buildTaxonomyAwareMerge(existingAlbums, importedAlbums) {
  const existingKeys = new Set(existingAlbums.map(getAlbumKey));
  const newAlbums = importedAlbums.filter(
    (album) => !existingKeys.has(getAlbumKey(album))
  );
  const duplicateTaxonomyAlbums = importedAlbums
    .filter((album) => existingKeys.has(getAlbumKey(album)))
    .map(prepareAlbumForImport)
    .filter((album) => album.sourceObservation);

  return {
    newAlbums,
    duplicateTaxonomyAlbums,
    mergedList: [...existingAlbums, ...newAlbums.map(prepareAlbumForImport)],
  };
}

export function buildManualGenreOverrideUpdates(importedAlbums, savedAlbums) {
  const updatesByAlbumId = new Map();

  for (const album of importedAlbums) {
    const overrides = getManualGenreOverrides(album);
    if (!overrides) continue;
    const saved = resolveImportedAlbum(album, savedAlbums);
    if (!saved?.album_id) continue;
    updatesByAlbumId.set(saved.album_id, {
      ...(updatesByAlbumId.get(saved.album_id) || {}),
      ...overrides,
    });
  }

  return [...updatesByAlbumId].map(([albumId, overrides]) => ({
    albumId,
    overrides,
  }));
}

export async function replayManualGenreOverrides(
  importedAlbums,
  savedAlbums,
  request,
  logger = console
) {
  let applied = 0;
  let failed = 0;
  for (const { albumId, overrides } of buildManualGenreOverrideUpdates(
    importedAlbums,
    savedAlbums
  )) {
    try {
      await request(`/api/albums/${encodeURIComponent(albumId)}/genres`, {
        method: 'PATCH',
        body: JSON.stringify(overrides),
      });
      applied++;
    } catch (error) {
      failed++;
      logger.warn('Failed to import manual genre overrides', albumId, error);
    }
  }
  return { applied, failed };
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

    // Load the PDF library on demand (keeps it out of the boot bundle)
    const { jsPDF } = await import('jspdf');

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
      const disqualificationLabel = getDisqualificationPDFLabel(album);
      const disqualificationLines = disqualificationLabel
        ? doc.splitTextToSize(disqualificationLabel, textWidth)
        : [];
      const itemRowHeight = Math.max(
        rowHeight,
        18 + disqualificationLines.length * 4
      );

      // Check if we need a new page
      if (yPos + itemRowHeight > pageHeight - margin) {
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

      if (disqualificationLabel) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(185, 28, 28);
        doc.text(disqualificationLines, textStartX, textY);
        doc.setTextColor(0);
      }

      // Move to next row
      yPos += itemRowHeight;

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

export function getExportPoints(album) {
  return album.is_disqualified === true ? 0 : (album.points ?? '');
}

export function getDisqualificationPDFLabel(album) {
  if (album.is_disqualified !== true) return '';
  return album.disqualification_reason
    ? `DISQUALIFIED - ${album.disqualification_reason}`
    : 'DISQUALIFIED';
}

export function buildListCSV(albums) {
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
    'is_disqualified',
    'disqualification_reason',
    'cover_image_format',
    'rym_numeric_id',
    'rym_canonical_url',
    'availability_links_json',
    'rym_primary_genres_json',
    'rym_secondary_genres_json',
    'rym_descriptors_json',
    'rym_languages_json',
    'rym_scenes_json',
    'rym_movements_json',
    'rym_taxonomy_provenance_json',
    'manual_genre_overrides_json',
    'taxonomy_updated_at',
  ];
  const rows = [headers.map(escapeCSVField).join(',')];

  for (const album of albums) {
    let tracksValue = '';
    if (album.tracks) {
      tracksValue = Array.isArray(album.tracks)
        ? JSON.stringify(album.tracks)
        : String(album.tracks);
    }
    const taxonomyFields = getTaxonomyCSVFields(album);
    const row = [
      album.rank ?? '',
      album.artist || '',
      album.album || '',
      album.album_id || '',
      album.release_date || '',
      album.country || '',
      album.genre_1 || '',
      album.genre_2 || '',
      album.primary_track || '',
      album.secondary_track || '',
      album.comments || '',
      album.comments_2 || '',
      tracksValue,
      getExportPoints(album),
      album.is_disqualified === true,
      album.disqualification_reason ?? '',
      album.cover_image_format || '',
      album.rym_numeric_id || '',
      album.rym_canonical_url || '',
      JSON.stringify(album.availability_links || []),
      taxonomyFields.rym_primary_genres_json,
      taxonomyFields.rym_secondary_genres_json,
      taxonomyFields.rym_descriptors_json,
      taxonomyFields.rym_languages_json,
      taxonomyFields.rym_scenes_json,
      taxonomyFields.rym_movements_json,
      taxonomyFields.rym_taxonomy_provenance_json,
      taxonomyFields.manual_genre_overrides_json,
      taxonomyFields.taxonomy_updated_at,
    ];
    rows.push(row.map(escapeCSVField).join(','));
  }

  return rows.join('\n');
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

    const csvContent = buildListCSV(albums);
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

    // Click-outside / ESC to dismiss, routed through the existing cancel
    // handlers so pending-import state is cleared (conflict) or we step back
    // to the chooser (rename) — matching the Cancel buttons exactly. This is a
    // multi-step wizard whose two modals hand off to each other, so it manages
    // its own visibility rather than a single-modal createModal controller.
    const attachDismiss = (modal, dismiss) => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) dismiss();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden'))
          dismiss();
      });
    };
    if (conflictModal && importCancelBtn) {
      attachDismiss(conflictModal, () => importCancelBtn.click());
    }
    if (renameModal && cancelImportRenameBtn) {
      attachDismiss(renameModal, () => cancelImportRenameBtn.click());
    }

    // Overwrite option
    importOverwriteBtn.onclick = async () => {
      const { data: pendingImportData, filename: pendingImportFilename } =
        getPendingImport();
      if (!pendingImportData || !pendingImportFilename) return;

      conflictModal.classList.add('hidden');

      try {
        let overrideFailures = 0;
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
          const cleaned = prepareAlbumForImport(album);
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

        try {
          const savedList = await apiCall(
            `/api/lists/${encodeURIComponent(listId)}`
          );
          const overrideResult = await replayManualGenreOverrides(
            albums,
            savedList,
            apiCall
          );
          overrideFailures = overrideResult.failed;
        } catch (error) {
          overrideFailures++;
          console.warn(
            'Failed to replay taxonomy overrides after overwrite',
            error
          );
        }

        updateListNav();
        selectList(listId);
        showToast(
          overrideFailures > 0
            ? `Overwritten "${pendingImportFilename}", but ${overrideFailures} genre override update${overrideFailures === 1 ? '' : 's'} failed`
            : `Overwritten "${pendingImportFilename}" with ${albums.length} albums`,
          overrideFailures > 0 ? 'warning' : undefined
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

        const { newAlbums, duplicateTaxonomyAlbums, mergedList } =
          buildTaxonomyAwareMerge(existingListData, albums);

        // Use saveList for merge (don't import track picks/summaries for existing albums)
        await saveList(listId, mergedList);

        if (duplicateTaxonomyAlbums.length > 0) {
          try {
            await apiCall(`/api/lists/${encodeURIComponent(listId)}/items`, {
              method: 'PATCH',
              body: JSON.stringify({ added: duplicateTaxonomyAlbums }),
            });
          } catch (error) {
            console.warn('Failed to enrich duplicate album taxonomy', error);
          }
        }

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

        const overrideResult = await replayManualGenreOverrides(
          albums,
          savedList,
          apiCall
        );

        // Import track picks and summaries for new albums only
        for (const album of newAlbums) {
          const savedAlbum = resolveImportedAlbum(album, savedList);
          const albumId = savedAlbum?.album_id;
          if (!albumId) continue;

          // Import track picks (now uses list item ID, not album ID)
          const listItemId = savedAlbum?._id || albumToListItemMap.get(albumId);
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

        if (overrideResult.failed > 0) {
          showToast(
            `Merged list, but ${overrideResult.failed} genre override update${overrideResult.failed === 1 ? '' : 's'} failed`,
            'warning'
          );
        } else if (skippedCount > 0) {
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
