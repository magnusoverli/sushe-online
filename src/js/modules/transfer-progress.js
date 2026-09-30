const MEBIBYTE = 1024 * 1024;
const formatSize = (bytes) => `${(bytes / MEBIBYTE).toFixed(1)} MiB`;

// Native <progress> supplies accessible determinate/indeterminate semantics.
// Byte counts stay out of a live region to avoid announcing every network event.
export function createTransferProgress({ bar, text, action }) {
  function waiting(message) {
    bar?.removeAttribute('value');
    text.textContent = message;
  }

  function update({ loaded, total }) {
    const hasTotal = Number.isFinite(total) && total > 0 && loaded <= total;
    if (hasTotal) {
      const percent = Math.min(100, Math.floor((loaded / total) * 100));
      if (bar) bar.value = percent;
      text.textContent = `${action}... ${percent}% (${formatSize(loaded)} / ${formatSize(total)})`;
    } else {
      waiting(`${action}... ${formatSize(loaded)}`);
    }
  }

  function complete(message) {
    if (bar) bar.value = 100;
    text.textContent = message;
  }

  return { waiting, update, complete };
}
