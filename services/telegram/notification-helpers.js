function priorityEmoji(priority) {
  const emojis = { urgent: '🔴', high: '🟠', normal: '🟡', low: '⚪' };
  return emojis[priority] || '🟡';
}

function createNotificationHelpers(apiRequest, configManager, messenger, log) {
  async function notifyNewEvent(event, actions = []) {
    const config = await configManager.getConfig();
    if (!config?.enabled) return null;

    const emoji = priorityEmoji(event.priority);
    let text = `${emoji} *${event.priority.toUpperCase()}* — ${event.title}\n\n`;

    if (event.description) {
      text += `${event.description}\n\n`;
    }

    if (event.data && typeof event.data === 'object') {
      const data =
        typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

      if (data.username) text += `👤 User: \`${data.username}\`\n`;
      if (data.email) text += `📧 Email: \`${data.email}\`\n`;
    }

    text += `\n🆔 Event: \`${event.id.slice(0, 8)}\``;

    const keyboard = [];
    if (actions.length > 0) {
      keyboard.push(
        actions.map((action) => ({
          text: action.label,
          callback_data: `event:${event.id}:${action.id}`,
        }))
      );
    }

    const result = await messenger.sendMessage(text, keyboard);

    return result.success
      ? { messageId: result.messageId, chatId: result.chatId }
      : null;
  }

  async function updateEventMessage(event, action, adminUsername) {
    if (!event.telegram_message_id) return false;

    const statusEmoji = { approved: '✅', rejected: '❌', dismissed: '🗑️' };
    const emoji = statusEmoji[event.status] || '✓';
    let text = `${emoji} *${event.status.toUpperCase()}* — ${event.title}\n\n`;

    if (event.description) {
      text += `~${event.description}~\n\n`;
    }

    text += `${emoji} ${action.charAt(0).toUpperCase() + action.slice(1)} by *${adminUsername}*`;

    return messenger.editMessage(event.telegram_message_id, text, []);
  }

  async function sendTestMessage() {
    const text =
      '✅ *SuShe Admin Notifications*\n\n' +
      'This is a test message. Telegram notifications are working correctly!\n\n' +
      `🕐 Sent at: ${new Date().toISOString()}`;

    return messenger.sendMessage(text);
  }

  async function sendTestMessageWithCredentials(token, chatId, threadId) {
    const text =
      '✅ *SuShe Admin Notifications*\n\n' +
      'This is a test message. If you see this, the bot can send messages to this chat!\n\n' +
      `🕐 Sent at: ${new Date().toISOString()}`;

    try {
      const params = { chat_id: chatId, text, parse_mode: 'Markdown' };
      if (threadId) {
        params.message_thread_id = threadId;
      }

      const result = await apiRequest(token, 'sendMessage', params);
      return { success: true, messageId: result.message_id };
    } catch (err) {
      log.error('Error sending test message with credentials:', err);
      return { success: false, error: err.message || 'Failed to send message' };
    }
  }

  return {
    notifyNewEvent,
    sendTestMessage,
    sendTestMessageWithCredentials,
    updateEventMessage,
  };
}

module.exports = {
  createNotificationHelpers,
};
