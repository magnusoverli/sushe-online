// Use global functions from window that are defined in app.js
export const showToast = window.showToast;
export const apiCall =
  window.apiCall ||
  async function apiCall(url, options = {}) {
    const defaults = {
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const response = await fetch(url, { ...defaults, ...options });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  };

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
