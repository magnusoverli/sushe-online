export function createMobileCollectionPicker(deps = {}) {
  const {
    createActionSheet,
    getListMetadata,
    getSortedGroups,
    apiCall,
    showToast,
    refreshGroupsAndLists,
    updateListNav,
    logger = console,
  } = deps;

  return function showMobileCollectionPicker(listName) {
    const listMeta = getListMetadata(listName);
    const currentGroupId = listMeta?.groupId;

    const groups = getSortedGroups ? getSortedGroups() : [];
    const collections = groups.filter((group) => !group.isYearGroup);

    let collectionsHtml = '';
    if (collections.length === 0) {
      collectionsHtml = `
        <div class="py-3 px-4 text-gray-500 text-sm">
          <i class="fas fa-info-circle mr-3"></i>No collections available
        </div>
      `;
    } else {
      collections.forEach((collection) => {
        const isCurrentGroup = collection._id === currentGroupId;
        const checkmark = isCurrentGroup
          ? '<i class="fas fa-check text-green-500 ml-2"></i>'
          : '';
        const disabledClass = isCurrentGroup ? 'opacity-50' : '';

        collectionsHtml += `
          <button data-action="select-collection" 
                  data-group-id="${collection._id}"
                  data-group-name="${collection.name}"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm flex items-center justify-between ${disabledClass}"
                  ${isCurrentGroup ? 'disabled' : ''}>
            <span>
              <i class="fas fa-folder mr-3 text-gray-400"></i>${collection.name}
            </span>
            ${checkmark}
          </button>
        `;
      });
    }

    const { sheet: actionSheet, close } = createActionSheet({
      contentHtml: `
          <h3 class="font-semibold text-white mb-2">Move "${listName}"</h3>
          <p class="text-sm text-gray-500 mb-4">Select a collection</p>
          
          ${collectionsHtml}
          
          <button data-action="cancel"
                  class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
            Cancel
          </button>`,
      zIndex: '60',
      lgHidden: false,
      panelClasses: 'max-h-[70vh] overflow-y-auto',
    });

    actionSheet
      .querySelectorAll('[data-action="select-collection"]:not([disabled])')
      .forEach((btn) => {
        btn.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const groupId = btn.dataset.groupId;
          const groupName = btn.dataset.groupName;
          close();

          try {
            await apiCall(`/api/lists/${encodeURIComponent(listName)}/move`, {
              method: 'POST',
              body: JSON.stringify({ groupId }),
            });

            showToast(`Moved "${listName}" to "${groupName}"`, 'success');

            if (refreshGroupsAndLists) {
              await refreshGroupsAndLists();
            } else {
              updateListNav();
            }
          } catch (error) {
            logger.error('Failed to move list:', error);
            showToast('Failed to move list', 'error');
          }
        });
      });
  };
}
