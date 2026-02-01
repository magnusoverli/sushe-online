// utils/claude-summary.js
// Album summary fetching from Claude API with web search

const Anthropic = require('@anthropic-ai/sdk');
const logger = require('./logger');
const {
  observeExternalApiCall,
  recordExternalApiError,
  recordClaudeUsage,
} = require('./metrics');

// Summary source constant
const SUMMARY_SOURCE = 'claude';

// Rate limiter: 2 requests per second (500ms = 120 RPM, safe for all tiers)
const RATE_LIMIT_MS = parseInt(process.env.CLAUDE_RATE_LIMIT_MS || '500', 10);
let lastRequestTime = 0;

/**
 * Wait for rate limit
 */
async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    await new Promise((r) =>
      setTimeout(r, RATE_LIMIT_MS - timeSinceLastRequest)
    );
  }
  lastRequestTime = Date.now();
}

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

  return `Search for information about the album "${album}" by ${artist} and write a concise summary.${lengthGuidance}

Include: release date (year), primary genre(s), one key fact about significance/reception, and any notable ideological associations of the artist (political, religious, or social). Keep ideology mention brief unless significant or controversial.

Requirements: Use only verified search results. If no reliable information found, respond "No information available." Write factually in neutral tone without superlatives. DO NOT include preambles like "Here is a summary" or "Based on my research" - start directly with the album information.`;
}

/**
 * Remove common preambles from summary text
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
  ];

  let cleaned = text;
  for (const pattern of preamblePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  return cleaned.trim();
}

/**
 * Extract summary text from Claude's response content
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
  const minChars = parseInt(process.env.CLAUDE_SUMMARY_MIN_CHARS || '100', 10);
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
 * Handle Claude API errors with appropriate logging and metrics
 */
function handleApiError(
  err,
  artist,
  album,
  duration,
  log,
  model = 'claude-haiku-4-5'
) {
  recordExternalApiError('claude', 'api_error');

  // Record request failure metrics
  const status = err.status === 429 ? 'rate_limited' : 'error';
  recordClaudeUsage(model, 0, 0, status);

  if (err.status === 429) {
    log.warn('Claude API rate limit exceeded', {
      artist,
      album,
      error: err.message,
      status: err.status,
      retryAfter: err.headers?.['retry-after'] || err.retryAfter,
    });
    observeExternalApiCall('claude', 'messages.create', duration, 429);
  } else if (err.status >= 500) {
    log.error('Claude API server error', {
      artist,
      album,
      status: err.status,
      error: err.message,
      stack: err.stack,
      type: err.type,
    });
    observeExternalApiCall(
      'claude',
      'messages.create',
      duration,
      err.status || 500
    );
  } else if (err.status === 401 || err.status === 403) {
    log.error('Claude API authentication error', {
      artist,
      album,
      status: err.status,
      error: err.message,
      type: err.type,
    });
    observeExternalApiCall(
      'claude',
      'messages.create',
      duration,
      err.status || 401
    );
  } else {
    log.error('Claude API error', {
      artist,
      album,
      status: err.status,
      error: err.message,
      stack: err.stack,
      type: err.type,
      cause: err.cause?.message,
    });
    observeExternalApiCall(
      'claude',
      'messages.create',
      duration,
      err.status || 400
    );
  }
}

/**
 * Retry API call with exponential backoff
 * Respects Retry-After headers for 429 responses
 */
async function retryWithBackoff(fn, maxRetries = 3, log) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Don't retry client errors (except 429)
      if (
        err.status &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 429
      ) {
        throw err;
      }

      // Last attempt - give up
      if (attempt === maxRetries) {
        break;
      }

      // Calculate backoff
      let backoffMs;
      if (err.status === 429 && err.headers?.['retry-after']) {
        // Respect Retry-After header (seconds)
        backoffMs = parseInt(err.headers['retry-after'], 10) * 1000;
      } else {
        // Exponential backoff: 1s, 2s, 4s
        backoffMs = Math.pow(2, attempt - 1) * 1000;
      }

      log.info('Retrying Claude API call', {
        attempt,
        maxRetries,
        backoffMs,
        status: err.status,
        isRateLimit: err.status === 429,
      });

      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError;
}

/**
 * Create Claude summary service with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.anthropicClient - Anthropic client instance (for testing)
 */
function createClaudeSummaryService(deps = {}) {
  const log = deps.logger || logger;

  // Lazy-initialized client - created on first use, not at module load time
  // This ensures environment variables are available in Docker containers
  let anthropicClient = deps.anthropicClient || null;

  function getClient() {
    if (anthropicClient) return anthropicClient;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return null;
    }

    anthropicClient = new Anthropic({ apiKey });
    return anthropicClient;
  }

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

    const anthropic = getClient();
    if (!anthropic) {
      log.error('Claude API client not available (missing API key)');
      return { summary: null, source: SUMMARY_SOURCE, found: false };
    }

    // Read config at call time, not module load time
    const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';
    const maxTokens = parseInt(process.env.CLAUDE_MAX_TOKENS || '300', 10);

    // Configurable summary length preferences
    const targetSentences = parseInt(
      process.env.CLAUDE_SUMMARY_SENTENCES || '4',
      10
    );
    const targetMaxChars = parseInt(
      process.env.CLAUDE_SUMMARY_MAX_CHARS || '0',
      10
    ); // 0 = no limit

    const startTime = Date.now();

    try {
      const message = await retryWithBackoff(async () => {
        await waitForRateLimit();

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

        return await anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          temperature: 0.3,
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
      }, 3, log);

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
        const isNoInfo =
          summary.toLowerCase().includes('no information available');
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
      handleApiError(err, artist, album, duration, log, model);
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
