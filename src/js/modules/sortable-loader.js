let sortablePromise = null;

export function loadSortable() {
  if (window.Sortable) {
    return Promise.resolve(window.Sortable);
  }

  if (sortablePromise) {
    return sortablePromise;
  }

  sortablePromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById('sortablejs-loader');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.Sortable));
      existingScript.addEventListener('error', reject);
      return;
    }

    const script = document.createElement('script');
    script.id = 'sortablejs-loader';
    script.src =
      'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js';
    script.async = true;
    script.onload = () => resolve(window.Sortable);
    script.onerror = () => reject(new Error('Failed to load SortableJS'));
    document.head.appendChild(script);
  });

  return sortablePromise;
}
