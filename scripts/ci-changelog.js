#!/usr/bin/env node

/**
 * CI Changelog Generator
 *
 * Runs in GitHub Actions after each push to main. Reads new commits
 * since the last changelog entry, sends them to Claude to determine
 * which are user-facing and generate friendly descriptions, then
 * updates src/data/changelog.json.
 *
 * Requires ANTHROPIC_API_KEY in the environment.
 *
 * Usage:
 *   node scripts/ci-changelog.js            # normal run
 *   node scripts/ci-changelog.js --dry-run  # preview without writing
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHANGELOG_JSON_PATH = path.join(
  __dirname,
  '..',
  'src',
  'data',
  'changelog.json'
);

const VALID_CATEGORIES = new Set(['feature', 'fix', 'ui', 'perf', 'security']);

/**
 * Read existing changelog entries.
 * @returns {Array} Parsed entries
 */
function readChangelog() {
  if (!fs.existsSync(CHANGELOG_JSON_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(CHANGELOG_JSON_PATH, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Get the date of the most recent changelog entry.
 * @param {Array} entries
 * @returns {string|null} ISO date string or null
 */
function getLastEntryDate(entries) {
  if (entries.length === 0) return null;
  return entries[0].date || null;
}

/**
 * Get commits since a given date (or all commits if no date).
 * Returns an array of { hash, date, message, files }.
 * @param {string|null} sinceDate
 * @returns {Array}
 */
function getNewCommits(sinceDate) {
  let gitCmd = 'git log --format="%H|%ad|%s" --date=short';
  if (sinceDate) {
    // Go back one day to avoid timezone edge cases where --since with
    // a date-only value misses same-day commits. Deduplication later
    // prevents repeated entries.
    const d = new Date(sinceDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    const paddedDate = d.toISOString().split('T')[0];
    gitCmd += ` --since="${paddedDate}"`;
  }

  const raw = execSync(gitCmd, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('|');
      if (parts.length < 3) return null;
      const hash = parts[0];
      const date = parts[1];
      const message = parts.slice(2).join('|');

      // Get changed files for this commit
      let files = '';
      try {
        files = execSync(
          `git diff-tree --no-commit-id --name-only -r ${hash}`,
          {
            encoding: 'utf8',
          }
        ).trim();
      } catch {
        // ignore
      }

      // Get full commit message (subject + body) for the commitMessage field
      let fullMessage = message;
      try {
        fullMessage = execSync(`git log --format="%B" -1 ${hash}`, {
          encoding: 'utf8',
        }).trim();
      } catch {
        // Fall back to subject only
      }

      return { hash, date, message, files, fullMessage };
    })
    .filter(Boolean);
}

/**
 * Filter out commits that are definitely not user-facing.
 * This is a coarse pre-filter to reduce what we send to Claude.
 * @param {Array} commits
 * @returns {Array}
 */
function preFilter(commits) {
  const skipPatterns = [
    /^merge /i,
    /^revert /i,
    /^docs:/i,
    /^chore:/i,
    /^ci:/i,
    /^build:/i,
    /^test[s]?:/i,
    /update changelog/i,
    /^bump.*version/i,
    /format.*prettier/i,
    /fix.*lint/i,
    /fix.*format/i,
    /fix.*prettier/i,
    /fix.*eslint/i,
    /eslint/i,
    /prettier/i,
    /\.md$/i,
    /^trigger ci/i,
    /AGENTS\.md/i,
  ];

  return commits.filter((c) => {
    // Skip commits that only touch non-user-facing files
    const fileList = c.files.split('\n').filter(Boolean);
    const onlyNonUserFacing = fileList.every(
      (f) =>
        f.startsWith('test/') ||
        f.startsWith('scripts/') ||
        f.startsWith('.github/') ||
        f === 'package-lock.json' ||
        f === 'eslint.config.mjs' ||
        f === '.prettierrc' ||
        f === '.gitignore' ||
        f === 'AGENTS.md' ||
        f === 'TESTING.md' ||
        f === 'README.md'
    );
    if (onlyNonUserFacing && fileList.length > 0) return false;

    // Skip by commit message patterns
    return !skipPatterns.some((p) => p.test(c.message));
  });
}

/**
 * Deduplicate new commits against existing changelog entries.
 * @param {Array} commits
 * @param {Array} existingEntries
 * @returns {Array}
 */
function deduplicateCommits(commits, existingEntries) {
  // Build a set of existing descriptions (lowercased) for fuzzy matching
  const existing = new Set(
    existingEntries.map((e) => e.description.toLowerCase())
  );

  return commits.filter((c) => {
    // Don't send commits whose message is already in the changelog verbatim
    return !existing.has(c.message.toLowerCase());
  });
}

/**
 * Call Claude to classify and rewrite commits.
 * @param {Array} commits - Array of { hash, date, message, files, fullMessage }
 * @returns {Promise<Array>} Array of { date, category, description, hash?, commitMessage? }
 */
async function classifyWithClaude(commits) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();

  // Build a lookup so we can attach the hash after Claude responds
  const commitsByIndex = new Map();
  const commitList = commits
    .map((c, i) => {
      commitsByIndex.set(i + 1, c.hash);
      return `${i + 1}. [${c.date}] [hash:${c.hash}] "${c.message}" (files: ${c.files.split('\n').slice(0, 5).join(', ')})`;
    })
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `You are analyzing git commits for a music album list management web app called "SuShe Online". Your job is to identify which commits represent user-facing changes and write brief, friendly changelog descriptions for them.

RULES:
- ONLY include changes that a regular user would notice or care about
- SKIP: refactors, test changes, dependency updates, CI fixes, lint/formatting fixes, code cleanup, documentation updates, developer tooling, internal restructuring
- Each description must be ONE short sentence, max 12 words, written for non-technical users
- Examples of good descriptions: "Added drag-and-drop reordering on mobile", "Faster album cover loading", "Fixed track picks disappearing after refresh"
- Category must be one of: feature, fix, ui, perf, security
- Each commit line includes a [hash:...] tag — copy the hash value into the "hash" field of the output entry
- Return ONLY a JSON array. No markdown, no explanation, no wrapping.
- If NO commits are user-facing, return an empty array: []

COMMITS:
${commitList}

Return a JSON array of objects with "date", "category", "description", and "hash" fields. Only include user-facing changes.`,
      },
    ],
  });

  const text = response.content[0].text.trim();

  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];

    // Validate each entry and ensure hash is present
    return parsed
      .filter(
        (entry) =>
          entry &&
          typeof entry.date === 'string' &&
          typeof entry.description === 'string' &&
          VALID_CATEGORIES.has(entry.category) &&
          entry.description.length >= 5
      )
      .map((entry) => {
        const result = {
          date: entry.date,
          category: entry.category,
          description: entry.description,
        };
        // Include hash and full commit message if available
        if (
          typeof entry.hash === 'string' &&
          /^[0-9a-f]{7,40}$/.test(entry.hash)
        ) {
          result.hash = entry.hash;
          // Find the original commit to get the full message
          const original = commits.find((c) => c.hash === entry.hash);
          if (original && original.fullMessage) {
            result.commitMessage = original.fullMessage;
          }
        }
        return result;
      });
  } catch (e) {
    console.error('Failed to parse Claude response:', e.message);
    console.error('Raw response:', text.slice(0, 500));
    return [];
  }
}

/**
 * Main entry point.
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY not set, skipping changelog generation');
    process.exit(0);
  }

  const existing = readChangelog();
  const lastDate = getLastEntryDate(existing);
  console.log(
    `Last changelog entry: ${lastDate || 'none'} (${existing.length} entries)`
  );

  const allCommits = getNewCommits(lastDate);
  console.log(`Commits since last entry: ${allCommits.length}`);

  if (allCommits.length === 0) {
    console.log('No new commits, nothing to do');
    process.exit(0);
  }

  const filtered = preFilter(allCommits);
  console.log(`After pre-filter: ${filtered.length} potentially user-facing`);

  const deduped = deduplicateCommits(filtered, existing);
  console.log(`After deduplication: ${deduped.length} new candidates`);

  if (deduped.length === 0) {
    console.log('No new user-facing commits found');
    process.exit(0);
  }

  // Send to Claude in batches of 30 to stay within token limits
  const BATCH_SIZE = 30;
  let newEntries = [];

  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE);
    console.log(
      `Classifying batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} commits)...`
    );
    const entries = await classifyWithClaude(batch);
    newEntries = newEntries.concat(entries);
  }

  console.log(`Claude identified ${newEntries.length} user-facing changes`);

  if (newEntries.length === 0) {
    console.log('No user-facing changes in this push');
    process.exit(0);
  }

  if (dryRun) {
    console.log('\n--- DRY RUN ---\n');
    for (const entry of newEntries) {
      console.log(`  [${entry.category}] ${entry.date} - ${entry.description}`);
    }
    process.exit(0);
  }

  // Merge new entries into existing, keeping newest-first order
  const merged = [...newEntries, ...existing].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  fs.writeFileSync(
    CHANGELOG_JSON_PATH,
    JSON.stringify(merged, null, 2) + '\n',
    'utf8'
  );

  console.log(
    `Changelog updated: ${merged.length} total entries (${newEntries.length} new)`
  );
}

main().catch((err) => {
  console.error('Changelog generation failed:', err.message);
  // Don't fail the CI pipeline over changelog issues
  process.exit(0);
});
