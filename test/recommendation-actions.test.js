/**
 * Tests for recommendation-actions.js utility module
 */

const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

let editRecommendationReasoning, removeRecommendation;

describe('recommendation-actions', async () => {
  const mod = await import('../src/js/utils/recommendation-actions.js');
  editRecommendationReasoning = mod.editRecommendationReasoning;
  removeRecommendation = mod.removeRecommendation;

  const sampleRec = {
    album: 'OK Computer',
    artist: 'Radiohead',
    album_id: 'radiohead::ok computer::1997',
    reasoning: 'A classic album',
  };
  const year = 2024;

  describe('editRecommendationReasoning', () => {
    it('should call API and show success toast when reasoning is updated', async () => {
      const mockApiCall = mock.fn(() => Promise.resolve());
      const mockShowReasoningModal = mock.fn(() =>
        Promise.resolve('New reasoning')
      );
      const mockShowToast = mock.fn();
      const mockSelectRecs = mock.fn();

      await editRecommendationReasoning(
        sampleRec,
        year,
        mockApiCall,
        mockShowReasoningModal,
        mockShowToast,
        mockSelectRecs
      );

      assert.strictEqual(mockApiCall.mock.calls.length, 1);
      assert.strictEqual(mockShowToast.mock.calls.length, 1);
      assert.strictEqual(
        mockShowToast.mock.calls[0].arguments[0],
        'Reasoning updated'
      );
      assert.strictEqual(mockSelectRecs.mock.calls.length, 1);
    });

    it('should not call API when modal returns null', async () => {
      const mockApiCall = mock.fn(() => Promise.resolve());
      const mockShowReasoningModal = mock.fn(() => Promise.resolve(null));
      const mockShowToast = mock.fn();
      const mockSelectRecs = mock.fn();

      await editRecommendationReasoning(
        sampleRec,
        year,
        mockApiCall,
        mockShowReasoningModal,
        mockShowToast,
        mockSelectRecs
      );

      assert.strictEqual(mockApiCall.mock.calls.length, 0);
    });

    it('should show error toast when API call fails', async () => {
      const mockApiCall = mock.fn(() => Promise.reject(new Error('API error')));
      const mockShowReasoningModal = mock.fn(() =>
        Promise.resolve('New reasoning')
      );
      const mockShowToast = mock.fn();
      const mockSelectRecs = mock.fn();

      await editRecommendationReasoning(
        sampleRec,
        year,
        mockApiCall,
        mockShowReasoningModal,
        mockShowToast,
        mockSelectRecs
      );

      assert.strictEqual(mockShowToast.mock.calls.length, 1);
      assert.strictEqual(
        mockShowToast.mock.calls[0].arguments[0],
        'Failed to update reasoning'
      );
    });

    it('should not call API when modal returns undefined', async () => {
      const mockApiCall = mock.fn(() => Promise.resolve());
      const mockShowReasoningModal = mock.fn(() => Promise.resolve(undefined));
      const mockShowToast = mock.fn();
      const mockSelectRecs = mock.fn();

      await editRecommendationReasoning(
        sampleRec,
        year,
        mockApiCall,
        mockShowReasoningModal,
        mockShowToast,
        mockSelectRecs
      );

      assert.strictEqual(mockApiCall.mock.calls.length, 0);
    });

    it('should call API with empty string reasoning', async () => {
      const mockApiCall = mock.fn(() => Promise.resolve());
      const mockShowReasoningModal = mock.fn(() => Promise.resolve(''));
      const mockShowToast = mock.fn();
      const mockSelectRecs = mock.fn();

      await editRecommendationReasoning(
        sampleRec,
        year,
        mockApiCall,
        mockShowReasoningModal,
        mockShowToast,
        mockSelectRecs
      );

      assert.strictEqual(mockApiCall.mock.calls.length, 1);
      const apiBody = JSON.parse(mockApiCall.mock.calls[0].arguments[1].body);
      assert.strictEqual(apiBody.reasoning, '');
    });

    it('should pass existing reasoning to modal as default', async () => {
      const mockApiCall = mock.fn(() => Promise.resolve());
      const mockShowReasoningModal = mock.fn(() => Promise.resolve(null));
      const mockShowToast = mock.fn();
      const mockSelectRecs = mock.fn();

      await editRecommendationReasoning(
        sampleRec,
        year,
        mockApiCall,
        mockShowReasoningModal,
        mockShowToast,
        mockSelectRecs
      );

      const modalArgs = mockShowReasoningModal.mock.calls[0].arguments;
      assert.strictEqual(modalArgs[2], 'A classic album'); // rec.reasoning
      assert.strictEqual(modalArgs[3], true); // isEditMode
    });
  });

  describe('removeRecommendation', () => {
    it('should call API and show success toast when confirmed', async () => {
      const mockApiCall = mock.fn(() => Promise.resolve());
      const mockShowConfirmation = mock.fn(() => Promise.resolve(true));
      const mockShowToast = mock.fn();
      const mockSelectRecs = mock.fn();

      await removeRecommendation(
        sampleRec,
        year,
        mockApiCall,
        mockShowConfirmation,
        mockShowToast,
        mockSelectRecs
      );

      assert.strictEqual(mockApiCall.mock.calls.length, 1);
      assert.strictEqual(mockShowToast.mock.calls.length, 1);
      assert.strictEqual(
        mockShowToast.mock.calls[0].arguments[0],
        'Recommendation removed'
      );
      assert.strictEqual(mockSelectRecs.mock.calls.length, 1);
    });

    it('should not call API when confirmation is cancelled', async () => {
      const mockApiCall = mock.fn(() => Promise.resolve());
      const mockShowConfirmation = mock.fn(() => Promise.resolve(false));
      const mockShowToast = mock.fn();
      const mockSelectRecs = mock.fn();

      await removeRecommendation(
        sampleRec,
        year,
        mockApiCall,
        mockShowConfirmation,
        mockShowToast,
        mockSelectRecs
      );

      assert.strictEqual(mockApiCall.mock.calls.length, 0);
    });

    it('should show error toast when API call fails', async () => {
      const mockApiCall = mock.fn(() => Promise.reject(new Error('API error')));
      const mockShowConfirmation = mock.fn(() => Promise.resolve(true));
      const mockShowToast = mock.fn();
      const mockSelectRecs = mock.fn();

      await removeRecommendation(
        sampleRec,
        year,
        mockApiCall,
        mockShowConfirmation,
        mockShowToast,
        mockSelectRecs
      );

      assert.strictEqual(mockShowToast.mock.calls.length, 1);
      assert.strictEqual(
        mockShowToast.mock.calls[0].arguments[0],
        'Failed to remove recommendation'
      );
    });

    it('should pass correct confirmation message', async () => {
      const mockShowConfirmation = mock.fn(() => Promise.resolve(false));

      await removeRecommendation(
        sampleRec,
        year,
        mock.fn(),
        mockShowConfirmation,
        mock.fn(),
        mock.fn()
      );

      const args = mockShowConfirmation.mock.calls[0].arguments;
      assert.strictEqual(args[0], 'Remove Recommendation');
      assert.ok(args[1].includes('OK Computer'));
      assert.ok(args[1].includes('Radiohead'));
    });
  });
});
