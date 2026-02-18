/**
 * Download Service - Export lists in JSON, PDF, and CSV formats.
 *
 * Replicates the functionality from src/js/modules/import-export.js
 * for the new mobile UI.
 */

import { api } from './api-client';

interface ExportAlbum {
  rank?: number;
  artist?: string;
  album?: string;
  album_id?: string;
  release_date?: string;
  country?: string;
  genre_1?: string;
  genre_2?: string;
  primary_track?: string;
  secondary_track?: string;
  track_pick?: string;
  comments?: string;
  comments_2?: string;
  tracks?: unknown[];
  points?: number;
  cover_image?: string;
  cover_image_format?: string;
  summary?: string;
  summary_source?: string;
}

interface ExportData {
  _metadata?: {
    list_id: string;
    list_name: string;
    year?: number;
    group_id?: string;
    group_name?: string;
  };
  albums?: ExportAlbum[];
}

/** Trigger a browser file download from a Blob. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Fetch export data for a list (with embedded images). */
async function fetchExportData(listId: string): Promise<ExportData> {
  return api.get<ExportData>(
    `/api/lists/${encodeURIComponent(listId)}?export=true`
  );
}

/**
 * Download list as JSON file.
 */
export async function downloadListAsJSON(listId: string): Promise<void> {
  const exportData = await fetchExportData(listId);
  const listName = exportData._metadata?.list_name || listId;
  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  downloadBlob(blob, `${listName}.json`);

  // Try native share if available
  try {
    if (navigator.share) {
      await navigator.share({
        title: `Album List: ${listName}`,
        text: `Album list export: ${listName}`,
        files: [
          new File([blob], `${listName}.json`, { type: 'application/json' }),
        ],
      });
    }
  } catch {
    // Share cancelled or unavailable — not an error
  }
}

/** Escape a CSV field value. */
function escapeCSVField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Download list as CSV file.
 */
export async function downloadListAsCSV(listId: string): Promise<void> {
  const exportData = await fetchExportData(listId);
  const listName = exportData._metadata?.list_name || listId;
  const albums = exportData.albums || [];

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

  const rows = [headers.map(escapeCSVField).join(',')];

  for (const album of albums) {
    let tracksValue = '';
    if (album.tracks) {
      tracksValue = Array.isArray(album.tracks)
        ? JSON.stringify(album.tracks)
        : String(album.tracks);
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

  const csvContent = rows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${listName}.csv`);
}

/**
 * Download list as PDF file.
 *
 * Note: jsPDF is a large dependency. We dynamically import it
 * to keep the main bundle lean.
 */
export async function downloadListAsPDF(listId: string): Promise<void> {
  const { jsPDF } = await import('jspdf');

  const exportData = await fetchExportData(listId);
  const listName = exportData._metadata?.list_name || listId;
  const albums = exportData.albums || [];

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

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

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const exportDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  doc.text(`Exported on ${exportDate}`, margin, yPos);
  yPos += 10;

  const coverSize = 20;
  const coverSpacing = 5;
  const rowHeight = coverSize + 4;
  const textStartX = margin + coverSize + coverSpacing;
  const textWidth = contentWidth - coverSize - coverSpacing;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');

  for (let i = 0; i < albums.length; i++) {
    const album = albums[i]!;

    if (yPos + rowHeight > pageHeight - margin) {
      doc.addPage();
      yPos = margin;
    }

    // Rank
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`#${album.rank || i + 1}`, 5, yPos + coverSize / 2);

    // Cover image
    if (album.cover_image && album.cover_image_format) {
      try {
        const imgFmt = album.cover_image_format.toLowerCase();
        const dataUrl = `data:image/${imgFmt};base64,${album.cover_image}`;
        doc.addImage(dataUrl, imgFmt, margin, yPos, coverSize, coverSize);
      } catch {
        doc.setDrawColor('#c8c8c8');
        doc.setFillColor('#f0f0f0');
        doc.rect(margin, yPos, coverSize, coverSize, 'FD');
      }
    } else {
      doc.setDrawColor('#c8c8c8');
      doc.setFillColor('#f0f0f0');
      doc.rect(margin, yPos, coverSize, coverSize, 'FD');
    }

    // Album info
    let textY = yPos + 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    const titleText = `${album.artist || 'Unknown Artist'} - ${album.album || 'Unknown Album'}`;
    const titleLines = doc.splitTextToSize(titleText, textWidth);
    doc.text(titleLines, textStartX, textY);
    textY += titleLines.length * 5 + 2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const details: string[] = [];
    if (album.release_date) details.push(album.release_date);
    if (album.country) details.push(album.country);
    if (details.length > 0) {
      doc.text(details.join(' \u2022 '), textStartX, textY);
      textY += 5;
    }

    const genres: string[] = [];
    if (album.genre_1) genres.push(album.genre_1);
    if (album.genre_2) genres.push(album.genre_2);
    if (genres.length > 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor('#646464');
      doc.text(genres.join(' \u2022 '), textStartX, textY);
      doc.setTextColor('#000000');
    }

    yPos += rowHeight;

    if (i < albums.length - 1) {
      doc.setDrawColor('#dcdcdc');
      doc.line(margin, yPos - 2, pageWidth - margin, yPos - 2);
    }
  }

  doc.save(`${listName}.pdf`);
}
