/**
 * Recommendation action utilities.
 * Shared logic for editing reasoning and removing recommendations,
 * used by both desktop context menu and mobile bottom sheet handlers.
 */

/**
 * Edit the reasoning for a recommendation.
 *
 * @param {Object} rec - Recommendation object
 * @param {number} year - Year
 * @param {Function} apiCall - API call function
 * @param {Function} showReasoningModal - Function to show reasoning modal (returns Promise<string|null>)
 * @param {Function} showToast - Function to show toast notifications
 * @param {Function} selectRecommendations - Function to refresh recommendations display
 * @returns {Promise<void>}
 */
export async function editRecommendationReasoning(
  rec,
  year,
  apiCall,
  showReasoningModal,
  showToast,
  selectRecommendations
) {
  const newReasoning = await showReasoningModal(
    rec,
    year,
    rec.reasoning || '',
    true // isEditMode
  );

  if (newReasoning !== null && newReasoning !== undefined) {
    try {
      await apiCall(
        `/api/recommendations/${year}/${encodeURIComponent(rec.album_id)}/reasoning`,
        {
          method: 'PATCH',
          body: JSON.stringify({ reasoning: newReasoning }),
        }
      );
      showToast('Reasoning updated', 'success');
      selectRecommendations(year);
    } catch (_err) {
      showToast('Failed to update reasoning', 'error');
    }
  }
}

/**
 * Remove a recommendation after confirmation.
 *
 * @param {Object} rec - Recommendation object
 * @param {number} year - Year
 * @param {Function} apiCall - API call function
 * @param {Function} showConfirmation - Function to show confirmation dialog (returns Promise<boolean>)
 * @param {Function} showToast - Function to show toast notifications
 * @param {Function} selectRecommendations - Function to refresh recommendations display
 * @returns {Promise<void>}
 */
export async function removeRecommendation(
  rec,
  year,
  apiCall,
  showConfirmation,
  showToast,
  selectRecommendations
) {
  const confirmed = await showConfirmation(
    'Remove Recommendation',
    `Remove "${rec.album}" by ${rec.artist} from recommendations?`,
    "This will remove the album from this year's recommendations.",
    'Remove'
  );

  if (confirmed) {
    try {
      await apiCall(
        `/api/recommendations/${year}/${encodeURIComponent(rec.album_id)}`,
        { method: 'DELETE' }
      );
      showToast('Recommendation removed', 'success');
      selectRecommendations(year);
    } catch (_err) {
      showToast('Failed to remove recommendation', 'error');
    }
  }
}
