import { buildListMenuConfig } from '../list-menu-shared.js';

export function createMobileListMenus(deps = {}) {
  const {
    doc = typeof document !== 'undefined' ? document : null,
    createActionSheet,
    getCurrentList,
    getLists,
    getListMetadata,
    getSortedGroups,
    getCurrentUser,
    listMenuActions,
    showConfirmation,
    apiCall,
    selectList,
    refreshMobileBarVisibility,
    refreshGroupsAndLists,
    updateListNav,
    showToast,
    openRenameCategoryModal,
  } = deps;

  function showMobileCollectionPicker(listName) {
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
            console.error('Failed to move list:', error);
            showToast('Failed to move list', 'error');
          }
        });
      });
  }

  function showMobileListMenu(listId) {
    const currentList = getCurrentList();
    const lists = getLists();
    const listMeta = getListMetadata(listId);
    const listName = listMeta?.name || listId;
    const menuConfig = buildListMenuConfig({
      listMeta,
      groups: getSortedGroups ? getSortedGroups() : [],
      currentUser: getCurrentUser(),
    });

    const { sheet: actionSheet, close } = createActionSheet({
      contentHtml: `
          <h3 class="font-semibold text-white mb-4">${listName}</h3>
          
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

      const confirmed = await showConfirmation(
        'Delete List',
        `Are you sure you want to delete the list "${listName}"?`,
        'This action cannot be undone.',
        'Delete'
      );

      if (confirmed) {
        try {
          await apiCall(`/api/lists/${encodeURIComponent(listId)}`, {
            method: 'DELETE',
          });

          delete lists[listId];

          if (currentList === listId) {
            const remainingLists = Object.keys(lists);
            if (remainingLists.length > 0) {
              selectList(remainingLists[0]);
            } else {
              if (refreshMobileBarVisibility) {
                refreshMobileBarVisibility();
              }

              const headerAddAlbumBtn =
                doc?.getElementById('headerAddAlbumBtn');
              if (headerAddAlbumBtn) headerAddAlbumBtn.classList.add('hidden');

              const albumContainer = doc?.getElementById('albumContainer');
              if (albumContainer) {
                albumContainer.innerHTML = `
                  <div class="text-center text-gray-500 mt-20">
                    <p class="text-xl mb-2">No list selected</p>
                    <p class="text-sm">Create or import a list to get started</p>
                  </div>
                `;
              }
            }
          }

          if (refreshGroupsAndLists) {
            await refreshGroupsAndLists();
          } else {
            updateListNav();
          }

          showToast(`List "${listName}" deleted`);
        } catch (_error) {
          showToast('Error deleting list', 'error');
        }
      }
    });
  }

  function showMobileCategoryMenu(groupId, groupName, isYearGroup) {
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
                console.error('Error force-deleting collection:', forceError);
                showToast(
                  forceError.message || 'Failed to delete collection',
                  'error'
                );
              }
            }
          } else {
            console.error('Error deleting collection:', error);
            showToast(error.message || 'Failed to delete collection', 'error');
          }
        }
      });
    }
  }

  return {
    showMobileListMenu,
    showMobileCategoryMenu,
  };
}
