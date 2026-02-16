/**
 * Similar Album Detection Modal
 *
 * Shows a side-by-side comparison when a similar album is detected,
 * allowing users to confirm if it's the same album or a different one.
 */

import { escapeHtml, getPlaceholderSvg } from './html-utils.js';
import { apiCall } from './utils.js';
import { createModal } from './modal-factory.js';
import { markAlbumsDistinct } from '../utils/album-api.js';

let modalElement = null;
let modalController = null;
let resolveCallback = null;

/**
 * Check if a similar album exists and show modal if needed
 *
 * Threshold behavior:
 * - >= 98% confidence: Auto-merge silently (no modal shown)
 * - 10-97% confidence: Show modal for user decision
 * - < 10% confidence: Treat as distinct (no modal shown)
 *
 * @param {Object} newAlbum - The album being added { artist, album, album_id?, cover_image? }
 * @returns {Promise<{action: 'use_existing'|'add_new'|'cancelled', album?: Object, autoMerged?: boolean}>}
 */
export async function checkAndPromptSimilar(newAlbum) {
  try {
    // Call API to check for similar albums
    let data;
    try {
      data = await apiCall('/api/albums/check-similar', {
        method: 'POST',
        body: JSON.stringify({
          artist: newAlbum.artist,
          album: newAlbum.album,
          album_id: newAlbum.album_id || null,
        }),
      });
    } catch (_err) {
      console.warn('Failed to check for similar albums');
      return { action: 'add_new' };
    }

    if (!data.hasSimilar || data.matches.length === 0) {
      return { action: 'add_new' };
    }

    const bestMatch = data.matches[0];

    // Auto-merge for >= 98% confidence matches (skip modal entirely)
    if (data.shouldAutoMerge) {
      console.log(
        `Auto-merging album "${newAlbum.album}" with existing "${bestMatch.album}" (${bestMatch.confidence}% match)`
      );
      return {
        action: 'use_existing',
        album: {
          album_id: bestMatch.album_id,
          artist: bestMatch.artist,
          album: bestMatch.album,
        },
        autoMerged: true,
      };
    }

    // Show modal for 10-97% confidence matches
    const result = await showSimilarAlbumModal(newAlbum, bestMatch);

    return result;
  } catch (err) {
    console.error('Error checking for similar albums:', err);
    return { action: 'add_new' };
  }
}

/**
 * Show the similar album comparison modal
 *
 * @param {Object} newAlbum - Album being added
 * @param {Object} existingMatch - Matched existing album from API
 * @returns {Promise<{action: string, album?: Object}>}
 */
function showSimilarAlbumModal(newAlbum, existingMatch) {
  return new Promise((resolve) => {
    resolveCallback = resolve;

    // Create modal DOM if it doesn't exist
    if (!modalElement) {
      createModalDOM();
    }

    // Populate modal content
    populateModal(newAlbum, existingMatch);

    // Create controller with modal factory (handles escape, backdrop, body overflow)
    modalController = createModal({
      element: modalElement,
      backdrop: modalElement,
      onClose: () => closeModal('cancelled'),
      closeOnEscape: true,
      closeOnBackdrop: true,
    });

    // Attach button handlers via controller for automatic cleanup
    modalController.addListener(
      modalElement.querySelector('#similarAlbumSame'),
      'click',
      () => closeModal('use_existing')
    );
    modalController.addListener(
      modalElement.querySelector('#similarAlbumDifferent'),
      'click',
      () => closeModal('add_new_mark_distinct')
    );
    modalController.addListener(
      modalElement.querySelector('#similarAlbumCancel'),
      'click',
      () => closeModal('cancelled')
    );

    modalController.open();
  });
}

function createModalDOM() {
  modalElement = document.createElement('div');
  modalElement.id = 'similarAlbumModal';
  modalElement.className =
    'hidden fixed inset-0 bg-black bg-opacity-70 z-[10001] flex items-center justify-center p-4 safe-area-modal';
  modalElement.innerHTML = `
    <div class="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
      <!-- Header -->
      <div class="p-5 border-b border-gray-800">
        <h3 class="text-xl font-bold text-white">Similar Album Found</h3>
        <p class="text-gray-400 text-sm mt-1">Is this the same album?</p>
      </div>
      
      <!-- Comparison Content -->
      <div class="p-5" id="similarAlbumComparison">
        <!-- Populated dynamically -->
      </div>
      
      <!-- Footer -->
      <div class="p-5 border-t border-gray-800 flex flex-col sm:flex-row gap-3">
        <button id="similarAlbumSame" class="flex-1 px-4 py-3 bg-green-700 hover:bg-green-600 text-white rounded font-semibold transition-colors">
          Yes, Merge Best
        </button>
        <button id="similarAlbumDifferent" class="flex-1 px-4 py-3 bg-blue-700 hover:bg-blue-600 text-white rounded font-semibold transition-colors">
          No, Different Album
        </button>
        <button id="similarAlbumCancel" class="px-4 py-3 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors">
          Cancel
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modalElement);
}

function populateModal(newAlbum, existingMatch) {
  const container = modalElement.querySelector('#similarAlbumComparison');

  // Get cover image URLs
  const newCoverUrl = newAlbum.cover_image
    ? `data:image/${(newAlbum.cover_image_format || 'jpeg').toLowerCase()};base64,${newAlbum.cover_image}`
    : null;
  const existingCoverUrl = existingMatch.hasCover
    ? `/api/albums/${encodeURIComponent(existingMatch.album_id)}/cover`
    : null;

  const placeholderSvg = getPlaceholderSvg(120);

  // Generate match explanation
  const matchExplanation = generateMatchExplanation(newAlbum, existingMatch);

  container.innerHTML = `
    <div class="grid grid-cols-2 gap-4">
      <!-- New Album (left) -->
      <div class="bg-gray-800 rounded-lg p-4">
        <div class="text-xs text-gray-500 uppercase tracking-wide mb-2">Adding</div>
        <div class="aspect-square mb-3 bg-gray-900 rounded overflow-hidden">
          <img 
            src="${newCoverUrl || placeholderSvg}" 
            alt="${newAlbum.album}"
            class="w-full h-full object-cover"
            onerror="this.src='${placeholderSvg}'"
          />
        </div>
        <div class="text-white font-semibold truncate" title="${escapeHtml(newAlbum.album)}">
          ${escapeHtml(newAlbum.album)}
        </div>
        <div class="text-gray-400 text-sm truncate" title="${escapeHtml(newAlbum.artist)}">
          ${escapeHtml(newAlbum.artist)}
        </div>
      </div>
      
      <!-- Existing Album (right) -->
      <div class="bg-gray-800 rounded-lg p-4 border-2 border-yellow-600/50">
        <div class="text-xs text-yellow-500 uppercase tracking-wide mb-2">
          Already Exists (${existingMatch.confidence}% match)
        </div>
        <div class="aspect-square mb-3 bg-gray-900 rounded overflow-hidden">
          <img 
            src="${existingCoverUrl || placeholderSvg}" 
            alt="${existingMatch.album}"
            class="w-full h-full object-cover"
            onerror="this.src='${placeholderSvg}'"
          />
        </div>
        <div class="text-white font-semibold truncate" title="${escapeHtml(existingMatch.album)}">
          ${escapeHtml(existingMatch.album)}
        </div>
        <div class="text-gray-400 text-sm truncate" title="${escapeHtml(existingMatch.artist)}">
          ${escapeHtml(existingMatch.artist)}
        </div>
      </div>
    </div>
    
    <!-- Match Explanation -->
    <div class="mt-4 p-3 bg-blue-900/20 border border-blue-800/30 rounded text-sm">
      <div class="flex items-start gap-2">
        <i class="fas fa-info-circle text-blue-400 mt-0.5"></i>
        <div>
          <div class="text-blue-300 font-medium mb-1">Why are these similar?</div>
          <div class="text-gray-400">${matchExplanation}</div>
        </div>
      </div>
    </div>
    
    <div class="mt-3 p-3 bg-gray-800/50 rounded text-sm text-gray-400">
      <strong class="text-gray-300">Tip:</strong> "Merge Best" combines the best metadata from both 
      (higher quality cover, more complete dates, etc.) into a single entry.
    </div>
  `;

  // Store match data for later use
  modalElement.dataset.existingAlbumId = existingMatch.album_id;
  modalElement.dataset.existingArtist = existingMatch.artist;
  modalElement.dataset.existingAlbum = existingMatch.album;
  modalElement.dataset.newAlbumId = newAlbum.album_id || '';
}

async function closeModal(action) {
  if (!modalElement) return;

  const existingAlbumId = modalElement.dataset.existingAlbumId;
  const existingArtist = modalElement.dataset.existingArtist;
  const existingAlbum = modalElement.dataset.existingAlbum;
  const newAlbumId = modalElement.dataset.newAlbumId;

  const result = { action };

  if (action === 'use_existing') {
    // Return the existing album's details so the caller can use them
    result.album = {
      album_id: existingAlbumId,
      artist: existingArtist,
      album: existingAlbum,
    };
  } else if (
    action === 'add_new_mark_distinct' &&
    newAlbumId &&
    existingAlbumId
  ) {
    // Mark these two albums as distinct so we don't ask again
    await markAlbumsDistinct(newAlbumId, existingAlbumId);
    result.action = 'add_new';
  } else if (action === 'add_new_mark_distinct') {
    // No album IDs to mark, just proceed with add
    result.action = 'add_new';
  }

  // Resolve before close so the recursive onClose -> closeModal('cancelled') finds
  // resolveCallback already null and becomes a no-op
  if (resolveCallback) {
    resolveCallback(result);
    resolveCallback = null;
  }

  // Now close/cleanup - onClose will call closeModal('cancelled') but resolveCallback
  // is already null so it won't override our result
  if (modalController && modalController.isOpen()) {
    modalController.close();
    modalController = null;
  } else {
    modalElement.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

/**
 * Generate a human-readable explanation of why two albums matched
 * @param {Object} newAlbum - The album being added
 * @param {Object} existingMatch - The matched existing album
 * @returns {string} - HTML explanation
 */
function generateMatchExplanation(newAlbum, existingMatch) {
  const reasons = [];
  const newArtist = (newAlbum.artist || '').toLowerCase().trim();
  const existingArtist = (existingMatch.artist || '').toLowerCase().trim();
  const newAlbumName = (newAlbum.album || '').toLowerCase().trim();
  const existingAlbumName = (existingMatch.album || '').toLowerCase().trim();

  // Check for exact artist match
  if (newArtist === existingArtist) {
    reasons.push('Same artist');
  } else if (
    newArtist.includes(existingArtist) ||
    existingArtist.includes(newArtist)
  ) {
    reasons.push('Similar artist name');
  }

  // Check for exact album title match
  if (newAlbumName === existingAlbumName) {
    reasons.push('Identical album title');
  } else {
    // Check for common variations
    const strippedNew = stripEditionSuffix(newAlbumName);
    const strippedExisting = stripEditionSuffix(existingAlbumName);

    if (strippedNew === strippedExisting) {
      reasons.push('Same album (different edition/version)');
    } else if (
      strippedNew.includes(strippedExisting) ||
      strippedExisting.includes(strippedNew)
    ) {
      reasons.push('Album title contains similar text');
    } else {
      // Check for word overlap
      const newWords = new Set(
        strippedNew.split(/\s+/).filter((w) => w.length > 2)
      );
      const existingWords = new Set(
        strippedExisting.split(/\s+/).filter((w) => w.length > 2)
      );
      const overlap = [...newWords].filter((w) => existingWords.has(w));

      if (overlap.length > 0) {
        reasons.push(`Shared words: "${overlap.join('", "')}"`);
      }
    }
  }

  if (reasons.length === 0) {
    return 'Fuzzy matching detected these might be the same album based on text similarity.';
  }

  return reasons.join(' + ');
}

/**
 * Strip common edition/version suffixes from album names
 * @param {string} albumName - Album name to clean
 * @returns {string} - Cleaned album name
 */
function stripEditionSuffix(albumName) {
  if (!albumName) return '';

  return albumName
    .replace(
      /\s*\(.*?(deluxe|expanded|remaster|edition|anniversary|bonus|special|limited).*?\)/gi,
      ''
    )
    .replace(
      /\s*\[.*?(deluxe|expanded|remaster|edition|anniversary|bonus|special|limited).*?\]/gi,
      ''
    )
    .replace(
      /\s*-\s*(deluxe|expanded|remaster|edition|anniversary|bonus|special|limited).*$/gi,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}
