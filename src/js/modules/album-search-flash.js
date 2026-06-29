/**
 * Album-search flash controller.
 *
 * Highlights the matched album row after the search jumps to its list.
 *
 * The album list re-renders by replacing every row element (displayAlbums ->
 * container.replaceChildren), so a flash class pinned to one element is
 * discarded whenever a rebuild lands right after we apply it — e.g. the
 * deferred full-profile hydrate, or a faster cached-data render that lets a
 * rebuild fire almost immediately. So each flash runs as a short "session":
 * we (re)apply the highlight to the album's CURRENT row, and a MutationObserver
 * re-applies it to the freshly built row whenever the list rebuilds. The
 * animation is resumed at the correct wall-clock point via a negative
 * animation-delay, so re-applying continues the same ~3s fade seamlessly
 * instead of restarting from full brightness.
 */

const FLASH_DURATION_MS = 3200;
const MAX_PAINT_FRAMES = 30;

export function createAlbumFlash(deps = {}) {
  const { doc, win, getListData } = deps;
  let session = null;

  function clear() {
    if (!session) return;
    const current = session;
    session = null;
    if (current.observer) current.observer.disconnect();
    win.clearTimeout(current.removeTimer);
    if (current.row) {
      current.row.classList.remove('album-search-flash');
      current.row.style.animationDelay = '';
    }
  }

  function flash(listId, albumId) {
    clear();

    const container = doc.getElementById('albumContainer');
    if (!container) return;

    const startedAt = Date.now();
    const current = {
      row: null,
      observer: null,
      removeTimer: null,
      scrolled: false,
    };
    session = current;

    const findRow = () => {
      const data =
        (typeof getListData === 'function' ? getListData(listId) : null) || [];
      const idx = data.findIndex(
        (item) => item && (item.album_id || item.albumId) === albumId
      );
      if (idx < 0) return null;
      return container.querySelector(`[data-index="${idx}"]`);
    };

    const apply = (row) => {
      if (session !== current || !row) return;
      current.row = row;
      if (!current.scrolled) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        current.scrolled = true;
      }
      // Resume the animation at the current point in wall-clock time so a
      // re-apply after a rebuild continues the fade rather than flashing anew,
      // and the highlight always finishes ~3s after the jump.
      const elapsed = (Date.now() - startedAt) / 1000;
      row.classList.remove('album-search-flash');
      row.style.animationDelay = `-${elapsed}s`;
      void row.offsetWidth; // reflow so the animation (re)attaches
      row.classList.add('album-search-flash');
    };

    // Initial application — retry for a few frames until the row is painted.
    const tryInitial = (attempt = 0) => {
      if (session !== current) return;
      const row = findRow();
      if (row) {
        apply(row);
        return;
      }
      if (attempt < MAX_PAINT_FRAMES) {
        win.requestAnimationFrame(() => tryInitial(attempt + 1));
      }
    };
    tryInitial();

    // Re-apply to the new row if a rebuild discards ours during the window.
    current.observer = new win.MutationObserver(() => {
      if (session !== current) return;
      if (container.querySelector('.album-search-flash')) return; // ours survives
      const row = findRow();
      if (row) apply(row);
    });
    current.observer.observe(container, { childList: true, subtree: true });

    current.removeTimer = win.setTimeout(clear, FLASH_DURATION_MS);
  }

  return { flash, clear };
}
