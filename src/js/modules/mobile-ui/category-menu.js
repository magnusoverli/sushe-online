import { deleteCollection } from '../../utils/delete-collection.js';

export function createMobileCategoryMenu(deps = {}) {
  const {
    createActionSheet,
    openRenameCategoryModal,
    showToast,
    apiCall,
    getLists,
    refreshGroupsAndLists,
    updateListNav,
    showConfirmation,
    logger = console,
  } = deps;

  return function showMobileCategoryMenu(groupId, groupName, isYearGroup) {
    if (groupId === 'orphaned') {
      return;
    }

    const { sheet: actionSheet, close } = createActionSheet({
      contentHtml: `
          <h3 class="font-semibold text-white mb-4">${groupName}</h3>
          
          ${
            !isYearGroup
              ? `
          <button data-action="rename"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-edit mr-3 text-gray-400"></i>Rename
          </button>
          `
              : ''
          }
          
          ${
            !isYearGroup
              ? `
          <button data-action="delete"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm text-red-500">
            <i class="fas fa-trash mr-3"></i>Delete
          </button>
          `
              : `
          <div class="py-3 px-4 text-gray-500 text-sm">
            <i class="fas fa-info-circle mr-3"></i>Year groups are removed automatically when empty
          </div>
          `
          }
          
          <button data-action="cancel"
                  class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
            Cancel
          </button>`,
      zIndex: '60',
      lgHidden: false,
    });

    const renameBtn = actionSheet.querySelector('[data-action="rename"]');
    const deleteBtn = actionSheet.querySelector('[data-action="delete"]');

    if (renameBtn) {
      renameBtn.addEventListener('click', () => {
        close();

        if (isYearGroup) {
          showToast(
            'Year groups cannot be renamed. The name matches the year.',
            'info'
          );
          return;
        }

        if (typeof openRenameCategoryModal === 'function') {
          openRenameCategoryModal(groupId, groupName);
        }
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        close();

        if (isYearGroup) {
          showToast('Year groups are removed automatically when empty', 'info');
          return;
        }

        // Count this collection's lists from local state so we don't fire a
        // delete request we already know the server will reject with a 409.
        const lists = getLists?.() || {};
        const listCount = Object.values(lists).filter(
          (list) => list && list.groupId === groupId
        ).length;

        await deleteCollection({
          id: groupId,
          name: groupName,
          listCount,
          apiCall,
          showConfirmation,
          showToast,
          refresh: refreshGroupsAndLists || (() => updateListNav()),
          logger,
        });
      });
    }
  };
}
