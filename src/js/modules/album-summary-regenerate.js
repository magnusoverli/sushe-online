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

/** Matches the batch panel's cadence. */
const POLL_INTERVAL_MS = 2000;

/**
 * Give up waiting after this. Comfortably past the 120s request timeout plus
 * the service's own retries, so this only fires when something is genuinely
 * stuck rather than merely slow.
 */
const POLL_TIMEOUT_MS = 240000;

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
  const nowFn = deps.nowFn || (() => Date.now());
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeoutFn(r, ms)));
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
   * Read a thrown apiCall error.
   *
   * apiCall builds the Error's message from the response body's `error` field
   * and Object.assigns the rest of the body onto the error — there is no
   * `.data`. When the body is not JSON at all (a gateway's HTML 502, say) the
   * message is the generic "HTTP error! status: N", so the status is appended
   * to keep an infrastructure failure distinguishable from an application one.
   */
  function describeError(error) {
    const message = error?.message || 'Request failed';
    return error?.status && !message.includes(String(error.status))
      ? `${message} (HTTP ${error.status})`
      : message;
  }

  /**
   * Start a regeneration and poll until it settles.
   *
   * The request is not held open while the summary is fetched: that takes up
   * to two minutes, long enough for a proxy in front of the app to abandon the
   * connection and hand back a 502 while the work is still running fine.
   *
   * @param {string} albumId
   * @returns {Promise<{status: string, detail: string}>}
   */
  async function requestRegeneration(albumId) {
    try {
      await apiCall('/api/admin/album-summaries/regenerate', {
        method: 'POST',
        body: JSON.stringify({ albumId }),
      });
    } catch (error) {
      return { status: 'failed', detail: describeError(error) };
    }

    const deadline = nowFn() + POLL_TIMEOUT_MS;
    while (nowFn() < deadline) {
      await sleep(POLL_INTERVAL_MS);

      try {
        const job = await apiCall(
          `/api/admin/album-summaries/regenerate/status?albumId=${encodeURIComponent(albumId)}`
        );
        if (job?.status && job.status !== 'running') {
          return { status: job.status, detail: job.message || '' };
        }
      } catch (error) {
        // A 404 means the job is gone — the app restarted mid-run, so the
        // outcome is unknowable rather than merely late.
        if (error?.status === 404) {
          return {
            status: 'failed',
            detail: 'The regeneration was lost, most likely a server restart.',
          };
        }
        return { status: 'failed', detail: describeError(error) };
      }
    }

    return {
      status: 'failed',
      detail: 'Timed out waiting for the summary. It may still be running.',
    };
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
