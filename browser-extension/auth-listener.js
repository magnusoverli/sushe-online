// Content script that runs on /extension/auth page
// Listens for auth success event and stores token in chrome.storage

console.log('SuShe auth listener loaded');

// Listen for custom event from the page
window.addEventListener('sushe-auth-complete', async (event) => {
  console.log('Auth event received:', event.detail);

  const { token, expiresAt } = event.detail;

  if (token) {
    try {
      // Convert ISO string to milliseconds for proper expiry comparison
      // Server sends ISO string (e.g., "2026-03-28T12:17:58.718Z")
      // We need to store as milliseconds for Date.now() comparison
      const expiresAtMs = new Date(expiresAt).getTime();

      // Store token in chrome.storage
      // Token expiry is checked client-side by auth-state.js before any API operation
      // If expired, auth will be cleared automatically
      await chrome.storage.local.set({
        authToken: token,
        tokenExpiresAt: expiresAtMs,
      });

      console.log(
        'Token stored successfully, expires at:',
        new Date(expiresAtMs).toISOString()
      );
    } catch (error) {
      console.error('Error storing token:', error);
    }
  }
});
