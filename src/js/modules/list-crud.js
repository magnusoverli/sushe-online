/**
 * List CRUD Module
 *
 * Handles creation, renaming, and deletion of lists and collections/categories.
 * Extracted from app.js Phase 6 of separation-of-concerns refactoring.
 *
 * Factory pattern: createListCrud(deps) returns public API.
 * All private state lives inside the factory closure.
 */

import { escapeHtmlAttr } from './html-utils.js';
import { setupModalBehavior } from '../utils/modal-helpers.js';

/**
 * Create the list CRUD module
 * @param {Object} deps - Injected dependencies
 * @returns {Object} Public API
 */
export function createListCrud(deps = {}) {
  const {
    apiCall,
    showToast,
    showConfirmation,
    refreshGroupsAndLists,
    getSortedGroups,
    getGroup,
    getListMetadata,
    getLists,
    findListByName,
    getCurrentListId,
    updateListNav,
    selectList,
    getCurrentContextGroup,
    setCurrentContextGroup,
  } = deps;

  // ========================================================
  // Category (Group) Context Menu
  // ========================================================

  /**
   * Initialize the category context menu for rename/delete actions
   */
  function initializeCategoryContextMenu() {
    const contextMenu = document.getElementById('categoryContextMenu');
    const renameOption = document.getElementById('renameCategoryOption');
    const deleteOption = document.getElementById('deleteCategoryOption');

    if (!contextMenu || !renameOption || !deleteOption) return;

    // Handle rename option click
    renameOption.onclick = () => {
      contextMenu.classList.add('hidden');

      const currentContextGroup = getCurrentContextGroup();
      if (!currentContextGroup) return;

      const { id, name, isYearGroup } = currentContextGroup;

      // Virtual "Uncategorized" group (orphaned lists) can't be renamed
      if (id === 'orphaned') {
        showToast('The "Uncategorized" section cannot be renamed', 'info');
        return;
      }

      // Year groups can't be renamed (name must match year)
      if (isYearGroup) {
        showToast(
          'Year groups cannot be renamed. The name matches the year.',
          'info'
        );
        return;
      }

      openRenameCategoryModal(id, name);
    };

    // Handle delete option click
    deleteOption.onclick = async () => {
      contextMenu.classList.add('hidden');

      const currentContextGroup = getCurrentContextGroup();
      if (!currentContextGroup) return;

      const { id, name, isYearGroup } = currentContextGroup;

      // Year groups can't be deleted manually
      if (isYearGroup) {
        showToast('Year groups are removed automatically when empty', 'info');
        setCurrentContextGroup(null);
        return;
      }

      // Virtual "Uncategorized" group (orphaned lists) can't be deleted
      if (id === 'orphaned') {
        showToast('The "Uncategorized" section cannot be deleted', 'info');
        setCurrentContextGroup(null);
        return;
      }

      try {
        // First try to delete - API will return 409 if collection has lists
        await apiCall(`/api/groups/${id}`, { method: 'DELETE' });
        showToast(`Collection "${name}" deleted`);
        await refreshGroupsAndLists();
      } catch (error) {
        // Check if this is a "has lists" conflict that needs confirmation
        if (error.requiresConfirmation && error.listCount > 0) {
          const listWord = error.listCount === 1 ? 'list' : 'lists';
          const confirmed = await showConfirmation(
            'Delete Collection',
            `The collection "${name}" contains ${error.listCount} ${listWord}.`,
            `Deleting this collection will move the ${listWord} to "Uncategorized". This action cannot be undone.`,
            'Delete Collection',
            null,
            {
              checkboxLabel: `I understand that ${error.listCount} ${listWord} will be moved to "Uncategorized"`,
            }
          );

          if (confirmed) {
            try {
              // Force delete with confirmation
              await apiCall(`/api/groups/${id}?force=true`, {
                method: 'DELETE',
              });
              showToast(`Collection "${name}" deleted`);
              await refreshGroupsAndLists();
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

      setCurrentContextGroup(null);
    };

    // Hide context menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!contextMenu.contains(e.target)) {
        contextMenu.classList.add('hidden');
      }
    });
  }

  /**
   * Open the rename category modal
   */
  function openRenameCategoryModal(groupId, currentName) {
    // Escape HTML for safe insertion
    const escapedName = escapeHtmlAttr(currentName);

    // Use the existing confirmation modal pattern with an input
    const modal = document.createElement('div');
    modal.className =
      'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 safe-area-modal';
    modal.id = 'renameCategoryModal';
    modal.innerHTML = `
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-md">
      <div class="p-6 border-b border-gray-800">
        <h3 class="text-xl font-bold text-white">Rename Category</h3>
      </div>
      <div class="p-6">
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">
          New Name
        </label>
        <input 
          type="text" 
          id="newCategoryName" 
          value="${escapedName}"
          class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
          maxlength="50"
          autofocus
        >
        <p id="renameCategoryError" class="text-xs text-red-500 mt-2 hidden"></p>
      </div>
      <div class="p-6 border-t border-gray-800 flex gap-3 justify-end">
        <button id="cancelRenameCategoryBtn" class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-sm transition duration-200">
          Cancel
        </button>
        <button id="confirmRenameCategoryBtn" class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-sm transition duration-200">
          Rename
        </button>
      </div>
    </div>
  `;

    document.body.appendChild(modal);

    const input = modal.querySelector('#newCategoryName');
    const errorEl = modal.querySelector('#renameCategoryError');
    const cancelBtn = modal.querySelector('#cancelRenameCategoryBtn');
    const confirmBtn = modal.querySelector('#confirmRenameCategoryBtn');

    // Focus and select all text
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);

    const closeModal = () => {
      modal.remove();
    };

    const doRename = async () => {
      const newName = input.value.trim();

      if (!newName) {
        errorEl.textContent = 'Name is required';
        errorEl.classList.remove('hidden');
        return;
      }

      if (newName === currentName) {
        closeModal();
        return;
      }

      try {
        await apiCall(`/api/groups/${groupId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: newName }),
        });

        showToast(`Category renamed to "${newName}"`);
        closeModal();

        // Refresh groups and lists
        await refreshGroupsAndLists();
      } catch (error) {
        console.error('Error renaming category:', error);
        errorEl.textContent = error.message || 'Failed to rename category';
        errorEl.classList.remove('hidden');
      }
    };

    cancelBtn.onclick = closeModal;
    confirmBtn.onclick = doRename;

    // Handle enter key
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doRename();
      } else if (e.key === 'Escape') {
        closeModal();
      }
    };

    // Close on backdrop click
    modal.onclick = (e) => {
      if (e.target === modal) {
        closeModal();
      }
    };
  }

  // ========================================================
  // Create List
  // ========================================================

  /**
   * Initialize the create list modal and functionality
   */
  function initializeCreateList() {
    const createBtn = document.getElementById('createListBtn');
    const modal = document.getElementById('createListModal');
    const nameInput = document.getElementById('newListName');
    const categorySelect = document.getElementById('newListCategory');
    const cancelBtn = document.getElementById('cancelCreateBtn');
    const confirmBtn = document.getElementById('confirmCreateBtn');
    const categoryError = document.getElementById('createCategoryError');

    // Dynamic input containers
    const newYearContainer = document.getElementById('newYearInputContainer');
    const newYearInput = document.getElementById('newYearInput');
    const newCollectionContainer = document.getElementById(
      'newCollectionInputContainer'
    );
    const newCollectionInput = document.getElementById('newCollectionInput');

    if (!createBtn || !modal) return;

    /**
     * Populate the category dropdown with years and collections
     */
    function populateCategoryDropdown() {
      const sortedGroups = getSortedGroups();

      // Separate into years and collections
      const yearGroups = sortedGroups.filter((g) => g.isYearGroup);
      const collections = sortedGroups.filter((g) => !g.isYearGroup);

      // Sort years descending (most recent first)
      yearGroups.sort((a, b) => (b.year || 0) - (a.year || 0));

      // Build dropdown HTML
      let html =
        '<option value="" disabled selected>Select a category...</option>';

      // Years section
      html += '<optgroup label="Years">';
      for (const group of yearGroups) {
        html += `<option value="year:${group._id}">${group.name}</option>`;
      }
      html += '<option value="new-year">+ New year...</option>';
      html += '</optgroup>';

      // Collections section
      html += '<optgroup label="Collections">';
      for (const group of collections) {
        html += `<option value="collection:${group._id}">${group.name}</option>`;
      }
      html += '<option value="new-collection">+ New collection...</option>';
      html += '</optgroup>';

      categorySelect.innerHTML = html;
    }

    /**
     * Handle category selection change
     */
    function handleCategoryChange() {
      const value = categorySelect.value;

      // Hide both dynamic inputs
      newYearContainer.classList.add('hidden');
      newCollectionContainer.classList.add('hidden');
      if (categoryError) categoryError.classList.add('hidden');

      if (value === 'new-year') {
        newYearContainer.classList.remove('hidden');
        newYearInput.value = '';
        newYearInput.focus();
      } else if (value === 'new-collection') {
        newCollectionContainer.classList.remove('hidden');
        newCollectionInput.value = '';
        newCollectionInput.focus();
      }
    }

    categorySelect.addEventListener('change', handleCategoryChange);

    // Open modal
    createBtn.onclick = () => {
      populateCategoryDropdown();
      modal.classList.remove('hidden');
      nameInput.value = '';
      categorySelect.value = '';
      newYearInput.value = '';
      newCollectionInput.value = '';
      newYearContainer.classList.add('hidden');
      newCollectionContainer.classList.add('hidden');
      if (categoryError) categoryError.classList.add('hidden');
      nameInput.focus();
    };

    // Close modal
    const closeModal = () => {
      modal.classList.add('hidden');
      nameInput.value = '';
      categorySelect.value = '';
      newYearInput.value = '';
      newCollectionInput.value = '';
      newYearContainer.classList.add('hidden');
      newCollectionContainer.classList.add('hidden');
      if (categoryError) categoryError.classList.add('hidden');
    };

    cancelBtn.onclick = closeModal;
    setupModalBehavior(modal, closeModal);

    /**
     * Validate a year value
     */
    function validateYear(yearValue) {
      if (!yearValue || yearValue === '') {
        return { valid: false, error: 'Year is required' };
      }
      const year = parseInt(yearValue, 10);
      if (!Number.isInteger(year) || year < 1000 || year > 9999) {
        return { valid: false, error: 'Year must be between 1000 and 9999' };
      }
      return { valid: true, value: year };
    }

    /**
     * Show error message
     */
    function showError(message) {
      if (categoryError) {
        categoryError.textContent = message;
        categoryError.classList.remove('hidden');
      }
      showToast(message, 'error');
    }

    // Create list
    const createList = async () => {
      const listName = nameInput.value.trim();
      const categoryValue = categorySelect.value;

      // Validate list name
      if (!listName) {
        showToast('Please enter a list name', 'error');
        nameInput.focus();
        return;
      }

      // Note: Duplicate name checking is now done server-side per group
      // The new unique constraint is (user_id, name, group_id)

      // Validate category selection
      if (!categoryValue) {
        showError('Please select a category');
        categorySelect.focus();
        return;
      }

      if (categoryError) categoryError.classList.add('hidden');

      let year = null;
      let groupId = null;

      try {
        if (categoryValue === 'new-year') {
          // Creating a new year
          const yearValidation = validateYear(newYearInput.value.trim());
          if (!yearValidation.valid) {
            showError(yearValidation.error);
            newYearInput.focus();
            return;
          }
          year = yearValidation.value;
          // Year-group will be auto-created by the backend
        } else if (categoryValue === 'new-collection') {
          // Creating a new collection
          const collectionName = newCollectionInput.value.trim();
          if (!collectionName) {
            showError('Please enter a collection name');
            newCollectionInput.focus();
            return;
          }
          if (/^\d{4}$/.test(collectionName)) {
            showError('Collection name cannot be a year');
            newCollectionInput.focus();
            return;
          }

          // Create the collection first
          const newGroup = await apiCall('/api/groups', {
            method: 'POST',
            body: JSON.stringify({ name: collectionName }),
          });
          groupId = newGroup._id;
        } else if (categoryValue.startsWith('year:')) {
          // Existing year-group selected
          const selectedGroupId = categoryValue.replace('year:', '');
          const group = getGroup(selectedGroupId);
          if (group) {
            year = group.year;
          }
        } else if (categoryValue.startsWith('collection:')) {
          // Existing collection selected
          groupId = categoryValue.replace('collection:', '');
        }

        // Create the list using the new POST /api/lists endpoint
        const createBody = { name: listName, data: [] };
        if (groupId) {
          createBody.groupId = groupId;
        } else if (year) {
          createBody.year = year;
        } else {
          showError('Invalid category selection');
          return;
        }

        const result = await apiCall('/api/lists', {
          method: 'POST',
          body: JSON.stringify(createBody),
        });

        const newListId = result._id;

        // Refresh groups and lists, update navigation
        await refreshGroupsAndLists();
        updateListNav();

        // Select the new list by ID
        selectList(newListId);

        // Close modal
        closeModal();

        const categoryLabel = year ? `${year}` : 'collection';
        showToast(`Created list "${listName}" in ${categoryLabel}`);
      } catch (err) {
        showError(err.message || 'Error creating list');
      }
    };

    confirmBtn.onclick = createList;

    // Enter key handling
    nameInput.onkeypress = (e) => {
      if (e.key === 'Enter') {
        if (!categorySelect.value) {
          categorySelect.focus();
        } else {
          createList();
        }
      }
    };

    newYearInput.onkeypress = (e) => {
      if (e.key === 'Enter') {
        createList();
      }
    };

    newCollectionInput.onkeypress = (e) => {
      if (e.key === 'Enter') {
        createList();
      }
    };
  }

  // ========================================================
  // Create Collection
  // ========================================================

  /**
   * Initialize the create collection modal and functionality
   */
  function initializeCreateCollection() {
    const createBtn = document.getElementById('createCollectionBtn');
    const modal = document.getElementById('createCollectionModal');
    const nameInput = document.getElementById('newCollectionName');
    const cancelBtn = document.getElementById('cancelCreateCollectionBtn');
    const confirmBtn = document.getElementById('confirmCreateCollectionBtn');
    const errorEl = document.getElementById('createCollectionError');

    if (!createBtn || !modal) return;

    // Open modal
    createBtn.onclick = () => {
      modal.classList.remove('hidden');
      nameInput.value = '';
      if (errorEl) errorEl.classList.add('hidden');
      nameInput.focus();
    };

    // Close modal
    const closeModal = () => {
      modal.classList.add('hidden');
      nameInput.value = '';
      if (errorEl) errorEl.classList.add('hidden');
    };

    cancelBtn.onclick = closeModal;
    setupModalBehavior(modal, closeModal);

    // Create collection
    const createCollection = async () => {
      const collectionName = nameInput.value.trim();

      if (!collectionName) {
        showToast('Please enter a collection name', 'error');
        nameInput.focus();
        return;
      }

      // Check if name looks like a year
      if (/^\d{4}$/.test(collectionName)) {
        const error = 'Collection name cannot be a year';
        if (errorEl) {
          errorEl.textContent = error;
          errorEl.classList.remove('hidden');
        }
        showToast(error, 'error');
        nameInput.focus();
        return;
      }

      try {
        await apiCall('/api/groups', {
          method: 'POST',
          body: JSON.stringify({ name: collectionName }),
        });

        // Refresh groups and update navigation
        await refreshGroupsAndLists();
        updateListNav();

        closeModal();
        showToast(`Created collection "${collectionName}"`);
      } catch (err) {
        const errorMsg = err.message || 'Error creating collection';
        if (errorEl) {
          errorEl.textContent = errorMsg;
          errorEl.classList.remove('hidden');
        }
        showToast(errorMsg, 'error');
      }
    };

    confirmBtn.onclick = createCollection;

    // Enter key to create
    nameInput.onkeypress = (e) => {
      if (e.key === 'Enter') {
        createCollection();
      }
    };
  }

  // ========================================================
  // Rename / Edit List
  // ========================================================

  /**
   * Initialize the rename/edit list modal and functionality
   */
  function initializeRenameList() {
    const modal = document.getElementById('renameListModal');
    const _currentNameSpan = document.getElementById('currentListIdName'); // Used in openRenameModal
    const nameInput = document.getElementById('newListNameInput');
    const yearInput = document.getElementById('editListYear');
    const yearError = document.getElementById('editYearError');
    const cancelBtn = document.getElementById('cancelRenameBtn');
    const confirmBtn = document.getElementById('confirmRenameBtn');

    if (!modal) return;

    // Close modal function
    const closeModal = () => {
      modal.classList.add('hidden');
      nameInput.value = '';
      if (yearInput) yearInput.value = '';
      if (yearError) yearError.classList.add('hidden');
    };

    cancelBtn.onclick = closeModal;
    setupModalBehavior(modal, closeModal);

    // Validate year input (optional for editing)
    const validateYear = (yearValue) => {
      if (!yearValue || yearValue === '') {
        return { valid: true, value: null }; // Empty is valid (removes year)
      }
      const year = parseInt(yearValue, 10);
      if (!Number.isInteger(year) || year < 1000 || year > 9999) {
        return { valid: false, error: 'Year must be between 1000 and 9999' };
      }
      return { valid: true, value: year };
    };

    // Edit list function
    const editList = async () => {
      // Get the list ID from the modal's dataset (set by openRenameModal)
      const listId = modal.dataset.listId;
      if (!listId) {
        showToast('No list selected', 'error');
        return;
      }

      const oldMeta = getListMetadata(listId);
      const oldName = oldMeta?.name || '';
      const newName = nameInput.value.trim();
      const yearValue = yearInput ? yearInput.value.trim() : '';

      if (!newName) {
        showToast('Please enter a list name', 'error');
        nameInput.focus();
        return;
      }

      // Validate year if provided
      const yearValidation = validateYear(yearValue);
      if (!yearValidation.valid) {
        if (yearError) {
          yearError.textContent = yearValidation.error;
          yearError.classList.remove('hidden');
        }
        showToast(yearValidation.error, 'error');
        if (yearInput) yearInput.focus();
        return;
      }
      if (yearError) yearError.classList.add('hidden');

      // Check if new name already exists in the same group (only if renaming)
      // The server will do the actual duplicate check, but we can do a quick client-side check
      if (newName !== oldName) {
        const existingWithSameName = findListByName(newName, oldMeta?.groupId);
        if (existingWithSameName && existingWithSameName._id !== listId) {
          showToast(
            'A list with this name already exists in this category',
            'error'
          );
          nameInput.focus();
          return;
        }
      }

      const nameChanged = newName !== oldName;
      const yearChanged = yearValidation.value !== (oldMeta?.year || null);

      // If nothing changed, just close
      if (!nameChanged && !yearChanged) {
        closeModal();
        return;
      }

      try {
        // Use PATCH endpoint to update name and/or year
        const patchData = {};
        if (nameChanged) patchData.name = newName;
        if (yearChanged) patchData.year = yearValidation.value;

        await apiCall(`/api/lists/${encodeURIComponent(listId)}`, {
          method: 'PATCH',
          body: JSON.stringify(patchData),
        });

        // Update local state (lists remain keyed by ID)
        if (getLists()[listId]) {
          if (nameChanged) {
            getLists()[listId].name = newName;
          }
          if (yearChanged) {
            getLists()[listId].year = yearValidation.value;
          }
        }

        updateListNav();

        // Refresh display if current list was modified
        if (getCurrentListId() === listId) {
          // Re-select to update any displayed name
          selectList(listId);
        }

        closeModal();

        // Show appropriate message
        if (nameChanged && yearChanged) {
          showToast(
            `List updated: "${newName}" (${yearValidation.value || 'no year'})`
          );
        } else if (nameChanged) {
          showToast(`List renamed to "${newName}"`);
        } else {
          showToast(`Year updated to ${yearValidation.value || 'none'}`);
        }
      } catch (error) {
        console.error('Error updating list:', error);
        showToast('Error updating list', 'error');
      }
    };

    confirmBtn.onclick = editList;

    // Enter key to save
    nameInput.onkeypress = (e) => {
      if (e.key === 'Enter') {
        editList();
      }
    };

    if (yearInput) {
      yearInput.onkeypress = (e) => {
        if (e.key === 'Enter') {
          editList();
        }
      };
    }
  }

  /**
   * Open the edit list details modal (formerly rename modal)
   */
  function openRenameModal(listId) {
    const modal = document.getElementById('renameListModal');
    const currentNameSpan = document.getElementById('currentListIdName');
    const nameInput = document.getElementById('newListNameInput');
    const yearInput = document.getElementById('editListYear');
    const yearError = document.getElementById('editYearError');

    if (!modal || !currentNameSpan || !nameInput) return;

    // Get metadata to display the list name
    const meta = getListMetadata(listId);
    const listName = meta?.name || listId;

    currentNameSpan.textContent = listName;
    nameInput.value = listName;

    // Store the list ID for the save handler
    modal.dataset.listId = listId;

    if (yearInput) {
      yearInput.value = meta?.year || '';
    }
    if (yearError) {
      yearError.classList.add('hidden');
    }

    modal.classList.remove('hidden');

    // Select all text in the input for easy editing
    setTimeout(() => {
      nameInput.focus();
      nameInput.select();
    }, 100);
  }

  // Public API
  return {
    initializeCategoryContextMenu,
    openRenameCategoryModal,
    initializeCreateList,
    initializeCreateCollection,
    initializeRenameList,
    openRenameModal,
  };
}
