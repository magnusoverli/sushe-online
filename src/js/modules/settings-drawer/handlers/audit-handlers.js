/**
 * Settings drawer audit/scan handlers.
 *
 * Owns duplicate scanning and manual album audit flows.
 */

export function createSettingsAuditHandlers(deps = {}) {
  const doc =
    deps.doc || (typeof document !== 'undefined' ? document : undefined);

  const { apiCall, showToast, openDuplicateReviewModal, openManualAlbumAudit } =
    deps;

  async function handleScanDuplicates() {
    const scanBtn = doc.getElementById('scanDuplicatesBtn');
    const statusDiv = doc.getElementById('duplicateScanStatus');
    const thresholdSelect = doc.getElementById('duplicateThreshold');
    const threshold = thresholdSelect
      ? parseFloat(thresholdSelect.value)
      : 0.15;

    try {
      scanBtn.disabled = true;
      scanBtn.textContent = 'Scanning...';
      statusDiv.classList.remove('hidden');
      statusDiv.innerHTML =
        '<i class="fas fa-spinner fa-spin mr-2"></i>Scanning database for potential duplicates...';

      const response = await apiCall(
        `/admin/api/scan-duplicates?threshold=${threshold}`
      );

      if (response.error) {
        throw new Error(response.error);
      }

      if (response.pairs.length === 0) {
        statusDiv.innerHTML = `
          <span class="text-green-400">
            <i class="fas fa-check-circle mr-2"></i>
            No potential duplicates found (${response.totalAlbums} albums, ${response.excludedPairs} marked distinct)
          </span>
        `;
        showToast('No potential duplicates found', 'success');
      } else {
        statusDiv.innerHTML = `
          <span class="text-yellow-400">
            Found ${response.potentialDuplicates} potential duplicates. Opening review...
          </span>
        `;

        const result = await openDuplicateReviewModal(response.pairs);

        statusDiv.innerHTML = `
          <span class="text-gray-400">
            Last scan: ${response.potentialDuplicates} found, ${result.resolved} resolved, ${result.remaining} remaining
          </span>
        `;
      }
    } catch (error) {
      console.error('Error scanning for duplicates:', error);
      statusDiv.innerHTML = `
        <span class="text-red-400">
          <i class="fas fa-exclamation-triangle mr-2"></i>
          Error: ${error.message}
        </span>
      `;
      showToast('Error scanning for duplicates', 'error');
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan & Review';
    }
  }

  async function handleAuditManualAlbums() {
    const auditBtn = doc.getElementById('auditManualAlbumsBtn');
    const statusDiv = doc.getElementById('manualAlbumAuditStatus');
    const thresholdSelect = doc.getElementById('manualAlbumThreshold');
    const threshold = thresholdSelect
      ? parseFloat(thresholdSelect.value)
      : 0.15;

    try {
      auditBtn.disabled = true;
      auditBtn.textContent = 'Checking...';
      statusDiv.classList.remove('hidden');
      statusDiv.innerHTML =
        '<i class="fas fa-spinner fa-spin mr-2"></i>Scanning manual albums...';

      const data = await apiCall(
        `/api/admin/audit/manual-albums?threshold=${threshold}`
      );

      const hasIntegrityIssues =
        data.integrityIssues && data.integrityIssues.length > 0;
      const hasMatches = data.totalWithMatches > 0;

      if (!hasIntegrityIssues && !hasMatches) {
        statusDiv.innerHTML = `
          <span class="text-green-400">
            <i class="fas fa-check-circle mr-2"></i>
            No manual albums need review (${data.totalManual} manual albums checked)
          </span>
        `;
        showToast('No manual albums need review', 'success');
      } else {
        const issueCount = hasIntegrityIssues ? data.integrityIssues.length : 0;
        const matchCount = data.totalWithMatches;

        statusDiv.innerHTML = `
          <span class="text-yellow-400">
            Found ${issueCount > 0 ? `${issueCount} integrity issue${issueCount !== 1 ? 's' : ''}` : ''}${issueCount > 0 && matchCount > 0 ? ' and ' : ''}${matchCount > 0 ? `${matchCount} album${matchCount !== 1 ? 's' : ''} to review` : ''}. Opening review...
          </span>
        `;

        await openManualAlbumAudit(threshold, data);

        statusDiv.innerHTML = `
          <span class="text-gray-400">
            Last audit: ${data.totalManual} manual albums checked
          </span>
        `;
      }
    } catch (error) {
      console.error('Error auditing manual albums:', error);
      statusDiv.innerHTML = `
        <span class="text-red-400">
          <i class="fas fa-exclamation-triangle mr-2"></i>
          Error: ${error.message}
        </span>
      `;
      showToast('Error auditing manual albums', 'error');
    } finally {
      auditBtn.disabled = false;
      auditBtn.textContent = 'Audit Manual Albums';
    }
  }

  return {
    handleScanDuplicates,
    handleAuditManualAlbums,
  };
}
