// Only the background worker may validate a pending login and persist tokens.
window.addEventListener('sushe-auth-complete', async (event) => {
  const { token, expiresAt } = event.detail || {};
  if (typeof token !== 'string') return;
  try {
    await chrome.runtime.sendMessage({
      action: globalThis.ExtensionConstants.ACTIONS.COMPLETE_LOGIN,
      token,
      expiresAt,
    });
  } catch (_error) {
    console.warn('Extension login could not be completed');
  }
});
