/**
 * Settings drawer account/profile actions.
 *
 * Owns account editing, password change, and admin-request flows.
 */

export function createSettingsAccountActions(deps = {}) {
  const doc =
    deps.doc || (typeof document !== 'undefined' ? document : undefined);
  const win = deps.win || (typeof window !== 'undefined' ? window : {});
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;

  const {
    categoryData,
    renderCategoryContent,
    reattachAccountHandlers,
    showToast,
    showConfirmation,
    apiCall,
    loadCategoryData,
    createSettingsModalBase,
  } = deps;

  function handleEditEmail() {
    if (!categoryData.account) {
      categoryData.account = {};
    }
    categoryData.account.editingEmail = true;
    categoryData.account.tempEmail =
      categoryData.account.email || win.currentUser?.email || '';
    renderCategoryContent('account');
    reattachAccountHandlers();

    setTimeoutFn(() => {
      const input = doc.getElementById('emailInput');
      if (input) {
        input.focus();
        input.select();
      }
    }, 100);
  }

  async function handleSaveEmail() {
    const input = doc.getElementById('emailInput');
    if (!input) return;

    const newEmail = input.value.trim();

    if (!newEmail) {
      showToast('Email cannot be empty', 'error');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      showToast('Please enter a valid email address', 'error');
      return;
    }

    if (newEmail === (categoryData.account?.email || win.currentUser?.email)) {
      handleCancelEmail();
      return;
    }

    const confirmed = await showConfirmation(
      'Change Email',
      'Are you sure you want to change your email address?',
      'You will need to verify your new email address.',
      'Change Email'
    );

    if (!confirmed) {
      handleCancelEmail();
      return;
    }

    try {
      const response = await apiCall('/settings/update-email', {
        method: 'POST',
        body: JSON.stringify({ email: newEmail }),
      });

      if (response.success) {
        showToast('Email updated successfully', 'success');

        if (categoryData.account) {
          categoryData.account.email = newEmail;
          categoryData.account.editingEmail = false;
          delete categoryData.account.tempEmail;
        }

        if (win.currentUser) {
          win.currentUser.email = newEmail;
        }

        renderCategoryContent('account');
        reattachAccountHandlers();
      }
    } catch (error) {
      console.error('Error updating email:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to update email';
      showToast(errorMsg, 'error');
    }
  }

  function handleCancelEmail() {
    if (categoryData.account) {
      categoryData.account.editingEmail = false;
      delete categoryData.account.tempEmail;
    }
    renderCategoryContent('account');
    reattachAccountHandlers();
  }

  async function handleChangePassword() {
    const modal = createPasswordModal();
    doc.body.appendChild(modal);
    modal.classList.remove('hidden');

    setTimeoutFn(() => {
      const currentPasswordInput = modal.querySelector('#currentPasswordInput');
      if (currentPasswordInput) {
        currentPasswordInput.focus();
      }
    }, 100);
  }

  function handleEditUsername() {
    if (!categoryData.account) {
      categoryData.account = {};
    }
    categoryData.account.editingUsername = true;
    categoryData.account.tempUsername =
      categoryData.account.username || win.currentUser?.username || '';
    renderCategoryContent('account');
    reattachAccountHandlers();

    setTimeoutFn(() => {
      const input = doc.getElementById('usernameInput');
      if (input) {
        input.focus();
        input.select();
      }
    }, 100);
  }

  async function handleSaveUsername() {
    const input = doc.getElementById('usernameInput');
    if (!input) return;

    const newUsername = input.value.trim();

    if (!newUsername) {
      showToast('Username cannot be empty', 'error');
      return;
    }

    if (newUsername.length < 3 || newUsername.length > 30) {
      showToast('Username must be 3-30 characters', 'error');
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
      showToast(
        'Username can only contain letters, numbers, and underscores',
        'error'
      );
      return;
    }

    if (
      newUsername ===
      (categoryData.account?.username || win.currentUser?.username)
    ) {
      handleCancelUsername();
      return;
    }

    try {
      const response = await apiCall('/settings/update-username', {
        method: 'POST',
        body: JSON.stringify({ username: newUsername }),
      });

      if (response.success) {
        showToast('Username updated successfully', 'success');

        if (categoryData.account) {
          categoryData.account.username = newUsername;
          categoryData.account.editingUsername = false;
          delete categoryData.account.tempUsername;
        }

        if (win.currentUser) {
          win.currentUser.username = newUsername;
        }

        renderCategoryContent('account');
        reattachAccountHandlers();
      }
    } catch (error) {
      console.error('Error updating username:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to update username';
      showToast(errorMsg, 'error');
    }
  }

  function handleCancelUsername() {
    if (categoryData.account) {
      categoryData.account.editingUsername = false;
      delete categoryData.account.tempUsername;
    }
    renderCategoryContent('account');
    reattachAccountHandlers();
  }

  function createPasswordModal() {
    const { modal, close } = createSettingsModalBase({
      id: 'passwordChangeModal',
      title: 'Change Password',
      bodyHtml: `
          <form id="passwordChangeForm">
            <div class="settings-form-group">
              <label class="settings-label" for="currentPasswordInput">Current Password</label>
              <input type="password" id="currentPasswordInput" class="settings-input" required />
            </div>
            <div class="settings-form-group">
              <label class="settings-label" for="newPasswordInput">New Password</label>
              <input type="password" id="newPasswordInput" class="settings-input" required minlength="8" />
              <p class="settings-description">Must be at least 8 characters</p>
            </div>
            <div class="settings-form-group">
              <label class="settings-label" for="confirmPasswordInput">Confirm New Password</label>
              <input type="password" id="confirmPasswordInput" class="settings-input" required minlength="8" />
            </div>
            <div id="passwordError" class="text-red-500 text-sm mt-2 hidden"></div>
          </form>`,
      footerHtml: `
          <button id="cancelPasswordBtn" class="settings-button">Cancel</button>
          <button id="savePasswordBtn" class="settings-button">Change Password</button>`,
    });

    const cancelBtn = modal.querySelector('#cancelPasswordBtn');
    const saveBtn = modal.querySelector('#savePasswordBtn');
    const form = modal.querySelector('#passwordChangeForm');

    cancelBtn?.addEventListener('click', close);

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleSavePassword(modal);
    });

    saveBtn?.addEventListener('click', async () => {
      await handleSavePassword(modal);
    });

    return modal;
  }

  async function handleSavePassword(modal) {
    const currentPassword = modal.querySelector('#currentPasswordInput').value;
    const newPassword = modal.querySelector('#newPasswordInput').value;
    const confirmPassword = modal.querySelector('#confirmPasswordInput').value;
    const errorEl = modal.querySelector('#passwordError');
    const saveBtn = modal.querySelector('#savePasswordBtn');

    errorEl.classList.add('hidden');
    errorEl.textContent = '';

    if (!currentPassword || !newPassword || !confirmPassword) {
      errorEl.textContent = 'All fields are required';
      errorEl.classList.remove('hidden');
      return;
    }

    if (newPassword.length < 8) {
      errorEl.textContent = 'New password must be at least 8 characters';
      errorEl.classList.remove('hidden');
      return;
    }

    if (newPassword !== confirmPassword) {
      errorEl.textContent = 'New passwords do not match';
      errorEl.classList.remove('hidden');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Changing...';

    try {
      const response = await apiCall('/settings/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });

      if (response.success) {
        showToast('Password updated successfully', 'success');
        modal.classList.add('hidden');
        setTimeoutFn(() => {
          doc.body.removeChild(modal);
        }, 300);
      }
    } catch (error) {
      console.error('Error changing password:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to change password';
      errorEl.textContent = errorMsg;
      errorEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Change Password';
    }
  }

  async function handleRequestAdmin() {
    const input = doc.getElementById('adminCodeInput');
    if (!input) return;

    const code = input.value.trim().toUpperCase();

    if (!code) {
      showToast('Please enter an admin code', 'error');
      return;
    }

    const btn = doc.getElementById('requestAdminBtn');
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
      const response = await apiCall('/settings/request-admin', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });

      if (response.success) {
        showToast('Admin access granted!', 'success');

        if (win.currentUser) {
          win.currentUser.role = 'admin';
        }

        categoryData.account = null;
        await loadCategoryData('account');
      }
    } catch (error) {
      console.error('Error requesting admin:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to request admin access';
      showToast(errorMsg, 'error');
      btn.disabled = false;
      btn.textContent = 'Submit';
    }
  }

  return {
    handleEditEmail,
    handleSaveEmail,
    handleCancelEmail,
    handleChangePassword,
    handleEditUsername,
    handleSaveUsername,
    handleCancelUsername,
    handleRequestAdmin,
  };
}
