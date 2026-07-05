export function afterFrame(win, callback) {
  if (typeof win?.requestAnimationFrame === 'function') {
    win.requestAnimationFrame(callback);
    return;
  }
  if (typeof globalThis.requestAnimationFrame === 'function') {
    globalThis.requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
}
