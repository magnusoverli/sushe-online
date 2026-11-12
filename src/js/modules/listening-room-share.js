import { createModal } from './modal-factory.js';

const COPIED_DURATION_MS = 2000;

export function listeningRoomSummary({ songCount, leftOut }) {
  const songs =
    songCount === 0
      ? 'No songs yet. Pick tracks in this list; the link always shows the current picks.'
      : `${songCount} ${songCount === 1 ? 'song' : 'songs'}.`;
  const omitted = [];
  if (leftOut.noPick > 0)
    omitted.push(
      `${leftOut.noPick} ${leftOut.noPick === 1 ? 'album' : 'albums'} without a track pick`
    );
  if (leftOut.disqualified > 0)
    omitted.push(
      `${leftOut.disqualified} disqualified ${leftOut.disqualified === 1 ? 'album' : 'albums'}`
    );
  return songs + (omitted.length ? ` Left out: ${omitted.join(', ')}.` : '');
}

export function openListeningRoomShare(share, listId, deps = {}) {
  const {
    doc = document,
    clipboard = navigator.clipboard,
    modalFactory = createModal,
    apiCall,
    showToast,
    showConfirmation,
  } = deps;
  const modal = doc.createElement('div');
  modal.id = 'listeningRoomShareModal';
  modal.className =
    'fixed inset-0 modal-overlay modal-layer flex items-center justify-center p-4 safe-area-modal';
  modal.innerHTML = `
    <div class="bg-gray-900 border border-gray-800 rounded-lg w-full max-w-md max-h-full flex flex-col">
      <div class="p-6 border-b border-gray-800 shrink-0">
        <h3 class="text-xl font-bold text-white">Shared with Doom Room.</h3>
      </div>
      <div data-share-details class="p-6 space-y-4 text-sm text-gray-300 overflow-y-auto min-h-0">
        <label class="block">Share link
          <input data-share-url type="text" readonly class="mt-2 w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white focus:outline-hidden focus:border-gray-500">
        </label>
        <p data-share-summary></p>
        <p data-share-expiry></p>
        <p>Anyone with this link can see these picks until it expires.</p>
        <p>In Doom Room, open Your playlist → Import list and paste the link.</p>
        <p data-share-status role="status" aria-live="polite"></p>
      </div>
      <div class="p-6 border-t border-gray-800 flex flex-wrap gap-3 justify-end shrink-0">
        <button data-stop-sharing class="btn-modal-cancel text-red-500">Stop sharing</button>
        <button data-close-share class="btn-modal-cancel">Close</button>
        <button data-copy-share class="btn-primary">Copy link</button>
      </div>
    </div>`;
  doc.body.appendChild(modal);
  const input = modal.querySelector('[data-share-url]');
  const copyButton = modal.querySelector('[data-copy-share]');
  const stopButton = modal.querySelector('[data-stop-sharing]');
  const details = modal.querySelector('[data-share-details]');
  const status = modal.querySelector('[data-share-status]');
  input.value = share.url;
  modal.querySelector('[data-share-summary]').textContent =
    listeningRoomSummary(share);
  const expiry = new Date(share.expiresAt).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  modal.querySelector('[data-share-expiry]').textContent =
    `Works until ${expiry}. Sharing again restarts the week.`;
  let copiedTimer;
  let suspended = false;
  let stopped = false;

  async function copyLink(automatic = false) {
    try {
      // Called directly in the click handler, before any await/network request,
      // so Safari retains the button tap's clipboard permission.
      await clipboard.writeText(share.url);
      if (!controller.isOpen() || stopped) return;
      status.textContent = 'Link copied';
      copyButton.textContent = 'Copied';
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copyButton.textContent = 'Copy link';
      }, COPIED_DURATION_MS);
    } catch {
      if (!automatic) showToast("Couldn't copy the link. Try again.", 'error');
    }
  }

  async function stopSharing() {
    // Suspend this dialog while using the existing confirmation dialog, avoiding
    // competing focus traps, Escape handlers and stacked scroll locks.
    suspended = true;
    controller.close();
    try {
      const confirmed = await showConfirmation(
        'Stop sharing',
        'Stop sharing this list? The link stops working right away.',
        '',
        'Stop sharing'
      );
      if (!confirmed) return;
      await apiCall(
        `/api/lists/${encodeURIComponent(listId)}/listening-room-share`,
        { method: 'DELETE' }
      );
      stopped = true;
      details.textContent = 'Sharing stopped. The link no longer works.';
      copyButton.hidden = true;
      stopButton.hidden = true;
    } catch {
      showToast("Couldn't stop sharing. Try again.", 'error');
    } finally {
      suspended = false;
      controller.open();
    }
  }

  const controller = modalFactory({
    element: modal,
    backdrop: modal,
    closeButton: modal.querySelector('[data-close-share]'),
    label: 'Shared with Doom Room.',
    onOpen: () => {
      if (!stopped) {
        controller.addListener(copyButton, 'click', () => copyLink());
        controller.addListener(stopButton, 'click', stopSharing);
      }
    },
    onClose: () => {
      clearTimeout(copiedTimer);
      copyButton.textContent = 'Copy link';
      if (!suspended) modal.remove();
    },
  });
  controller.open();
  void copyLink(true);
  return controller;
}
