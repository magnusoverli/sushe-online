/**
 * Duplicate Review Modal
 *
 * Cluster-based admin modal for reviewing and resolving duplicate albums.
 * Allows canonical selection, selective merge, dry-run preview, and marking
 * variant pairs as distinct.
 */

import { escapeHtml, getPlaceholderSvg } from './html-utils.js';
import { showToast, apiCall } from './utils.js';
import { createModal } from './modal-factory.js';
import { markAlbumsDistinct } from '../utils/album-api.js';

let modalElement = null;
let modalController = null;
let currentClusters = [];
let currentClusterIndex = 0;
let onComplete = null;
let resolvedCount = 0;
let loading = false;

function normalizeClusterMember(member) {
  return {
    album_id: member.album_id,
    artist: member.artist || 'Unknown artist',
    album: member.album || 'Unknown album',
    release_date: member.release_date || null,
    country: member.country || null,
    genre_1: member.genre_1 || null,
    genre_2: member.genre_2 || null,
    trackCount: Number.isFinite(member.trackCount) ? member.trackCount : null,
    hasCover: Boolean(member.hasCover),
    listRefs: Number.isFinite(member.listRefs) ? member.listRefs : 0,
    canonicalScore: Number.isFinite(member.canonicalScore)
      ? member.canonicalScore
      : 0,
  };
}

function normalizeClusters(input) {
  let sourceClusters = [];

  if (Array.isArray(input)) {
    if (input.length > 0 && Array.isArray(input[0].members)) {
      sourceClusters = input;
    } else if (input.length > 0 && input[0].album1 && input[0].album2) {
      sourceClusters = input.map((pair, index) => {
        return {
          clusterId: `pair-${index}`,
          suggestedCanonicalId: pair.album1.album_id,
          members: [pair.album1, pair.album2],
          maxConfidence: pair.confidence,
          avgConfidence: pair.confidence,
          pairs: [
            {
              album1Id: pair.album1.album_id,
              album2Id: pair.album2.album_id,
              confidence: pair.confidence,
            },
          ],
        };
      });
    }
  } else if (input && typeof input === 'object') {
    if (Array.isArray(input.clusters) && input.clusters.length > 0) {
      sourceClusters = input.clusters;
    } else if (Array.isArray(input.pairs) && input.pairs.length > 0) {
      sourceClusters = input.pairs.map((pair, index) => {
        return {
          clusterId: `pair-${index}`,
          suggestedCanonicalId: pair.album1.album_id,
          members: [pair.album1, pair.album2],
          maxConfidence: pair.confidence,
          avgConfidence: pair.confidence,
          pairs: [
            {
              album1Id: pair.album1.album_id,
              album2Id: pair.album2.album_id,
              confidence: pair.confidence,
            },
          ],
        };
      });
    }
  }

  return sourceClusters
    .filter(
      (cluster) => Array.isArray(cluster.members) && cluster.members.length > 1
    )
    .map((cluster, index) => {
      const members = cluster.members
        .map(normalizeClusterMember)
        .sort((a, b) => (b.canonicalScore || 0) - (a.canonicalScore || 0));

      const suggestedCanonicalId =
        cluster.suggestedCanonicalId || members[0]?.album_id || null;
      const selectedCanonicalId = suggestedCanonicalId;
      const mergeTargets = new Set(
        members
          .map((member) => member.album_id)
          .filter((albumId) => albumId !== selectedCanonicalId)
      );

      return {
        clusterId: cluster.clusterId || `cluster-${index}`,
        members,
        memberCount: members.length,
        pairs: Array.isArray(cluster.pairs) ? cluster.pairs : [],
        maxConfidence: Number.isFinite(cluster.maxConfidence)
          ? cluster.maxConfidence
          : 0,
        avgConfidence: Number.isFinite(cluster.avgConfidence)
          ? cluster.avgConfidence
          : 0,
        selectedCanonicalId,
        mergeTargets,
      };
    });
}

/**
 * Open the duplicate review modal.
 *
 * @param {Object|Array} scanData - scan response or legacy pair array
 * @param {Function} onCompleteCallback - completion callback
 * @returns {Promise<{resolved: number, remaining: number}>}
 */
export function openDuplicateReviewModal(scanData, onCompleteCallback = null) {
  return new Promise((resolve) => {
    const clusters = normalizeClusters(scanData);
    if (clusters.length === 0) {
      resolve({ resolved: 0, remaining: 0 });
      return;
    }

    currentClusters = clusters;
    currentClusterIndex = 0;
    resolvedCount = 0;
    loading = false;

    onComplete = () => {
      const result = {
        resolved: resolvedCount,
        remaining: currentClusters.length - currentClusterIndex,
      };

      if (onCompleteCallback) onCompleteCallback(result);
      resolve(result);
    };

    createModalDOM();
    renderCurrentCluster();
    showModal();
  });
}

function createModalDOM() {
  if (modalElement) {
    modalElement.remove();
  }

  modalElement = document.createElement('div');
  modalElement.id = 'duplicateReviewModal';
  modalElement.className =
    'fixed inset-0 z-[10002] flex items-center justify-center p-4 safe-area-modal duplicate-review-modal hidden';
  modalElement.innerHTML = `
    <div class="settings-modal-backdrop"></div>
    <div class="settings-modal-content duplicate-review-modal-content max-w-5xl w-full">
      <div class="settings-modal-header">
        <div class="flex items-center gap-2">
          <h3 class="settings-modal-title">Review Duplicate Clusters</h3>
          <span id="duplicateProgress" class="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs sm:text-sm rounded">
            1 / 1
          </span>
        </div>
        <button class="settings-modal-close" id="duplicateModalClose" type="button">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="settings-modal-body duplicate-review-modal-body" id="duplicateReviewContent"></div>
      <div class="settings-modal-footer duplicate-review-modal-footer">
        <div class="flex gap-2 flex-wrap">
          <button id="previewClusterBtn" class="settings-button" type="button">
            <i class="fas fa-search mr-1"></i>Preview
          </button>
          <button id="mergeClusterBtn" class="settings-button bg-green-700 hover:bg-green-600" type="button">
            <i class="fas fa-code-branch mr-1"></i>Merge Selected
          </button>
          <button id="skipClusterBtn" class="settings-button" type="button">
            <i class="fas fa-forward mr-1"></i>Skip Cluster
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalElement);
}

function setupModalController() {
  const backdrop = modalElement.querySelector('.settings-modal-backdrop');
  const closeBtn = modalElement.querySelector('#duplicateModalClose');

  modalController = createModal({
    element: modalElement,
    backdrop,
    closeButton: closeBtn,
    closeOnEscape: false,
    onClose: () => {
      if (onComplete) onComplete();
    },
  });

  modalController.addListener(document, 'keydown', handleKeyboard);
  modalController.addListener(
    modalElement.querySelector('#previewClusterBtn'),
    'click',
    handlePreview
  );
  modalController.addListener(
    modalElement.querySelector('#mergeClusterBtn'),
    'click',
    handleMergeCluster
  );
  modalController.addListener(
    modalElement.querySelector('#skipClusterBtn'),
    'click',
    handleSkip
  );
}

function showModal() {
  if (!modalController) {
    setupModalController();
  }

  modalController.open();
}

function hideModal() {
  if (modalController) {
    modalController.close();
    modalController = null;
  } else if (modalElement) {
    modalElement.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

function currentCluster() {
  return currentClusters[currentClusterIndex] || null;
}

function formatGenres(member) {
  const genres = [member.genre_1, member.genre_2].filter((value) => {
    return Boolean(value && String(value).trim());
  });
  return genres.length > 0 ? genres.join(', ') : 'None';
}

function renderCurrentCluster() {
  if (currentClusterIndex >= currentClusters.length) {
    renderComplete();
    return;
  }

  const cluster = currentCluster();
  const progress = modalElement.querySelector('#duplicateProgress');
  const content = modalElement.querySelector('#duplicateReviewContent');
  const placeholderSvg = getPlaceholderSvg(80);

  if (progress) {
    progress.textContent = `${currentClusterIndex + 1} / ${currentClusters.length}`;
  }

  const confidenceLabel =
    cluster.maxConfidence > 0
      ? `${cluster.maxConfidence}% top match`
      : `${cluster.memberCount} variants`;

  const variantRows = cluster.members
    .map((member) => {
      const isCanonical = member.album_id === cluster.selectedCanonicalId;
      const isSelected = cluster.mergeTargets.has(member.album_id);
      const coverUrl = member.hasCover
        ? `/api/albums/${encodeURIComponent(member.album_id)}/cover`
        : placeholderSvg;

      const rowClasses = isCanonical
        ? 'border-green-600 bg-green-900/15'
        : 'border-gray-700 bg-gray-800/40 hover:border-gray-500 hover:bg-gray-800/60';

      return `
        <div
          class="duplicate-variant-row flex items-center gap-3 p-3 rounded border transition-colors cursor-pointer ${rowClasses}"
          data-variant-id="${escapeHtml(member.album_id)}"
          data-variant-row
          tabindex="0"
          role="button"
          aria-label="Set ${escapeHtml(member.artist)} - ${escapeHtml(member.album)} as canonical"
        >
          <div class="shrink-0" aria-hidden="true">
            <span class="w-4 h-4 rounded-full border ${isCanonical ? 'border-green-400 bg-green-500 block' : 'border-gray-500 bg-transparent block'}"></span>
          </div>
          <input
            type="checkbox"
            class="merge-target-checkbox"
            data-album-id="${escapeHtml(member.album_id)}"
            ${isCanonical ? 'disabled' : ''}
            ${isSelected ? 'checked' : ''}
          />
          <img
            src="${coverUrl}"
            alt="${escapeHtml(member.album)}"
            class="w-12 h-12 rounded object-cover bg-gray-900"
            onerror="this.src='${placeholderSvg}'"
          />
          <div class="min-w-0 flex-1">
            <div class="text-sm text-white truncate">${escapeHtml(member.album)}</div>
            <div class="text-xs text-gray-400 truncate">${escapeHtml(member.artist)}</div>
            <div class="text-xs text-gray-500 mt-1">
              ${member.trackCount ? `${member.trackCount} tracks` : 'Tracks unknown'}
              • ${member.release_date ? escapeHtml(member.release_date) : 'Date unknown'}
              • ${escapeHtml(formatGenres(member))}
              • ${member.listRefs || 0} list refs
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              class="settings-button mark-distinct-btn"
              type="button"
              data-album-id="${escapeHtml(member.album_id)}"
              ${isCanonical ? 'disabled' : ''}
            >
              Distinct
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  content.innerHTML = `
    <div class="space-y-4">
      <div class="p-3 rounded border border-gray-700 bg-gray-900/50">
        <div class="text-sm text-gray-200">${cluster.memberCount} variants in this cluster</div>
        <div class="text-xs text-gray-400 mt-1">${confidenceLabel}</div>
        <div class="text-xs text-gray-500 mt-2">Click any album row to set it as canonical.</div>
      </div>

      <div id="clusterPreviewPanel" class="hidden p-3 rounded border border-gray-700 bg-gray-900/50 text-sm text-gray-300"></div>

      <div class="space-y-2">
        ${variantRows}
      </div>
    </div>
  `;

  content.querySelectorAll('[data-variant-row]').forEach((row) => {
    row.addEventListener('click', (event) => {
      const interactiveTarget = event.target.closest(
        '.merge-target-checkbox, .mark-distinct-btn'
      );
      if (interactiveTarget) return;
      applyCanonicalSelection(row.dataset.variantId);
    });

    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      applyCanonicalSelection(row.dataset.variantId);
    });
  });

  content.querySelectorAll('.merge-target-checkbox').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      applyMergeSelection(checkbox.dataset.albumId, checkbox.checked);
    });
  });

  content.querySelectorAll('.mark-distinct-btn').forEach((button) => {
    button.addEventListener('click', () => {
      handleMarkDistinct(button.dataset.albumId);
    });
  });

  setButtonsLoading(loading);
}

function applyCanonicalSelection(canonicalId) {
  const cluster = currentCluster();
  if (!cluster) return;

  cluster.selectedCanonicalId = canonicalId;
  cluster.mergeTargets.delete(canonicalId);

  for (const member of cluster.members) {
    if (
      member.album_id !== canonicalId &&
      !cluster.mergeTargets.has(member.album_id)
    ) {
      cluster.mergeTargets.add(member.album_id);
    }
  }

  renderCurrentCluster();
}

function applyMergeSelection(albumId, isSelected) {
  const cluster = currentCluster();
  if (!cluster) return;
  if (albumId === cluster.selectedCanonicalId) return;

  if (isSelected) {
    cluster.mergeTargets.add(albumId);
  } else {
    cluster.mergeTargets.delete(albumId);
  }
}

function selectedPayload() {
  const cluster = currentCluster();
  if (!cluster) return null;

  return {
    canonicalAlbumId: cluster.selectedCanonicalId,
    retireAlbumIds: [...cluster.mergeTargets],
  };
}

function renderPreview(preview) {
  const panel = modalElement.querySelector('#clusterPreviewPanel');
  if (!panel) return;

  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="font-medium text-gray-100 mb-2">Dry-run impact</div>
    <div>Lists affected: ${preview.impactedLists}</div>
    <div>Users affected: ${preview.impactedUsers}</div>
    <div>Same-list collisions: ${preview.collisionCount}</div>
    <div class="mt-2">Metadata fields likely merged: ${
      preview.metadataFieldsLikelyMerged?.length
        ? preview.metadataFieldsLikelyMerged
            .map((field) => escapeHtml(field))
            .join(', ')
        : 'none'
    }</div>
    ${
      preview.missingRetireAlbumIds?.length
        ? `<div class="mt-2 text-yellow-400">Already missing: ${preview.missingRetireAlbumIds.map((id) => escapeHtml(id)).join(', ')}</div>`
        : ''
    }
  `;
}

async function handlePreview() {
  const payload = selectedPayload();
  if (!payload) return;

  if (payload.retireAlbumIds.length === 0) {
    showToast('No variants selected to merge', 'info');
    return;
  }

  setButtonsLoading(true);

  try {
    const preview = await apiCall('/admin/api/merge-cluster/dry-run', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderPreview(preview);
  } catch (error) {
    console.error('Error previewing cluster merge:', error);
    showToast(`Preview failed: ${error.message}`, 'error');
  } finally {
    setButtonsLoading(false);
  }
}

async function handleMergeCluster() {
  const payload = selectedPayload();
  if (!payload) return;

  if (payload.retireAlbumIds.length === 0) {
    showToast('No variants selected to merge', 'info');
    return;
  }

  setButtonsLoading(true);

  try {
    const result = await apiCall('/admin/api/merge-cluster', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const fieldsSummary = Array.isArray(result.mergedFieldNames)
      ? result.mergedFieldNames.length
      : 0;

    showToast(
      `Merged ${result.mergedAlbums} album variants, updated ${result.listItemsUpdated} list references${fieldsSummary ? `, ${fieldsSummary} metadata fields` : ''}`,
      'success'
    );

    resolvedCount++;
    currentClusterIndex++;
    renderCurrentCluster();
  } catch (error) {
    console.error('Error merging cluster:', error);
    showToast(`Merge failed: ${error.message}`, 'error');
  } finally {
    setButtonsLoading(false);
  }
}

async function handleMarkDistinct(albumId) {
  const cluster = currentCluster();
  if (!cluster) return;

  const canonicalId = cluster.selectedCanonicalId;
  if (!canonicalId || canonicalId === albumId) return;

  setButtonsLoading(true);

  try {
    const result = await markAlbumsDistinct(canonicalId, albumId);
    if (!result.ok) {
      throw new Error(result.error || 'Failed to mark albums as distinct');
    }

    cluster.mergeTargets.delete(albumId);

    cluster.members = cluster.members.filter(
      (member) => member.album_id !== albumId
    );
    cluster.pairs = cluster.pairs.filter((pair) => {
      return pair.album1Id !== albumId && pair.album2Id !== albumId;
    });
    cluster.memberCount = cluster.members.length;

    if (cluster.memberCount < 2) {
      showToast('Marked as different albums. Cluster completed.', 'success');
      resolvedCount++;
      currentClusterIndex++;
      renderCurrentCluster();
      return;
    }

    showToast('Marked as different albums and removed from review', 'success');
    renderCurrentCluster();
  } catch (error) {
    console.error('Error marking albums as distinct:', error);
    showToast(`Error: ${error.message}`, 'error');
  } finally {
    setButtonsLoading(false);
  }
}

function handleSkip() {
  currentClusterIndex++;
  renderCurrentCluster();
}

function renderComplete() {
  const content = modalElement.querySelector('#duplicateReviewContent');
  const progress = modalElement.querySelector('#duplicateProgress');
  const footer = modalElement.querySelector('.settings-modal-footer');

  if (progress) progress.textContent = 'Complete';

  if (content) {
    content.innerHTML = `
      <div class="text-center py-12">
        <i class="fas fa-check-circle text-5xl text-green-500 mb-4"></i>
        <h3 class="text-xl font-bold text-white mb-2">Review Complete</h3>
        <p class="text-gray-400 mb-4">
          Resolved ${resolvedCount} of ${currentClusters.length} clusters
        </p>
        <p class="text-sm text-gray-500">
          ${currentClusters.length - resolvedCount > 0 ? `${currentClusters.length - resolvedCount} clusters were skipped` : 'All clusters processed!'}
        </p>
      </div>
    `;
  }

  if (footer) {
    footer.innerHTML = `
      <button id="closeCompleteBtn" class="settings-button bg-green-700 hover:bg-green-600 px-6" type="button">
        <i class="fas fa-check mr-2"></i>Done
      </button>
    `;

    const closeBtn = footer.querySelector('#closeCompleteBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', hideModal);
    }
  }
}

function setButtonsLoading(isLoading) {
  loading = isLoading;

  if (!modalElement) return;

  modalElement
    .querySelectorAll(
      '#previewClusterBtn, #mergeClusterBtn, #skipClusterBtn, .mark-distinct-btn, .merge-target-checkbox'
    )
    .forEach((element) => {
      element.disabled = isLoading;
    });

  modalElement.querySelectorAll('[data-variant-row]').forEach((row) => {
    row.setAttribute('aria-disabled', isLoading ? 'true' : 'false');
    if (isLoading) {
      row.classList.add('pointer-events-none', 'opacity-70');
    } else {
      row.classList.remove('pointer-events-none', 'opacity-70');
    }
  });
}

function handleKeyboard(event) {
  if (!modalController || !modalController.isOpen()) return;

  if (event.key === 'Escape') {
    hideModal();
    return;
  }

  if (event.key === 's' || event.key === 'S') {
    event.preventDefault();
    handleSkip();
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    handleMergeCluster();
  }
}

/**
 * Close the modal programmatically.
 */
export function closeDuplicateReviewModal() {
  if (!modalElement) return;
  hideModal();
}
