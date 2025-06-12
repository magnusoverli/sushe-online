window.addEventListener('load', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }

  const prefetch = () => {
    fetch('/api/lists', { credentials: 'include' }).catch(() => {});
    fetch('/genres.txt').catch(() => {});
    fetch('/countries.txt').catch(() => {});
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(prefetch);
  } else {
    setTimeout(prefetch, 2000);
  }
});
