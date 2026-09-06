import { buildListMenuConfig } from '../list-menu-shared.js';
import { escapeHtml } from '../html-utils.js';

export function createMobileListActionMenu(deps = {}) {
  const {
    createActionSheet,
    getListMetadata,
    getSortedGroups,
    getCurrentUser,
    listMenuActions,
    showMobileCollectionPicker,
  } = deps;

  return function showMobileListMenu(listId) {
    const listMeta = getListMetadata(listId);
    const listName = listMeta?.name || listId;
    const menuConfig = buildListMenuConfig({
      listMeta,
      groups: getSortedGroups ? getSortedGroups() : [],
      currentUser: getCurrentUser(),
    });

    const { sheet: actionSheet, close } = createActionSheet({
      contentHtml: `
          <h3 class="font-semibold text-white mb-4">${escapeHtml(listName)}</h3>
          
          <div class="download-section">
            <button data-action="download-toggle"
                    class="w-full flex items-center justify-between py-3 px-4 hover:bg-gray-800 rounded-sm">
              <span>
                <i class="fas fa-download mr-3 text-gray-400"></i>Download List...
              </span>
              <i class="fas fa-chevron-down text-gray-500 text-xs transition-transform duration-200" data-download-chevron></i>
            </button>
            
            <div data-download-options class="hidden overflow-hidden transition-all duration-200 ease-out" style="max-height: 0;">
              <div class="ml-4 border-l-2 border-gray-700 pl-4 py-1">
                <button data-action="download-json"
                        class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm flex items-center">
                  <i class="fas fa-file-code mr-3 text-gray-400 text-sm"></i>
                  <span class="text-sm">Download as JSON</span>
                </button>
                <button data-action="download-pdf"
                        class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm flex items-center">
                  <i class="fas fa-file-pdf mr-3 text-gray-400 text-sm"></i>
                  <span class="text-sm">Download as PDF</span>
                </button>
                <button data-action="download-csv"
                        class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm flex items-center">
                  <i class="fas fa-file-csv mr-3 text-gray-400 text-sm"></i>
                  <span class="text-sm">Download as CSV</span>
                </button>
              </div>
            </div>
          </div>
          
          <button data-action="edit"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-edit mr-3 text-gray-400"></i>Edit Details
          </button>
          
          ${
            menuConfig.hasYear
              ? `
          <button data-action="toggle-main"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas ${menuConfig.mainIconClass} mr-3 text-yellow-500"></i>${menuConfig.mainToggleText}
          </button>
          `
              : ''
          }
          
          <button data-action="send-to-service"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-paper-plane mr-3 text-gray-400"></i>${menuConfig.musicServiceText}
          </button>
          
          ${
            menuConfig.isInCollection
              ? `
          <button data-action="move-to-collection"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-folder-open mr-3 text-gray-400"></i>Move to Collection
          </button>
          `
              : ''
          }
          
          <button data-action="delete"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm text-red-500">
            <i class="fas fa-trash mr-3"></i>Delete List
          </button>
          
          <button data-action="cancel"
                  class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
            Cancel
          </button>`,
      zIndex: '60',
      lgHidden: false,
    });

    const downloadToggleBtn = actionSheet.querySelector(
      '[data-action="download-toggle"]'
    );
    const downloadOptions = actionSheet.querySelector(
      '[data-download-options]'
    );
    const downloadChevron = actionSheet.querySelector(
      '[data-download-chevron]'
    );
    const downloadJsonBtn = actionSheet.querySelector(
      '[data-action="download-json"]'
    );
    const downloadPdfBtn = actionSheet.querySelector(
      '[data-action="download-pdf"]'
    );
    const downloadCsvBtn = actionSheet.querySelector(
      '[data-action="download-csv"]'
    );
    const editBtn = actionSheet.querySelector('[data-action="edit"]');
    const toggleMainBtn = actionSheet.querySelector(
      '[data-action="toggle-main"]'
    );
    const sendToServiceBtn = actionSheet.querySelector(
      '[data-action="send-to-service"]'
    );
    const deleteBtn = actionSheet.querySelector('[data-action="delete"]');

    let isDownloadExpanded = false;
    const toggleDownloadOptions = () => {
      isDownloadExpanded = !isDownloadExpanded;
      if (isDownloadExpanded) {
        downloadOptions.classList.remove('hidden');
        void downloadOptions.offsetHeight;
        downloadOptions.style.maxHeight = downloadOptions.scrollHeight + 'px';
        if (downloadChevron) downloadChevron.style.transform = 'rotate(180deg)';
      } else {
        downloadOptions.style.maxHeight = '0';
        if (downloadChevron) downloadChevron.style.transform = 'rotate(0deg)';
        setTimeout(() => {
          if (!isDownloadExpanded) {
            downloadOptions.classList.add('hidden');
          }
        }, 200);
      }
    };

    downloadToggleBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleDownloadOptions();
    });

    downloadJsonBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      close();
      listMenuActions.downloadList(listId, 'json');
    });

    downloadPdfBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      close();
      listMenuActions.downloadList(listId, 'pdf');
    });

    downloadCsvBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      close();
      listMenuActions.downloadList(listId, 'csv');
    });

    editBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      close();
      listMenuActions.renameList(listId);
    });

    if (toggleMainBtn) {
      toggleMainBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
        listMenuActions.toggleMainForList(listId);
      });
    }

    sendToServiceBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      close();
      await listMenuActions.sendToMusicService(listId);
    });

    const moveToCollectionBtn = actionSheet.querySelector(
      '[data-action="move-to-collection"]'
    );
    if (moveToCollectionBtn) {
      moveToCollectionBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
        showMobileCollectionPicker(listId);
      });
    }

    deleteBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      close();

      await listMenuActions.deleteList(listId);
    });
  };
}
