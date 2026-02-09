// utils/claude-summary.js
// Album summary fetching from Claude API with web search

const logger = require('./logger');
const { createClaudeClient } = require('./claude-client');
const { recordClaudeUsage, observeExternalApiCall } = require('./metrics');

// Summary source constant
const SUMMARY_SOURCE = 'claude';

/**
 * Build the prompt with configurable length guidance
 */
function buildPrompt(artist, album, targetSentences, targetMaxChars) {
  let lengthGuidance = '';
  if (targetMaxChars > 0) {
    lengthGuidance = ` Keep your response under ${targetMaxChars} characters.`;
  } else if (targetSentences > 0) {
    lengthGuidance = ` Write exactly ${targetSentences} sentences.`;
  }

  return `Search for information about the album "${album}" by ${artist} and write a concise, factual summary.${lengthGuidance}

Cover these elements when information is available: release date (year), primary genre(s), significance or critical reception, and any notable ideological associations of the artist (political, religious, or social views). Mention ideology naturally when relevant or controversial.

CRITICAL: Write ONLY the final summary. Use only verified search results. If insufficient reliable information is found, respond "No information available." Write factually in neutral tone. DO NOT include ANY meta-commentary, preambles, explanations about your search process, or statements about needing more information. Start directly with factual album information.`;
}

/**
 * Remove common preambles and meta-commentary from summary text
 */
function stripPreambles(text) {
  if (!text) return text;

  // Common preamble patterns to remove
  const preamblePatterns = [
    /^Based on my research,?\s*/i,
    /^Here is a \d+-sentence summary of[^:]*:\s*/i,
    /^Here's a \d+-sentence summary of[^:]*:\s*/i,
    /^Here is a summary of[^:]*:\s*/i,
    /^Here's a summary of[^:]*:\s*/i,
    /^Let me search for[^.]*\.\s*/i,
    /^According to my search,?\s*/i,
    /^From my research,?\s*/i,
    // Internal reasoning and meta-commentary patterns
    /^I need to search for[^.]*\.\s*/i,
    /^I need to find[^.]*\.\s*/i,
    /^I should search for[^.]*\.\s*/i,
    /^I'll search for[^.]*\.\s*/i,
    /^I will search for[^.]*\.\s*/i,
    /^I couldn't find[^.]*\.\s*/i,
    /^I was unable to[^.]*\.\s*/i,
    /^Unable to find[^.]*\.\s*/i,
    /[^.]*to complete the requirements\.\s*/i,
    /[^.]*to fulfill the requirements\.\s*/i,
    /[^.]*to meet the requirements\.\s*/i,
  ];

  let cleaned = text;
  let changed = true;

  // Keep stripping preambles until no more matches (handles multiple preambles)
  while (changed) {
    changed = false;
    for (const pattern of preamblePatterns) {
      const before = cleaned;
      cleaned = cleaned.replace(pattern, '');
      if (cleaned !== before) {
        changed = true;
      }
    }
  }

  return cleaned.trim();
}

/**
 * Extract summary text from Claude's response content
 * Uses the shared extractTextFromContent for text block extraction,
 * then applies summary-specific preamble stripping and logging
 */
function extractSummaryFromContent(content, artist, album, log) {
  if (!content || !Array.isArray(content)) {
    return null;
  }

  const textBlocks = content.filter((block) => block.type === 'text');
  if (textBlocks.length === 0) {
    return null;
  }

  // Join all text blocks with spaces
  let summary = textBlocks
    .map((block) => block.text)
    .join(' ')
    .trim();

  // Remove common preambles
  const originalLength = summary.length;
  summary = stripPreambles(summary);

  // Log if preamble was removed
  if (summary.length < originalLength) {
    log.debug('Removed preamble from Claude response', {
      artist,
      album,
      originalLength,
      cleanedLength: summary.length,
      removed: originalLength - summary.length,
    });
  }

  // Debug logging for short summaries
  if (summary.length < 100) {
    log.debug('Short summary detected - checking text blocks', {
      artist,
      album,
      textBlockCount: textBlocks.length,
      textBlockLengths: textBlocks.map((b) => b.text?.length || 0),
      totalLength: summary.length,
    });
  }

  return summary;
}

/**
 * Validate and log warnings for summary length/sentence requirements
 */
function validateSummary(summary, artist, album, log) {
  const sentenceCount = (summary.match(/[.!?]+/g) || []).length;
  const minChars = parseInt(process.env.CLAUDE_SUMMARY_MIN_CHARS || '250', 10);
  const maxChars = parseInt(process.env.CLAUDE_SUMMARY_MAX_CHARS || '0', 10);
  const minSentences = parseInt(
    process.env.CLAUDE_SUMMARY_MIN_SENTENCES || '2',
    10
  );

  if (summary.length < minChars) {
    log.warn('Claude returned summary shorter than configured minimum', {
      artist,
      album,
      summaryLength: summary.length,
      minChars,
      sentenceCount,
    });
  } else if (maxChars > 0 && summary.length > maxChars) {
    log.warn('Claude returned summary longer than configured maximum', {
      artist,
      album,
      summaryLength: summary.length,
      maxChars,
      sentenceCount,
    });
  } else if (sentenceCount < minSentences) {
    log.warn(
      'Claude returned summary with fewer than configured minimum sentences',
      {
        artist,
        album,
        summaryLength: summary.length,
        minSentences,
        sentenceCount,
      }
    );
  }
}

/**
 * Create Claude summary service with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.anthropicClient - Anthropic client instance (for testing)
 * @param {Object} deps.claudeClient - Shared claude-client instance (for testing)
 */
function createClaudeSummaryService(deps = {}) {
  const log = deps.logger || logger;

  // Create or use injected claude-client
  const claudeClient =
    deps.claudeClient ||
    createClaudeClient({
      logger: log,
      anthropicClient: deps.anthropicClient || undefined,
    });

  /**
   * Fetch album summary from Claude API with web search
   * @param {string} artist - Artist name
   * @param {string} album - Album name
   * @returns {Promise<{summary: string|null, source: string, found: boolean}>}
   */
  async function fetchClaudeSummary(artist, album) {
    if (!artist || !album) {
      return { summary: null, source: SUMMARY_SOURCE, found: false };
    }

    const client = claudeClient.getClient();
    if (!client) {
      log.error('Claude API client not available (missing API key)');
      return { summary: null, source: SUMMARY_SOURCE, found: false };
    }

    // Read config at call time, not module load time
    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
    const maxTokens = parseInt(process.env.CLAUDE_MAX_TOKENS || '400', 10);

    // Configurable summary length preferences
    const targetSentences = parseInt(
      process.env.CLAUDE_SUMMARY_SENTENCES || '5',
      10
    );
    const targetMaxChars = parseInt(
      process.env.CLAUDE_SUMMARY_MAX_CHARS || '0',
      10
    ); // 0 = no limit

    const startTime = Date.now();

    try {
      const message = await claudeClient.retryWithBackoff(
        async () => {
          await claudeClient.waitForRateLimit();

          const prompt = buildPrompt(
            artist,
            album,
            targetSentences,
            targetMaxChars
          );

          log.debug('Calling Claude API for album summary', {
            artist,
            album,
            model,
          });

          return await client.messages.create({
            model,
            max_tokens: maxTokens,
            temperature: 0.43,
            system:
              'You are a music encyclopedia providing accurate, concise album information from web search results.',
            tools: [
              {
                type: 'web_search_20250305',
                name: 'web_search',
                max_uses: 3,
              },
            ],
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
          });
        },
        3,
        log
      );

      const duration = Date.now() - startTime;

      // Extract text content from Claude's response
      const summary = extractSummaryFromContent(
        message.content,
        artist,
        album,
        log
      );

      if (summary) {
        // Validate response quality
        const isNoInfo = summary
          .toLowerCase()
          .includes('no information available');
        const isTooShort = summary.length < 50;

        if (isNoInfo || isTooShort) {
          log.warn('Claude returned invalid or no-info response', {
            artist,
            album,
            summaryLength: summary.length,
            isNoInfo,
          });
          // Record usage but return no summary
          if (message.usage) {
            recordClaudeUsage(
              model,
              message.usage.input_tokens || 0,
              message.usage.output_tokens || 0,
              'no_info'
            );
          }
          observeExternalApiCall('claude', 'messages.create', duration, 404);
          return { summary: null, source: SUMMARY_SOURCE, found: false };
        }

        validateSummary(summary, artist, album, log);

        // Record token usage and estimated cost
        if (message.usage) {
          recordClaudeUsage(
            model,
            message.usage.input_tokens || 0,
            message.usage.output_tokens || 0,
            'success'
          );
        }

        log.info('Claude API returned album summary', {
          artist,
          album,
          summaryLength: summary.length,
          duration_ms: duration,
          inputTokens: message.usage?.input_tokens,
          outputTokens: message.usage?.output_tokens,
        });

        observeExternalApiCall('claude', 'messages.create', duration, 200);
        return {
          summary,
          source: SUMMARY_SOURCE,
          found: true,
        };
      } else {
        // Record token usage even for failed responses
        if (message.usage) {
          recordClaudeUsage(
            model,
            message.usage.input_tokens || 0,
            message.usage.output_tokens || 0,
            'success'
          );
        }

        log.warn('Claude API returned no text content', {
          artist,
          album,
          content: message.content,
          contentTypes: message.content?.map((c) => c.type),
          usage: message.usage,
        });
        observeExternalApiCall('claude', 'messages.create', duration, 200);
        return { summary: null, source: SUMMARY_SOURCE, found: false };
      }
    } catch (err) {
      const duration = Date.now() - startTime;
      claudeClient.handleApiError(err, duration, log, model, {
        artist,
        album,
      });
      return { summary: null, source: SUMMARY_SOURCE, found: false };
    }
  }

  return {
    fetchClaudeSummary,
    SUMMARY_SOURCE,
  };
}

// Default instance
const defaultInstance = createClaudeSummaryService();

module.exports = {
  createClaudeSummaryService,
  fetchClaudeSummary: defaultInstance.fetchClaudeSummary,
  SUMMARY_SOURCE,
};
