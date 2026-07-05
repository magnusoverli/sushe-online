/**
 * UI Factory Functions
 *
 * Shared factory functions for creating settings modals and mobile action sheets.
 * Eliminates boilerplate DOM creation, event wiring, and cleanup logic.
 */

import { createModal, destroyModalForElement } from './modal-factory.js';

/**
 * Create a settings modal with standard structure and close behavior.
 *
 * @param {Object} options
 * @param {string} options.id - Modal element ID
 * @param {string} options.title - Modal title (can include HTML for icons)
 * @param {string} options.bodyHtml - Inner HTML for the modal body
 * @param {string} [options.footerHtml] - Inner HTML for the modal footer
 * @param {string} [options.maxWidth] - CSS max-width value (e.g. '32rem', '600px')
 * @param {string} [options.maxHeight] - CSS max-height for the content container
 * @param {string} [options.bodyStyle] - Additional inline style for the body element
 * @param {boolean} [options.startHidden=false] - Whether to add 'hidden' class initially
 * @param {boolean} [options.appendToBody=false] - Whether to append to document.body
 * @param {Function} [options.onClose] - Extra cleanup callback when modal closes
 * @returns {{ modal: HTMLElement, close: Function }}
 */
export function createSettingsModal({
  id,
  title,
  bodyHtml,
  footerHtml = '',
  maxWidth,
  maxHeight,
  bodyStyle,
  startHidden = false,
  appendToBody = false,
  onClose,
}) {
  const modal = document.createElement('div');
  // Always build hidden; the controller's open() reveals it (and applies scroll
  // lock, focus trap and Escape/backdrop handling).
  modal.className = 'settings-modal hidden';
  modal.id = id;
  const titleId = `${id}-title`;

  const contentStyle = [
    maxWidth ? `max-width: ${maxWidth}` : '',
    maxHeight ? `max-height: ${maxHeight}` : '',
  ]
    .filter(Boolean)
    .join('; ');

  const bodyStyleAttr = bodyStyle ? ` style="${bodyStyle}"` : '';

  modal.innerHTML = `
    <div class="settings-modal-backdrop"></div>
    <div class="settings-modal-content"${contentStyle ? ` style="${contentStyle}"` : ''}>
      <div class="settings-modal-header">
        <h3 class="settings-modal-title" id="${titleId}">${title}</h3>
        <button class="settings-modal-close" aria-label="Close">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="settings-modal-body"${bodyStyleAttr}>${bodyHtml}</div>
      ${footerHtml ? `<div class="settings-modal-footer">${footerHtml}</div>` : ''}
    </div>
  `;

  if (appendToBody) {
    document.body.appendChild(modal);
  }

  const controller = createModal({
    element: modal,
    dialog: modal.querySelector('.settings-modal-content'),
    backdrop: modal.querySelector('.settings-modal-backdrop'),
    closeButton: modal.querySelector('.settings-modal-close'),
    labelledBy: titleId,
    onClose: () => {
      // Keep the exit animation: hide first (createModal added .hidden), then
      // remove the element after the transition.
      setTimeout(() => {
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
        if (onClose) {
          onClose();
        }
      }, 300);
    },
  });

  if (!startHidden) {
    controller.open();
  }

  return {
    modal,
    open: () => controller.open(),
    close: () => controller.close(),
  };
}

/**
 * Create a mobile action sheet with standard structure and close behavior.
 *
 * @param {Object} options
 * @param {string} options.contentHtml - Inner HTML for the action sheet content
 * @param {string} [options.zIndex='50'] - Tailwind z-index value (e.g. '50', '60')
 * @param {boolean} [options.lgHidden=true] - Whether to add lg:hidden class
 * @param {string} [options.panelClasses=''] - Extra classes on the bottom panel div
 * @param {boolean} [options.hideFAB=true] - Whether to hide the FAB on open
 * @param {boolean} [options.restoreFAB=true] - Whether to restore the FAB on close
 * @param {boolean} [options.checkCurrentList=true] - Check currentList before restoring FAB
 * @param {string} [options.label] - Accessible name for the sheet; providing it
 *   (or labelledBy) makes the panel a real dialog via createModal's a11y path
 *   (role/aria-modal, focus moved in, Tab trap, focus restore on close)
 * @param {string} [options.labelledBy] - ID of an element naming the sheet
 * @param {Function} [options.onClose] - Extra cleanup callback when sheet closes
 * @returns {{ sheet: HTMLElement, close: Function }}
 */
export function createActionSheet({
  contentHtml,
  zIndex = '50',
  lgHidden = true,
  panelClasses = '',
  hideFAB = true,
  restoreFAB = true,
  checkCurrentList = true,
  label,
  labelledBy,
  onClose,
}) {
  // Remove any existing action sheet at this z-level
  const zClass = zIndex === '50' ? 'z-50' : `z-${zIndex}`;
  const escapedSelector =
    zIndex === '50'
      ? '.fixed.inset-0.z-50.lg\\:hidden'
      : `.fixed.inset-0.z-\\[${zIndex}\\]`;
  const existingSheet = document.querySelector(escapedSelector);
  if (existingSheet) {
    destroyModalForElement(existingSheet);
  }

  // Hide FAB if requested
  if (hideFAB) {
    const fab = document.getElementById('addAlbumFAB');
    if (fab) {
      fab.style.display = 'none';
    }
  }

  const sheet = document.createElement('div');
  const classes = ['fixed', 'inset-0', zClass];
  if (lgHidden) {
    classes.push('lg:hidden');
  }
  sheet.className = classes.join(' ');

  const panelExtraClasses = panelClasses ? ` ${panelClasses}` : '';
  sheet.innerHTML = `
    <div class="absolute inset-0 modal-overlay" data-backdrop></div>
    <div data-sheet-panel class="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl safe-area-bottom${panelExtraClasses}">
      <div class="p-4">
        <div class="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4"></div>
        ${contentHtml}
      </div>
    </div>
  `;

  document.body.appendChild(sheet);

  // Backdrop, cancel button, Escape and tracked cleanup via the shared
  // controller. Scroll lock is OFF so replacing sheets at the same z-level does
  // not unexpectedly affect page scroll.
  const controller = createModal({
    element: sheet,
    dialog:
      label || labelledBy
        ? sheet.querySelector('[data-sheet-panel]')
        : undefined,
    backdrop: sheet.querySelector('[data-backdrop]'),
    closeButton: sheet.querySelector('[data-action="cancel"]'),
    label,
    labelledBy,
    lockScroll: false,
    onClose: () => {
      sheet.remove();
      if (restoreFAB) {
        const fabElement = document.getElementById('addAlbumFAB');
        if (checkCurrentList) {
          // eslint-disable-next-line no-undef
          if (fabElement && typeof currentList !== 'undefined' && currentList) {
            fabElement.style.display = 'flex';
          }
        } else if (fabElement) {
          fabElement.style.display = 'flex';
        }
      }
      if (onClose) {
        onClose();
      }
    },
  });
  controller.open();

  return { sheet, close: () => controller.close() };
}
