/**
 * Settings drawer admin user-management actions.
 *
 * Owns admin grant/revoke/delete and user-list modal behavior.
 */

export function createSettingsAdminUserActions(deps = {}) {
  const doc =
    deps.doc || (typeof document !== 'undefined' ? document : undefined);

  const {
    showConfirmation,
    apiCall,
    showToast,
    categoryData,
    loadCategoryData,
    createSettingsModalBase,
  } = deps;

  async function handleGrantAdmin(userId) {
    const confirmed = await showConfirmation(
      'Grant Admin Access',
      'Are you sure you want to grant admin access to this user?',
      'This user will have full administrative privileges.',
      'Grant Admin'
    );

    if (!confirmed) return;

    try {
      const response = await apiCall('/admin/make-admin', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });

      if (response.success) {
        showToast('Admin access granted successfully', 'success');
        categoryData.admin = null;
        await loadCategoryData('admin');
      }
    } catch (error) {
      console.error('Error granting admin:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to grant admin access';
      showToast(errorMsg, 'error');
    }
  }

  async function handleRevokeAdmin(userId) {
    const confirmed = await showConfirmation(
      'Revoke Admin Access',
      'Are you sure you want to revoke admin access from this user?',
      'This user will lose all administrative privileges.',
      'Revoke Admin'
    );

    if (!confirmed) return;

    try {
      const response = await apiCall('/admin/revoke-admin', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });

      if (response.success) {
        showToast('Admin access revoked successfully', 'success');
        categoryData.admin = null;
        await loadCategoryData('admin');
      }
    } catch (error) {
      console.error('Error revoking admin:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to revoke admin access';
      showToast(errorMsg, 'error');
    }
  }

  async function handleViewUserLists(userId) {
    try {
      const response = await apiCall(`/admin/user-lists/${userId}`);

      if (response.lists) {
        const modal = createUserListsModal(response.lists);
        doc.body.appendChild(modal);
        modal.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error fetching user lists:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to fetch user lists';
      showToast(errorMsg, 'error');
    }
  }

  function createUserListsModal(lists) {
    const { modal, close } = createSettingsModalBase({
      id: 'userListsModal',
      title: 'User Lists',
      bodyHtml: `
          ${
            lists.length === 0
              ? `
            <p class="text-gray-400 text-center py-8">This user has no lists.</p>
          `
              : `
            <div class="space-y-2 max-h-96 overflow-y-auto">
              ${lists
                .map(
                  (list) => `
                <div class="flex items-center justify-between py-2 px-3 bg-gray-800/50 rounded-sm border border-gray-700/50">
                  <div>
                    <div class="text-white font-medium">${list.name || 'Unnamed List'}</div>
                    <div class="text-xs text-gray-400 mt-1">
                      ${list.albumCount || 0} albums
                      ${list.createdAt ? ` • Created ${new Date(list.createdAt).toLocaleDateString()}` : ''}
                    </div>
                  </div>
                </div>
              `
                )
                .join('')}
            </div>
          `
          }`,
      footerHtml: `
          <button id="closeUserListsBtn" class="settings-button">Close</button>`,
      maxWidth: '32rem',
    });

    const closeUserListsBtn = modal.querySelector('#closeUserListsBtn');
    closeUserListsBtn?.addEventListener('click', close);

    return modal;
  }

  async function handleDeleteUser(userId) {
    const confirmed = await showConfirmation(
      'Delete User',
      'Are you sure you want to delete this user?',
      'This will permanently delete the user and all their data. This action cannot be undone.',
      'Delete User'
    );

    if (!confirmed) return;

    try {
      const response = await apiCall('/admin/delete-user', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });

      if (response.success) {
        showToast('User deleted successfully', 'success');
        categoryData.admin = null;
        await loadCategoryData('admin');
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to delete user';
      showToast(errorMsg, 'error');
    }
  }

  return {
    handleGrantAdmin,
    handleRevokeAdmin,
    handleViewUserLists,
    handleDeleteUser,
  };
}
