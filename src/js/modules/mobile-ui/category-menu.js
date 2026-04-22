export function createMobileCategoryMenu(deps = {}) {
  const {
    createActionSheet,
    openRenameCategoryModal,
    showToast,
    apiCall,
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

        try {
          await apiCall(`/api/groups/${groupId}`, { method: 'DELETE' });
          showToast(`Collection "${groupName}" deleted`);
          if (refreshGroupsAndLists) {
            await refreshGroupsAndLists();
          } else {
            updateListNav();
          }
        } catch (error) {
          if (error.requiresConfirmation && error.listCount > 0) {
            const listWord = error.listCount === 1 ? 'list' : 'lists';
            const confirmed = await showConfirmation(
              'Delete Collection',
              `The collection "${groupName}" contains ${error.listCount} ${listWord}.`,
              `Deleting this collection will move the ${listWord} to "Uncategorized". This action cannot be undone.`,
              'Delete Collection',
              null,
              {
                checkboxLabel: `I understand that ${error.listCount} ${listWord} will be moved to "Uncategorized"`,
              }
            );

            if (confirmed) {
              try {
                await apiCall(`/api/groups/${groupId}?force=true`, {
                  method: 'DELETE',
                });
                showToast(`Collection "${groupName}" deleted`);
                if (refreshGroupsAndLists) {
                  await refreshGroupsAndLists();
                } else {
                  updateListNav();
                }
              } catch (forceError) {
                logger.error('Error force-deleting collection:', forceError);
                showToast(
                  forceError.message || 'Failed to delete collection',
                  'error'
                );
              }
            }
          } else {
            logger.error('Error deleting collection:', error);
            showToast(error.message || 'Failed to delete collection', 'error');
          }
        }
      });
    }
  };
}
