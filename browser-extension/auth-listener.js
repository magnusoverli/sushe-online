// Only the background worker may validate a pending login and persist tokens.
window.addEventListener('sushe-auth-complete', async (event) => {
  const { token, expiresAt } = event.detail || {};
  if (typeof token !== 'string') return;
  let result;
  try {
    const response = await chrome.runtime.sendMessage({
      action: globalThis.ExtensionConstants.ACTIONS.COMPLETE_LOGIN,
      token,
      expiresAt,
    });
    result = response?.success
      ? { success: true }
      : {
          success: false,
          error:
            response?.error || 'The extension did not confirm authorization',
        };
  } catch (error) {
    result = { success: false, error: error.message };
  }
  window.dispatchEvent(
    new CustomEvent('sushe-auth-result', { detail: result })
  );
});
