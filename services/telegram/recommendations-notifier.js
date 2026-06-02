/**
 * @param {import('../../db/types').DbFacade} db - Canonical datastore with .raw().
 */
function createRecommendationsNotifier(
  db,
  apiRequest,
  uploadPhoto,
  configManager,
  log
) {
  const { AVAILABILITY_SERVICES } = require('../availability/platforms');

  const PLATFORM_LABELS = {
    spotify: 'Spotify',
    itunes: 'Apple Music',
    qobuz: 'Qobuz',
    tidal: 'Tidal',
    bandcamp: 'Bandcamp',
  };

  async function getThreads() {
    if (!db) return [];

    const result = await db.raw(
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
    if (!db) return null;

    const existing = await db.raw(
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

      await db.raw(
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

  async function getAlbumAvailability(albumId) {
    if (!db || !albumId) return [];

    const result = await db.raw(
      `SELECT service
         FROM album_service_mappings
        WHERE album_id = $1
          AND strategy LIKE 'availability:%'
          AND service = ANY($2)
        ORDER BY array_position($2::text[], service), service`,
      [albumId, AVAILABILITY_SERVICES],
      { name: 'telegram-recommendation-availability', retryable: true }
    );

    return result.rows;
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

      const availability = await getAlbumAvailability(rec.album_id);
      const message = formatRecommendationMessage(rec, availability);

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

  function formatRecommendationMessage(rec, availability = []) {
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

    const rymSearchParams = new URLSearchParams({
      searchterm: `${rec.album} ${rec.artist}`,
      searchtype: 'a',
    });
    const rymUrl = `https://rateyourmusic.com/search?${rymSearchParams.toString()}`;

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

    const availabilityLine = formatAvailabilityLine(availability);
    if (availabilityLine) {
      lines.push('');
      lines.push(availabilityLine);
    }

    return lines.join('\n');
  }

  function formatAvailabilityLine(availability) {
    if (!Array.isArray(availability) || availability.length === 0) return '';

    const badges = availability
      .map((row) => {
        const label = PLATFORM_LABELS[row.service];
        if (!label) return null;
        return `【${escapeMarkdown(label)}】`;
      })
      .filter(Boolean);

    if (badges.length === 0) return '';
    return `🎧 Available on: ${badges.join(' · ')}`;
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
