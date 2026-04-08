/**
 * Settings drawer Telegram actions.
 *
 * Owns Telegram setup wizard and notification toggles.
 */

export function createSettingsTelegramActions(deps = {}) {
  const doc =
    deps.doc || (typeof document !== 'undefined' ? document : undefined);
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;

  const {
    createSettingsModalBase,
    showToast,
    apiCall,
    categoryData,
    loadCategoryData,
    showConfirmation,
  } = deps;

  let telegramModalState = null;

  async function handleConfigureTelegram() {
    const modal = createTelegramModal();
    doc.body.appendChild(modal);
    modal.classList.remove('hidden');

    telegramModalState = {
      currentStep: 1,
      botToken: null,
      botInfo: null,
      detectedGroups: [],
      selectedGroup: null,
      groupInfo: null,
      selectedTopic: null,
      isLoading: false,
    };

    updateTelegramModalStep(1);

    setTimeoutFn(() => {
      const tokenInput = modal.querySelector('#telegramBotToken');
      if (tokenInput) {
        tokenInput.focus();
      }
    }, 100);
  }

  function createTelegramModal() {
    const { modal, close } = createSettingsModalBase({
      id: 'telegramSetupModal',
      title:
        '<i class="fab fa-telegram text-blue-400 mr-2"></i>\n            Configure Telegram',
      maxWidth: '32rem',
      bodyHtml: `
          <!-- Step 1: Bot Token -->
          <div id="telegramStep1" class="telegram-step active" data-step="1">
            <h4 class="text-sm font-semibold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
              <span class="telegram-step-indicator">1</span>
              Create a Telegram Bot
            </h4>
            <ol class="text-sm text-gray-400 mb-4 space-y-1 list-decimal list-inside">
              <li>Open Telegram and message <a href="https://t.me/BotFather" target="_blank" class="text-blue-400 hover:underline">@BotFather</a></li>
              <li>Send <code class="bg-gray-800 px-1.5 py-0.5 rounded-sm text-xs">/newbot</code> and follow the prompts</li>
              <li>Copy the bot token and paste it below</li>
            </ol>
            <div class="flex gap-2">
              <input
                type="password"
                id="telegramBotToken"
                placeholder="Paste your bot token here..."
                class="settings-input flex-1"
              >
              <button id="validateTelegramTokenBtn" class="settings-button">
                <i class="fas fa-check mr-2"></i>Validate
              </button>
            </div>
            <div id="telegramTokenFeedback" class="telegram-feedback mt-2 hidden"></div>
          </div>

          <!-- Step 2: Group Selection -->
          <div id="telegramStep2" class="telegram-step disabled" data-step="2">
            <h4 class="text-sm font-semibold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
              <span class="telegram-step-indicator">2</span>
              Connect to Admin Group
            </h4>
            <p class="text-sm text-gray-400 mb-4">
              Add your bot to an admin-only group, then send any message in the group and click Detect.
            </p>
            <div class="flex gap-2 mb-3">
              <button id="detectTelegramGroupsBtn" class="settings-button">
                <i class="fas fa-search mr-2"></i>Detect Groups
              </button>
            </div>
            <select id="telegramGroupSelect" class="settings-select w-full hidden">
              <option value="">Select a group...</option>
            </select>
            <div id="telegramGroupFeedback" class="telegram-feedback mt-2 hidden"></div>
          </div>

          <!-- Step 3: Topic Selection (for forum groups) -->
          <div id="telegramStep3" class="telegram-step disabled hidden" data-step="3">
            <h4 class="text-sm font-semibold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
              <span class="telegram-step-indicator">3</span>
              Select Topic (Optional)
            </h4>
            <p class="text-sm text-gray-400 mb-4">
              This group has Topics enabled. Select a topic for notifications or use General.
            </p>
            <select id="telegramTopicSelect" class="settings-select w-full">
              <option value="">General (default)</option>
            </select>
          </div>

          <!-- Step 4: Test & Save -->
          <div id="telegramStep4" class="telegram-step disabled" data-step="4">
            <h4 class="text-sm font-semibold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
              <span class="telegram-step-indicator">4</span>
              Test & Activate
            </h4>
            <div id="telegramSaveFeedback" class="telegram-feedback mb-3 hidden"></div>
            <div class="flex flex-wrap gap-2">
              <button id="sendTelegramTestBtn" class="settings-button">
                <i class="fas fa-paper-plane mr-2"></i>Send Test
              </button>
              <button id="saveTelegramConfigBtn" class="settings-button">
                <i class="fas fa-save mr-2"></i>Save & Enable
              </button>
            </div>
          </div>`,
      footerHtml:
        '<button id="closeTelegramModalBtn" class="settings-button">Cancel</button>',
      onClose: () => {
        telegramModalState = null;
      },
    });

    const cancelBtn = modal.querySelector('#closeTelegramModalBtn');
    const validateBtn = modal.querySelector('#validateTelegramTokenBtn');
    const detectBtn = modal.querySelector('#detectTelegramGroupsBtn');
    const groupSelect = modal.querySelector('#telegramGroupSelect');
    const topicSelect = modal.querySelector('#telegramTopicSelect');
    const testBtn = modal.querySelector('#sendTelegramTestBtn');
    const saveBtn = modal.querySelector('#saveTelegramConfigBtn');

    cancelBtn?.addEventListener('click', close);

    validateBtn?.addEventListener('click', () =>
      handleValidateTelegramToken(modal)
    );
    detectBtn?.addEventListener('click', () =>
      handleDetectTelegramGroups(modal)
    );
    groupSelect?.addEventListener('change', (e) =>
      handleSelectTelegramGroup(modal, e.target.value)
    );
    topicSelect?.addEventListener('change', (e) =>
      handleSelectTelegramTopic(modal, e.target.value)
    );
    testBtn?.addEventListener('click', () => handleSendTelegramTest(modal));
    saveBtn?.addEventListener('click', () => handleSaveTelegramConfig(modal));

    const tokenInput = modal.querySelector('#telegramBotToken');
    tokenInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleValidateTelegramToken(modal);
      }
    });

    return modal;
  }

  function updateTelegramModalStep(step) {
    if (!telegramModalState) return;

    telegramModalState.currentStep = step;

    for (let i = 1; i <= 4; i++) {
      const stepEl = doc.querySelector(`#telegramStep${i}`);
      if (!stepEl) continue;

      stepEl.classList.remove('active', 'completed', 'disabled');

      if (i < step) {
        stepEl.classList.add('completed');
      } else if (i === step) {
        stepEl.classList.add('active');
      } else {
        stepEl.classList.add('disabled');
      }
    }
  }

  function enableTelegramStep(step) {
    for (let i = 1; i < step; i++) {
      const prevStepEl = doc.querySelector(`#telegramStep${i}`);
      if (prevStepEl) {
        prevStepEl.classList.remove('active', 'disabled');
        prevStepEl.classList.add('completed');
      }
    }

    const stepEl = doc.querySelector(`#telegramStep${step}`);
    if (stepEl) {
      stepEl.classList.remove('disabled', 'completed');
      stepEl.classList.add('active');
    }
  }

  function _disableTelegramStep(step) {
    const stepEl = doc.querySelector(`#telegramStep${step}`);
    if (stepEl) {
      stepEl.classList.add('disabled');
      stepEl.classList.remove('active', 'completed');
    }
  }

  async function handleValidateTelegramToken(modal) {
    if (!telegramModalState) return;

    const tokenInput = modal.querySelector('#telegramBotToken');
    const feedbackEl = modal.querySelector('#telegramTokenFeedback');
    const validateBtn = modal.querySelector('#validateTelegramTokenBtn');

    if (!tokenInput || !feedbackEl || !validateBtn) return;

    const token = tokenInput.value.trim();

    if (!token) {
      feedbackEl.className = 'telegram-feedback error mt-2';
      feedbackEl.innerHTML =
        '<i class="fas fa-exclamation-circle"></i>Please enter a bot token';
      feedbackEl.classList.remove('hidden');
      return;
    }

    if (token.length < 20) {
      feedbackEl.className = 'telegram-feedback error mt-2';
      feedbackEl.innerHTML =
        '<i class="fas fa-exclamation-circle"></i>Token appears to be invalid (too short)';
      feedbackEl.classList.remove('hidden');
      return;
    }

    validateBtn.disabled = true;
    validateBtn.innerHTML =
      '<i class="fas fa-spinner fa-spin mr-2"></i>Validating...';
    feedbackEl.className = 'telegram-feedback loading mt-2';
    feedbackEl.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i>Validating token...';
    feedbackEl.classList.remove('hidden');

    try {
      const response = await apiCall('/api/admin/telegram/validate-token', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });

      if (response.valid && response.botInfo) {
        telegramModalState.botToken = token;
        telegramModalState.botInfo = response.botInfo;

        feedbackEl.className = 'telegram-feedback success mt-2';
        feedbackEl.innerHTML = `<i class="fas fa-check-circle"></i>Token validated! Bot: @${response.botInfo.username || 'unknown'}`;
        feedbackEl.classList.remove('hidden');

        enableTelegramStep(2);
        updateTelegramModalStep(2);
      } else {
        throw new Error(response.error || 'Invalid token');
      }
    } catch (error) {
      console.error('Error validating Telegram token:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to validate token';
      feedbackEl.className = 'telegram-feedback error mt-2';
      feedbackEl.innerHTML = `<i class="fas fa-exclamation-circle"></i>${errorMsg}`;
      feedbackEl.classList.remove('hidden');
    } finally {
      validateBtn.disabled = false;
      validateBtn.innerHTML = '<i class="fas fa-check mr-2"></i>Validate';
    }
  }

  async function handleDetectTelegramGroups(modal) {
    if (!telegramModalState || !telegramModalState.botToken) {
      showToast('Please validate bot token first', 'error');
      return;
    }

    const detectBtn = modal.querySelector('#detectTelegramGroupsBtn');
    const groupSelect = modal.querySelector('#telegramGroupSelect');
    const feedbackEl = modal.querySelector('#telegramGroupFeedback');

    if (!detectBtn || !groupSelect || !feedbackEl) return;

    detectBtn.disabled = true;
    detectBtn.innerHTML =
      '<i class="fas fa-spinner fa-spin mr-2"></i>Detecting...';
    feedbackEl.className = 'telegram-feedback loading mt-2';
    feedbackEl.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i>Detecting groups...';
    feedbackEl.classList.remove('hidden');
    groupSelect.classList.add('hidden');

    try {
      const response = await apiCall('/api/admin/telegram/detect-groups', {
        method: 'POST',
        body: JSON.stringify({ token: telegramModalState.botToken }),
      });

      if (response.groups && response.groups.length > 0) {
        telegramModalState.detectedGroups = response.groups;

        groupSelect.innerHTML = '<option value="">Select a group...</option>';
        response.groups.forEach((group) => {
          const option = doc.createElement('option');
          option.value = group.id;
          option.textContent = `${group.title} (${group.type})`;
          groupSelect.appendChild(option);
        });

        groupSelect.classList.remove('hidden');
        feedbackEl.className = 'telegram-feedback success mt-2';
        feedbackEl.innerHTML = `<i class="fas fa-check-circle"></i>Found ${response.groups.length} group(s). Select one below.`;
        feedbackEl.classList.remove('hidden');
      } else {
        feedbackEl.className = 'telegram-feedback error mt-2';
        feedbackEl.innerHTML =
          '<i class="fas fa-exclamation-circle"></i>No groups found. Make sure the bot is added to a group and has sent a message.';
        feedbackEl.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error detecting Telegram groups:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to detect groups';
      feedbackEl.className = 'telegram-feedback error mt-2';
      feedbackEl.innerHTML = `<i class="fas fa-exclamation-circle"></i>${errorMsg}`;
      feedbackEl.classList.remove('hidden');
    } finally {
      detectBtn.disabled = false;
      detectBtn.innerHTML = '<i class="fas fa-search mr-2"></i>Detect Groups';
    }
  }

  async function handleSelectTelegramGroup(modal, chatId) {
    if (!telegramModalState || !chatId || !telegramModalState.botToken) return;

    const feedbackEl = modal.querySelector('#telegramGroupFeedback');
    const step3El = modal.querySelector('#telegramStep3');
    const topicSelect = modal.querySelector('#telegramTopicSelect');

    if (!feedbackEl) return;

    feedbackEl.className = 'telegram-feedback loading mt-2';
    feedbackEl.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i>Loading group info...';
    feedbackEl.classList.remove('hidden');

    try {
      const response = await apiCall('/api/admin/telegram/group-info', {
        method: 'POST',
        body: JSON.stringify({
          token: telegramModalState.botToken,
          chatId,
        }),
      });

      const selectedGroup = telegramModalState.detectedGroups.find(
        (g) => g.id === chatId
      );
      telegramModalState.selectedGroup = selectedGroup || {
        id: chatId,
        title: response.title || 'Unknown',
      };
      telegramModalState.groupInfo = response;

      if (response.isForum && response.topics && response.topics.length > 0) {
        telegramModalState.selectedTopic = null;

        if (topicSelect) {
          topicSelect.innerHTML = '<option value="">General (default)</option>';
          response.topics.forEach((topic) => {
            const option = doc.createElement('option');
            option.value = topic.id;
            option.textContent = topic.name || `Topic ${topic.id}`;
            topicSelect.appendChild(option);
          });
        }

        if (step3El) {
          step3El.classList.remove('hidden');
          enableTelegramStep(3);
        }
        updateTelegramModalStep(3);

        feedbackEl.className = 'telegram-feedback success mt-2';
        feedbackEl.innerHTML = `<i class="fas fa-check-circle"></i>Group selected: ${response.title}. This is a forum group - select a topic below.`;
        feedbackEl.classList.remove('hidden');
      } else {
        if (step3El) {
          step3El.classList.add('hidden');
        }
        enableTelegramStep(4);
        updateTelegramModalStep(4);

        feedbackEl.className = 'telegram-feedback success mt-2';
        feedbackEl.innerHTML = `<i class="fas fa-check-circle"></i>Group selected: ${response.title}. You can now test and save.`;
        feedbackEl.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error getting group info:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to get group info';
      feedbackEl.className = 'telegram-feedback error mt-2';
      feedbackEl.innerHTML = `<i class="fas fa-exclamation-circle"></i>${errorMsg}`;
      feedbackEl.classList.remove('hidden');
    }
  }

  function handleSelectTelegramTopic(modal, threadId) {
    if (!telegramModalState) return;

    const topicSelect = modal.querySelector('#telegramTopicSelect');
    if (!topicSelect) return;

    const selectedOption = topicSelect.options[topicSelect.selectedIndex];
    const topicName = selectedOption ? selectedOption.textContent : null;

    telegramModalState.selectedTopic = threadId
      ? { threadId: parseInt(threadId, 10), topicName }
      : null;

    enableTelegramStep(4);
    updateTelegramModalStep(4);
  }

  async function handleSendTelegramTest(modal) {
    if (
      !telegramModalState ||
      !telegramModalState.botToken ||
      !telegramModalState.selectedGroup
    ) {
      showToast('Please complete all previous steps', 'error');
      return;
    }

    const testBtn = modal.querySelector('#sendTelegramTestBtn');
    const feedbackEl = modal.querySelector('#telegramSaveFeedback');

    if (!testBtn || !feedbackEl) return;

    testBtn.disabled = true;
    testBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Sending...';
    feedbackEl.className = 'telegram-feedback loading mb-3';
    feedbackEl.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i>Sending test message...';
    feedbackEl.classList.remove('hidden');

    try {
      const response = await apiCall('/api/admin/telegram/test-preview', {
        method: 'POST',
        body: JSON.stringify({
          token: telegramModalState.botToken,
          chatId: telegramModalState.selectedGroup.id,
          threadId: telegramModalState.selectedTopic?.threadId || null,
        }),
      });

      if (response.success) {
        feedbackEl.className = 'telegram-feedback success mb-3';
        feedbackEl.innerHTML =
          '<i class="fas fa-check-circle"></i>Test message sent! Check your Telegram group.';
        feedbackEl.classList.remove('hidden');
        showToast('Test message sent successfully', 'success');
      } else {
        throw new Error(response.error || 'Failed to send test message');
      }
    } catch (error) {
      console.error('Error sending Telegram test:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to send test message';
      feedbackEl.className = 'telegram-feedback error mb-3';
      feedbackEl.innerHTML = `<i class="fas fa-exclamation-circle"></i>${errorMsg}`;
      feedbackEl.classList.remove('hidden');
    } finally {
      testBtn.disabled = false;
      testBtn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Send Test';
    }
  }

  async function handleSaveTelegramConfig(modal) {
    if (
      !telegramModalState ||
      !telegramModalState.botToken ||
      !telegramModalState.selectedGroup
    ) {
      showToast('Please complete all previous steps', 'error');
      return;
    }

    const saveBtn = modal.querySelector('#saveTelegramConfigBtn');
    const feedbackEl = modal.querySelector('#telegramSaveFeedback');

    if (!saveBtn || !feedbackEl) return;

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
    feedbackEl.className = 'telegram-feedback loading mb-3';
    feedbackEl.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i>Saving configuration...';
    feedbackEl.classList.remove('hidden');

    try {
      const response = await apiCall('/api/admin/telegram/save-config', {
        method: 'POST',
        body: JSON.stringify({
          botToken: telegramModalState.botToken,
          chatId: telegramModalState.selectedGroup.id,
          threadId: telegramModalState.selectedTopic?.threadId || null,
          chatTitle:
            telegramModalState.selectedGroup.title ||
            telegramModalState.groupInfo?.title ||
            'Admin Group',
          topicName: telegramModalState.selectedTopic?.topicName || null,
        }),
      });

      if (response.success) {
        feedbackEl.className = 'telegram-feedback success mb-3';
        feedbackEl.innerHTML =
          '<i class="fas fa-check-circle"></i>Configuration saved successfully!';
        feedbackEl.classList.remove('hidden');
        showToast('Telegram notifications enabled!', 'success');

        setTimeoutFn(() => {
          modal.classList.add('hidden');
          setTimeoutFn(() => {
            if (doc.body.contains(modal)) {
              doc.body.removeChild(modal);
            }
            telegramModalState = null;

            categoryData.admin = null;
            loadCategoryData('admin');
          }, 300);
        }, 1000);
      } else {
        throw new Error(response.error || 'Failed to save configuration');
      }
    } catch (error) {
      console.error('Error saving Telegram config:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to save configuration';
      feedbackEl.className = 'telegram-feedback error mb-3';
      feedbackEl.innerHTML = `<i class="fas fa-exclamation-circle"></i>${errorMsg}`;
      feedbackEl.classList.remove('hidden');
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Save & Enable';
    }
  }

  async function handleDisconnectTelegram() {
    const confirmed = await showConfirmation(
      'Disconnect Telegram',
      'Are you sure you want to disconnect Telegram notifications?',
      'You can reconnect at any time.',
      'Disconnect'
    );

    if (!confirmed) return;

    try {
      const response = await apiCall('/api/admin/telegram/disconnect', {
        method: 'DELETE',
      });

      if (response.success) {
        showToast('Telegram disconnected successfully', 'success');

        categoryData.admin = null;
        await loadCategoryData('admin');
      }
    } catch (error) {
      console.error('Error disconnecting Telegram:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to disconnect Telegram';
      showToast(errorMsg, 'error');
    }
  }

  async function handleToggleTelegramRecommendations() {
    try {
      const status = await apiCall(
        '/api/admin/telegram/recommendations/status'
      );
      const newEnabled = !status.recommendationsEnabled;

      const response = await apiCall(
        '/api/admin/telegram/recommendations/toggle',
        {
          method: 'POST',
          body: JSON.stringify({ enabled: newEnabled }),
        }
      );

      if (response.success) {
        showToast(
          newEnabled
            ? 'Recommendation notifications enabled'
            : 'Recommendation notifications disabled',
          'success'
        );

        categoryData.admin = null;
        await loadCategoryData('admin');
      }
    } catch (error) {
      console.error('Error toggling Telegram recommendations:', error);
      const errorMsg =
        error.data?.error || error.message || 'Failed to toggle setting';
      showToast(errorMsg, 'error');
    }
  }

  async function handleTestTelegramRecommendations() {
    try {
      const response = await apiCall(
        '/api/admin/telegram/recommendations/test',
        {
          method: 'POST',
        }
      );

      if (response.success) {
        showToast(
          `Test notification sent for year ${response.year}`,
          'success'
        );
      }
    } catch (error) {
      console.error('Error sending test recommendation notification:', error);
      const errorMsg =
        error.data?.error ||
        error.message ||
        'Failed to send test notification';
      showToast(errorMsg, 'error');
    }
  }

  return {
    handleConfigureTelegram,
    handleDisconnectTelegram,
    handleToggleTelegramRecommendations,
    handleTestTelegramRecommendations,
  };
}
