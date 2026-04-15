import { createMobileCollectionPicker } from './list-collection-picker.js';
import { createMobileListActionMenu } from './list-action-menu.js';
import { createMobileCategoryMenu } from './category-menu.js';

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
    logger = console,
  } = deps;

  const showMobileCollectionPicker = createMobileCollectionPicker({
    createActionSheet,
    getListMetadata,
    getSortedGroups,
    apiCall,
    showToast,
    refreshGroupsAndLists,
    updateListNav,
    logger,
  });

  const showMobileListMenu = createMobileListActionMenu({
    doc,
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
    showMobileCollectionPicker,
  });

  const showMobileCategoryMenu = createMobileCategoryMenu({
    createActionSheet,
    openRenameCategoryModal,
    showToast,
    apiCall,
    refreshGroupsAndLists,
    updateListNav,
    showConfirmation,
    logger,
  });

  return {
    showMobileListMenu,
    showMobileCategoryMenu,
  };
}
