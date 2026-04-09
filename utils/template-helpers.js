function createAssetHelper(assetVersion) {
  return (assetPath) => `${assetPath}?v=${assetVersion}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJsonStringify(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function modalShell({
  id,
  body,
  maxWidth = 'max-w-md',
  title,
  subtitle,
  footer,
  extraContainerClass = '',
  extraOverlayClass = '',
}) {
  const header =
    title != null
      ? `<div class="p-6 border-b border-gray-800">
        <h3 class="text-2xl font-bold text-white">${title}</h3>
        ${subtitle ? `<p class="text-sm text-gray-400 mt-1">${subtitle}</p>` : ''}
      </div>`
      : '';

  const footerHtml = footer
    ? `<div class="p-6 border-t border-gray-800 flex gap-3 justify-end">${footer}</div>`
    : '';

  return `<div id="${id}" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 safe-area-modal${extraOverlayClass ? ' ' + extraOverlayClass : ''}">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full ${maxWidth}${extraContainerClass ? ' ' + extraContainerClass : ''}">
      ${header}
      <div class="p-6${title ? '' : ' pt-6'}">${body}</div>
      ${footerHtml}
    </div>
  </div>`;
}

function menuItem({
  id,
  icon,
  label,
  hoverColor = 'hover:text-white',
  hasSubmenu = false,
  hidden = false,
  iconColor = '',
}) {
  const hiddenClass = hidden ? 'hidden ' : '';
  const iconColorClass = iconColor ? ` ${iconColor}` : '';

  if (hasSubmenu) {
    return `<button id="${id}" class="${hiddenClass}w-full flex items-center justify-between px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 ${hoverColor} transition-colors whitespace-nowrap relative">
      <span><i class="fas ${icon} ctx-menu-icon${iconColorClass}"></i>${label}</span>
      <i class="fas fa-chevron-right text-xs text-gray-500 ml-4"></i>
    </button>`;
  }

  return `<button id="${id}" class="${hiddenClass}ctx-menu-item ${hoverColor}">
      <i class="fas ${icon} ctx-menu-icon${iconColorClass}"></i>${label}
    </button>`;
}

function formatDate(date, format = 'MM/DD/YYYY') {
  if (!date) return '';
  const locale = format === 'DD/MM/YYYY' ? 'en-GB' : 'en-US';
  return new Date(date).toLocaleDateString(locale);
}

function formatDateTime(date, hour12, format = 'MM/DD/YYYY') {
  if (!date) return '';
  const locale = format === 'DD/MM/YYYY' ? 'en-GB' : 'en-US';
  const options = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12,
  };
  return new Date(date).toLocaleString(locale, options);
}

module.exports = {
  createAssetHelper,
  escapeHtml,
  safeJsonStringify,
  modalShell,
  menuItem,
  formatDate,
  formatDateTime,
};
