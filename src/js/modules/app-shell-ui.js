/**
 * App shell UI helpers.
 *
 * Keeps lightweight DOM updates out of app.js orchestration.
 */

export function createAppShellUi(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);

  function showLoadingSpinner(container) {
    container.replaceChildren();
    const spinner = doc.createElement('div');
    spinner.className = 'text-center text-gray-500 mt-20 px-4';
    spinner.innerHTML = `
      <i class="fas fa-spinner fa-spin text-4xl text-gray-600"></i>
      <p class="text-sm mt-4">Loading...</p>
    `;
    container.appendChild(spinner);
  }

  function updateHeaderTitle(listName) {
    const headerAddAlbumBtn = doc?.getElementById('headerAddAlbumBtn');
    const mobileListName = doc?.getElementById('mobileCurrentListName');

    if (listName) {
      if (headerAddAlbumBtn) {
        headerAddAlbumBtn.classList.remove('hidden');
      }

      if (mobileListName) {
        mobileListName.textContent = listName;
        mobileListName.classList.remove('hidden');
      }
      return;
    }

    if (mobileListName) {
      mobileListName.classList.add('hidden');
      mobileListName.textContent = '';
    }
  }

  function isTextTruncated(element) {
    return element.scrollHeight > element.clientHeight;
  }

  return {
    showLoadingSpinner,
    updateHeaderTitle,
    isTextTruncated,
  };
}
