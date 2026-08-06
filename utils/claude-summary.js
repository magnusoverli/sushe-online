// utils/claude-summary.js
// Album summary fetching from Claude API with web search

// The CJS entry point of @anthropic-ai/sdk is constructable
// (`new Anthropic({ apiKey })`), but its type declarations only describe the
// ESM namespace object, which structurally has no construct signature — hence
// restating the constructor type here (via `unknown`, as the two shapes do not
// overlap structurally).
const Anthropic = /** @type {typeof import('@anthropic-ai/sdk').Anthropic} */ (
  /** @type {unknown} */ (require('@anthropic-ai/sdk'))
);
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

  return `Search for information about the album "${album}" by ${artist} and write a concise, factual summary.${lengthGuidance}

Cover these elements when information is available: release date (year), primary genre(s), significance or critical reception, and any notable ideological associations of the artist (political, religious, or social views). Mention ideology naturally when relevant or controversial.

CRITICAL: Write ONLY the final summary. Use only verified search results. If insufficient reliable information is found, respond "No information available." Write factually in neutral tone. DO NOT include ANY meta-commentary, preambles, explanations about your search process, or statements about needing more information. Start directly with factual album information.`;
}

/**
 * Run async operation with timeout.
 */
async function withTimeout(operation, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) {
    return operation;
  }

  let timeoutId = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const timeoutError =
        /** @type {Error & {code: string, status: number}} */ (
          new Error(`Claude request timed out after ${timeoutMs}ms`)
        );
      timeoutError.code = 'CLAUDE_TIMEOUT';
      timeoutError.status = 408;
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
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
    // Narration where the verb is not "search" itself — "I will do the search
    // and find out ..., then produce a summary." The clause runs to the first
    // sentence end, which is where the factual text starts.
    /^I(?:'ll|'m| will| am| need to| should| can| would)\b[^.!?]*\b(?:search|look(?:ing)? up|find out|check|research|gather|gathering)\b[^.!?]*[.!?]+\s*/i,
    /^(?:Let me|Let's|First,? I(?:'ll)?)\b[^.!?]*[.!?]+\s*/i,
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
 * Index of the last block produced by tool activity, or -1 if there was none.
 *
 * Any block that is neither text nor thinking counts as tool activity, so this
 * keeps working if the search tool gains new result block types.
 *
 * Thinking blocks are deliberately not a boundary: they are the model's own
 * reasoning rather than a step in the turn, and the text filter drops them
 * anyway.
 *
 * @param {Array<{type?: string}>} content
 * @returns {number}
 */
function lastToolBlockIndex(content) {
  for (let i = content.length - 1; i >= 0; i--) {
    const type = content[i]?.type;
    if (
      type &&
      type !== 'text' &&
      type !== 'thinking' &&
      type !== 'redacted_thinking'
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Extract summary text from Claude's response content.
 *
 * Only the text after the final tool result is the answer. Given a server-side
 * search tool the model routinely narrates before it searches — "I'll look this
 * album up, then write the summary" — and that narration arrives as its own
 * text block, ahead of the search. Joining every text block glued that opening
 * onto the front of the real summary, which is how it reached users. Position
 * decides this, not phrasing, so no wording can slip past it.
 */
function extractSummaryFromContent(content, artist, album, log) {
  if (!content || !Array.isArray(content)) {
    return null;
  }

  const boundary = lastToolBlockIndex(content);
  const textBlocks = content
    .slice(boundary + 1)
    .filter((block) => block.type === 'text');

  if (textBlocks.length === 0) {
    // There may well be text earlier in the turn, but everything before the
    // last tool result is pre-search narration by definition. Falling back to
    // it is exactly the bug this function exists to prevent, so a turn that
    // searched and then said nothing counts as no answer at all.
    const narrationBlocks = content.filter(
      (block) => block.type === 'text'
    ).length;
    if (narrationBlocks > 0) {
      log.warn('Claude produced no text after its final search', {
        artist,
        album,
        narrationBlocks,
      });
    }
    return null;
  }

  const droppedBlocks = content
    .slice(0, boundary + 1)
    .filter((block) => block.type === 'text').length;
  if (droppedBlocks > 0) {
    log.debug('Discarded pre-search narration blocks', {
      artist,
      album,
      droppedBlocks,
    });
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
 * Openings that mean the model is describing its task rather than the album.
 *
 * Matched only at the very start, and only against wording a factual summary
 * would never open with. The first-person entries are all contractions or are
 * followed by an explicit narration verb, because bare "I am"/"I was"/"I do"
 * are album titles — "I Am" (Nas), "I Against I" (Bad Brains) — and must pass
 * through untouched. A missed preamble is recoverable; discarding a real
 * summary for a real album is not.
 */
const META_OPENINGS = [
  /^I\s*['’]\s*(?:ll|ve|m|d)\b/i,
  /^I\s+(?:will|need|should|must|cannot|can't|couldn't|don't|didn't|apologize|apologise|could not|was unable|am unable|am going to)\b/i,
  /^(?:Let me|Let's|Okay|OK|Sure|Certainly|Of course|As requested)\b/i,
  /^Here(?:'s|’s| is| are)\s+(?:a|an|the|what|your)\b/i,
  /^(?:Based on|According to)\s+(?:my|the)\s+(?:search|research|result)/i,
];

/**
 * Why this response is unusable, or null if it is fine.
 *
 * Rejecting rather than trimming is deliberate for meta-commentary: it is only
 * reached once stripPreambles has already failed, and at that point there is no
 * reliable seam between the narration and the summary to cut on. A summary is
 * regenerable, so returning nothing beats storing something wrong.
 *
 * @param {string} summary
 * @returns {'no_info'|'too_short'|'meta_commentary'|null}
 */
function rejectionReason(summary) {
  if (summary.toLowerCase().includes('no information available')) {
    return 'no_info';
  }
  if (summary.length < 50) {
    return 'too_short';
  }
  if (META_OPENINGS.some((pattern) => pattern.test(summary))) {
    return 'meta_commentary';
  }
  return null;
}

/** Effort levels the API accepts. Anything else is a 400. */
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Resolve the configured effort level, rejecting values the API would refuse.
 *
 * @param {string|undefined} raw - CLAUDE_SUMMARY_EFFORT, if set.
 * @param {{ warn: Function }} log
 * @returns {'low'|'medium'|'high'|'xhigh'|'max'}
 */
function resolveEffort(raw, log) {
  if (!raw) return 'medium';
  if (EFFORT_LEVELS.includes(raw)) {
    return /** @type {'low'|'medium'|'high'|'xhigh'|'max'} */ (raw);
  }
  log.warn('Ignoring unrecognised CLAUDE_SUMMARY_EFFORT', {
    value: raw,
    accepted: EFFORT_LEVELS,
  });
  return 'medium';
}

/**
 * Read the per-call configuration from the environment.
 *
 * Deliberately read per call rather than at module load, so a container can be
 * reconfigured without a rebuild.
 *
 * @param {{ warn: Function }} log
 */
function readSummaryConfig(log) {
  return {
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-5',
    // Thinking is on by default on Sonnet 5 and its tokens count against
    // max_tokens alongside the visible text, so this has to leave room for
    // both or the summary truncates. It is a ceiling, not a reservation —
    // unused budget costs nothing.
    maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS || '4096', 10),
    // Lower effort makes the model reach for tools less readily, and this
    // summary is only trustworthy if web_search actually ran. `medium` buys
    // that reliability well below the `high` default.
    effort: resolveEffort(process.env.CLAUDE_SUMMARY_EFFORT, log),
    requestTimeoutMs: parseInt(
      process.env.CLAUDE_REQUEST_TIMEOUT_MS || '30000',
      10
    ),
    targetSentences: parseInt(process.env.CLAUDE_SUMMARY_SENTENCES || '5', 10),
    // 0 = no limit
    targetMaxChars: parseInt(process.env.CLAUDE_SUMMARY_MAX_CHARS || '0', 10),
  };
}

/**
 * Record token usage for a response, when the response reports any.
 *
 * @param {{ usage?: { input_tokens?: number, output_tokens?: number } }} message
 * @param {string} model - The model that produced it, for cost attribution.
 * @param {string} status - 'success' | 'no_info' | 'error'
 */
function recordUsage(message, model, status) {
  if (!message.usage) return;
  recordClaudeUsage(
    model,
    message.usage.input_tokens || 0,
    message.usage.output_tokens || 0,
    status
  );
}

/**
 * Did the turn end without a usable answer?
 *
 * `end_turn` is the only reason that yields a complete summary. Everything
 * else — truncation, a paused server-tool loop, a refusal — can still return
 * text, which would otherwise be stored as though it were finished.
 *
 * @param {string|null|undefined} stopReason
 * @returns {boolean}
 */
function isUnfinishedTurn(stopReason) {
  if (!stopReason || stopReason === 'end_turn') return false;
  return (
    stopReason === 'max_tokens' ||
    stopReason === 'pause_turn' ||
    stopReason === 'model_context_window_exceeded' ||
    stopReason === 'refusal'
  );
}

/**
 * Read Retry-After off an SDK error.
 *
 * `APIError.headers` is a WHATWG Headers instance, where indexing by name
 * always yields undefined — only get() reads a value. Indexing it silently
 * disabled Retry-After handling entirely, so a 429 fell through to plain
 * exponential backoff instead of waiting as long as the API asked.
 *
 * Always returns a string so callers can parseInt it without re-checking; the
 * SDK's own `retryAfter` convenience field is a number.
 *
 * @param {{ headers?: unknown, retryAfter?: string|number }} err
 * @returns {string|undefined} Seconds to wait, or undefined.
 */
function readRetryAfter(err) {
  const headers = err?.headers;
  if (headers && typeof (/** @type {Headers} */ (headers).get) === 'function') {
    const value = /** @type {Headers} */ (headers).get('retry-after');
    if (value) return value;
  }
  // Plain-object headers, and the SDK's own convenience field.
  if (headers && typeof headers === 'object') {
    const value = /** @type {Record<string, string>} */ (headers)[
      'retry-after'
    ];
    if (value) return value;
  }
  return err?.retryAfter == null ? undefined : String(err.retryAfter);
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
  // Only reached if a caller omits it; the live call site passes the model it
  // actually used. Kept in step with the default in fetchClaudeSummary so a
  // failed request cannot be costed against the wrong model.
  model = 'claude-sonnet-5'
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
      retryAfter: readRetryAfter(err),
    });
    observeExternalApiCall('claude', 'messages.create', duration, 429);
  } else if (err.code === 'CLAUDE_TIMEOUT' || err.status === 408) {
    log.warn('Claude API request timed out', {
      artist,
      album,
      status: err.status,
      error: err.message,
    });
    observeExternalApiCall('claude', 'messages.create', duration, 408);
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
      const retryAfter = readRetryAfter(err);
      if (err.status === 429 && retryAfter) {
        // Respect Retry-After header (seconds)
        backoffMs = parseInt(retryAfter, 10) * 1000;
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
 * @param {Object} [deps] - Dependencies (all optional; defaults are resolved
 *   from the module logger and the ANTHROPIC_API_KEY environment variable)
 * @param {Object} [deps.logger] - Logger instance
 * @param {InstanceType<typeof Anthropic>} [deps.anthropicClient] - Anthropic
 *   client instance (for testing)
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
    const {
      model,
      maxTokens,
      effort,
      requestTimeoutMs,
      targetSentences,
      targetMaxChars,
    } = readSummaryConfig(log);

    const startTime = Date.now();

    try {
      const message = await retryWithBackoff(
        async () => {
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

          return await withTimeout(
            anthropic.messages.create({
              model,
              max_tokens: maxTokens,
              // No `temperature`. Sonnet 5 and the other 4.7+ models reject a
              // non-default value with a 400 on every request, so tone is
              // steered from the system prompt instead.
              output_config: { effort },
              system:
                'You are a music encyclopedia providing accurate, concise album information from web search results. ' +
                'Always search before answering; never answer an album question from memory alone. ' +
                'Be factual and consistent, and do not embellish. ' +
                'Your final message must contain the summary and nothing else — no narration of what you ' +
                'are about to do, are doing, or have done.',
              tools: [
                {
                  // Dynamic filtering: the model writes code that filters
                  // results before they reach the context window. The API
                  // provisions that code execution itself, so it must not be
                  // declared here as a second tool.
                  type: 'web_search_20260318',
                  name: 'web_search',
                  max_uses: 3,
                  // Nothing is echoed back on a later turn, so search blocks
                  // already consumed by a completed filter run are dead weight.
                  response_inclusion: 'excluded',
                },
              ],
              messages: [
                {
                  role: 'user',
                  content: prompt,
                },
              ],
            }),
            requestTimeoutMs
          );
        },
        3,
        log
      );

      const duration = Date.now() - startTime;

      // Searches actually performed. This is the signal that matters: the
      // prompt forbids answering without search results, so a zero here means
      // the summary came from model memory and cannot be trusted, however
      // fluent it reads. Nothing else in the response reveals that.
      const searchRequests =
        message.usage?.server_tool_use?.web_search_requests ?? 0;

      // A turn can end without a usable answer while still returning text.
      // Persisting those would store a truncated or partial summary as if it
      // were complete.
      if (isUnfinishedTurn(message.stop_reason)) {
        log.warn('Claude did not finish the summary', {
          artist,
          album,
          stopReason: message.stop_reason,
          // Only populated on a refusal, and its fields can each be null.
          refusalCategory: message.stop_details?.category ?? null,
          maxTokens,
          effort,
          searchRequests,
        });
        recordUsage(message, model, 'error');
        observeExternalApiCall('claude', 'messages.create', duration, 200);
        return { summary: null, source: SUMMARY_SOURCE, found: false };
      }

      // Only assert this when usage is present to tell us. Its absence means
      // we have no signal, not that no search ran.
      if (message.usage && searchRequests === 0) {
        log.warn('Claude answered without searching', {
          artist,
          album,
          effort,
          model,
        });
      }

      // Extract text content from Claude's response
      const summary = extractSummaryFromContent(
        message.content,
        artist,
        album,
        log
      );

      if (summary) {
        // Validate response quality
        const rejection = rejectionReason(summary);

        if (rejection) {
          log.warn('Claude returned invalid or no-info response', {
            artist,
            album,
            summaryLength: summary.length,
            reason: rejection,
            // The opening is what the check keyed on, and it is what a false
            // positive would have to be diagnosed from.
            opening:
              rejection === 'meta_commentary'
                ? summary.slice(0, 120)
                : undefined,
          });
          // Record usage but return no summary
          recordUsage(message, model, 'no_info');
          observeExternalApiCall('claude', 'messages.create', duration, 404);
          return { summary: null, source: SUMMARY_SOURCE, found: false };
        }

        validateSummary(summary, artist, album, log);

        // Record token usage and estimated cost
        recordUsage(message, model, 'success');

        log.info('Claude API returned album summary', {
          artist,
          album,
          summaryLength: summary.length,
          duration_ms: duration,
          inputTokens: message.usage?.input_tokens,
          outputTokens: message.usage?.output_tokens,
          searchRequests,
        });

        observeExternalApiCall('claude', 'messages.create', duration, 200);
        return {
          summary,
          source: SUMMARY_SOURCE,
          found: true,
        };
      } else {
        // Record token usage even for failed responses
        recordUsage(message, model, 'success');

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
