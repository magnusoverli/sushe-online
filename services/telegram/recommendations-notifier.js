function createRecommendationsNotifier(
  pool,
  apiRequest,
  uploadPhoto,
  configManager,
  log
) {
  async function getThreads() {
    if (!pool) return [];

    const result = await pool.query(
      'SELECT year, thread_id, topic_name, created_at FROM telegram_recommendation_threads ORDER BY year DESC'
    );

    return result.rows.map((row) => ({
      year: row.year,
      threadId: row.thread_id,
      topicName: row.topic_name,
      createdAt: row.created_at,
    }));
  }

  async function getOrCreateThread(year, botToken, chatId) {
    if (!pool) return null;

    const existing = await pool.query(
      'SELECT thread_id FROM telegram_recommendation_threads WHERE year = $1',
      [year]
    );

    if (existing.rows.length > 0) {
      return existing.rows[0].thread_id;
    }

    const topicName = `Recommendations ${year}`;

    try {
      const result = await apiRequest(botToken, 'createForumTopic', {
        chat_id: chatId,
        name: topicName,
      });

      const threadId = result.message_thread_id;

      await pool.query(
        `INSERT INTO telegram_recommendation_threads (year, thread_id, topic_name, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [year, threadId, topicName]
      );

      log.info('Created Telegram recommendation thread', {
        year,
        threadId,
        topicName,
      });

      return threadId;
    } catch (err) {
      log.error('Failed to create recommendation thread', {
        year,
        error: err.message,
      });
      return null;
    }
  }

  async function sendNotification(rec, coverImage = null) {
    try {
      const config = await configManager.getConfig(true);
      if (
        !config?.enabled ||
        !config.recommendationsEnabled ||
        !config.botToken
      ) {
        return {
          success: false,
          error: 'Recommendations notifications not enabled',
        };
      }

      const threadId = await getOrCreateThread(
        rec.year,
        config.botToken,
        config.chatId
      );
      if (!threadId) {
        return { success: false, error: 'Failed to get/create thread' };
      }

      const message = formatRecommendationMessage(rec);

      if (coverImage?.buffer) {
        try {
          await uploadPhoto(
            config.botToken,
            coverImage.buffer,
            coverImage.format,
            {
              chat_id: config.chatId,
              message_thread_id: threadId,
              caption: message,
              parse_mode: 'Markdown',
            }
          );
          return { success: true };
        } catch (photoErr) {
          log.warn('Failed to upload photo, falling back to text', {
            error: photoErr.message,
          });
        }
      }

      await apiRequest(config.botToken, 'sendMessage', {
        chat_id: config.chatId,
        message_thread_id: threadId,
        text: message,
        parse_mode: 'Markdown',
      });

      return { success: true };
    } catch (err) {
      log.error('Failed to send recommendation notification', {
        album: rec.album,
        artist: rec.artist,
        year: rec.year,
        error: err.message,
      });
      return { success: false, error: err.message };
    }
  }

  function formatRecommendationMessage(rec) {
    let dateDisplay = rec.year;
    if (rec.release_date) {
      const date = new Date(rec.release_date);
      if (!isNaN(date.getTime())) {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        dateDisplay = `${day}/${month}/${year}`;
      }
    }

    const rymSearchTerm = encodeURIComponent(`${rec.artist} ${rec.album}`);
    const rymUrl = `https://rateyourmusic.com/search?searchterm=${rymSearchTerm}&searchtype=l`;

    const lines = [
      '🎉 *New Recommendation* 🎉',
      '',
      `🎵 *${escapeMarkdown(rec.album)}*`,
      `🎤 ${escapeMarkdown(rec.artist)}`,
      `📅 ${escapeMarkdown(dateDisplay)}`,
      `🔗 [Rate Your Music](${rymUrl})`,
      '',
    ];

    if (rec.reasoning) {
      const maxLen = 300;
      let reasoning = rec.reasoning;
      if (reasoning.length > maxLen) {
        reasoning = reasoning.substring(0, maxLen) + '...';
      }
      lines.push(`💬 _"${escapeMarkdown(reasoning)}"_`);
      lines.push('');
    }

    lines.push(`👤 Recommended by ${escapeMarkdown(rec.recommended_by)}`);

    return lines.join('\n');
  }

  function escapeMarkdown(text) {
    if (!text) return '';

    return text
      .replace(/_/g, '\\_')
      .replace(/\*/g, '\\*')
      .replace(/`/g, '\\`')
      .replace(/\[/g, '\\[');
  }

  return {
    getThreads,
    sendNotification,
  };
}

module.exports = {
  createRecommendationsNotifier,
};
