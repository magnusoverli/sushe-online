/**
 * Single-album summary regeneration.
 *
 * One module drives both platforms: desktop wires it to the context-menu entry,
 * mobile to the action-sheet row. The modal markup lives in the shared portal,
 * so neither platform owns a copy of this flow.
 *
 * Factory pattern: createAlbumSummaryRegenerate(deps) returns the public API.
 */

/** How long a success stays on screen before it dismisses itself. */
const SUCCESS_DISMISS_MS = 1800;

/**
 * How each outcome is presented. `settled` outcomes need acknowledging and keep
 * the modal open; the success case dismisses itself, since there is nothing to
 * read that the album row will not already show.
 */
const OUTCOMES = {
  ok: {
    icon: 'fa-circle-check',
    iconClass: 'text-3xl text-green-500',
    heading: 'Summary regenerated',
    autoDismiss: true,
  },
  no_summary: {
    icon: 'fa-circle-question',
    iconClass: 'text-3xl text-yellow-500',
    heading: 'No summary found',
    autoDismiss: false,
  },
  skipped: {
    icon: 'fa-circle-minus',
    iconClass: 'text-3xl text-gray-400',
    heading: 'Album skipped',
    autoDismiss: false,
  },
  failed: {
    icon: 'fa-circle-exclamation',
    iconClass: 'text-3xl text-red-500',
    heading: 'Regeneration failed',
    autoDismiss: false,
  },
};

export function createAlbumSummaryRegenerate(deps = {}) {
  const doc =
    deps.doc || (typeof document !== 'undefined' ? document : undefined);
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn || clearTimeout;
  const { apiCall, showToast } = deps;

  // Distinguishes runs so a slow response cannot land on a later one's modal.
  let currentRun = 0;
  let dismissTimer = null;
  let detachListeners = null;

  function elements() {
    if (!doc) return null;
    const modal = doc.getElementById('regenerateSummaryModal');
    if (!modal) return null;
    return {
      modal,
      icon: doc.getElementById('regenerateSummaryIcon'),
      heading: doc.getElementById('regenerateSummaryHeading'),
      subtitle: doc.getElementById('regenerateSummarySubtitle'),
      detail: doc.getElementById('regenerateSummaryDetail'),
      footer: doc.getElementById('regenerateSummaryFooter'),
      closeBtn: doc.getElementById('regenerateSummaryCloseBtn'),
    };
  }

  function clearDismissTimer() {
    if (dismissTimer) {
      clearTimeoutFn(dismissTimer);
      dismissTimer = null;
    }
  }

  function close() {
    clearDismissTimer();
    if (detachListeners) {
      detachListeners();
      detachListeners = null;
    }
    // Any in-flight response now belongs to a run nobody is watching.
    currentRun++;
    elements()?.modal.classList.add('hidden');
  }

  /**
   * Show the running state and bind dismissal.
   *
   * Dismissal is available immediately rather than only once a result lands: a
   * summary fetch can take the better part of the request timeout, and trapping
   * an admin behind a spinner for that long to no purpose is worse than letting
   * the outcome arrive as a toast.
   */
  function openRunning(album) {
    const el = elements();
    if (!el) return false;

    clearDismissTimer();
    if (detachListeners) detachListeners();

    el.icon.className = 'text-3xl text-gray-500';
    el.icon.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    el.heading.textContent = 'Regenerating summary';
    // textContent, not innerHTML: artist and album are user-supplied.
    el.subtitle.textContent = `${album.album} by ${album.artist}`;
    el.detail.textContent = '';
    el.detail.classList.add('hidden');
    el.footer.classList.add('hidden');
    el.modal.classList.remove('hidden');

    const onBackdrop = (e) => {
      if (e.target === el.modal) close();
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') close();
    };
    const onClose = () => close();

    el.modal.addEventListener('click', onBackdrop);
    doc.addEventListener('keydown', onEsc);
    el.closeBtn.addEventListener('click', onClose);

    detachListeners = () => {
      el.modal.removeEventListener('click', onBackdrop);
      doc.removeEventListener('keydown', onEsc);
      el.closeBtn.removeEventListener('click', onClose);
    };

    return true;
  }

  function showOutcome(status, detail) {
    const spec = OUTCOMES[status] || OUTCOMES.failed;
    const el = elements();
    if (!el) return;

    el.icon.className = spec.iconClass;
    el.icon.innerHTML = `<i class="fas ${spec.icon}"></i>`;
    el.heading.textContent = spec.heading;

    if (detail) {
      el.detail.textContent = detail;
      el.detail.classList.remove('hidden');
    } else {
      el.detail.classList.add('hidden');
    }

    if (spec.autoDismiss) {
      dismissTimer = setTimeoutFn(close, SUCCESS_DISMISS_MS);
    } else {
      el.footer.classList.remove('hidden');
    }
  }

  /**
   * Call the endpoint and normalise every reply into one outcome shape.
   *
   * @param {string} albumId
   * @returns {Promise<{status: string, detail: string}>}
   */
  async function requestRegeneration(albumId) {
    try {
      const response = await apiCall('/api/admin/album-summaries/regenerate', {
        method: 'POST',
        body: JSON.stringify({ albumId }),
      });
      return {
        status: response?.status || 'failed',
        detail: response?.message || '',
      };
    } catch (error) {
      // apiCall surfaces the server's JSON body on .data for non-2xx replies.
      return {
        status: 'failed',
        detail: error?.data?.error || error?.message || 'Request failed',
      };
    }
  }

  /**
   * Regenerate one album's summary and report the outcome.
   *
   * Resolves to the outcome status so callers can react; it never rejects,
   * because every failure path is already reported to the admin.
   *
   * @param {{artist: string, album: string, album_id?: string}} album
   * @returns {Promise<'ok'|'no_summary'|'skipped'|'failed'>}
   */
  async function regenerateSummary(album) {
    if (!album?.album_id) {
      showToast?.('This album has no identity to regenerate from', 'error');
      return 'failed';
    }

    const run = ++currentRun;
    const opened = openRunning(album);

    const { status, detail } = await requestRegeneration(album.album_id);

    // A later run, or a dismissal, has taken over the modal since this started.
    if (run !== currentRun) {
      if (status !== 'ok') {
        showToast?.(detail || 'Summary regeneration failed', 'error');
      }
      return status;
    }

    if (opened) {
      showOutcome(status, detail);
    } else {
      // No modal in this DOM — say it with a toast rather than silently.
      showToast?.(
        status === 'ok'
          ? 'Summary regenerated'
          : detail || 'Regeneration failed',
        status === 'ok' ? 'success' : 'error'
      );
    }

    return status;
  }

  return {
    regenerateSummary,
    closeRegenerateSummaryModal: close,
  };
}
