// Content script that runs on /extension/auth page
// Listens for auth success event and stores token in chrome.storage

/* global CustomEvent, sessionStorage */

console.log('SuShe auth listener loaded');

// Listen for custom event from the page
window.addEventListener('sushe-auth-complete', async (event) => {
  console.log('Auth event received:', event.detail);

  const { token, expiresAt } = event.detail;

  if (token) {
    try {
      // Store token in chrome.storage
      await chrome.storage.local.set({
        authToken: token,
        tokenExpiresAt: expiresAt,
      });

      console.log('Token stored successfully');

      // Notify the page that storage was successful
      window.dispatchEvent(
        new CustomEvent('sushe-auth-stored', {
          detail: { success: true },
        })
      );
    } catch (error) {
      console.error('Error storing token:', error);
      window.dispatchEvent(
        new CustomEvent('sushe-auth-stored', {
          detail: { success: false, error: error.message },
        })
      );
    }
  }
});

// Also check sessionStorage on load (backup method)
try {
  const token = sessionStorage.getItem('sushe_auth_token');
  const expiresAt = sessionStorage.getItem('sushe_auth_expires');

  if (token && expiresAt) {
    console.log('Found token in sessionStorage, storing...');
    chrome.storage.local
      .set({
        authToken: token,
        tokenExpiresAt: expiresAt,
      })
      .then(() => {
        console.log('Token from sessionStorage stored successfully');
        // Clear sessionStorage
        sessionStorage.removeItem('sushe_auth_token');
        sessionStorage.removeItem('sushe_auth_expires');
      });
  }
} catch (error) {
  console.log('Could not read sessionStorage:', error);
}
