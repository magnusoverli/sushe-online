# Phase 9 — Findings: Legacy markers & commented-out code

**Executed:** 2026-05-13
**Scope:** `*.{js,mjs,ejs,md}` excluding `.claude/`, `node_modules/`, `public/js/bundle.js`, `public/js/chunks/`, `public/styles/output.css`, `playwright-report/`, `test-results/`, `coverage/`, `screenshots/`, `plans/`.

---

## Summary

| Metric | Value |
| ------ | ----- |
| Files swept                                                            | full repo tree per scope above |
| Files containing `TODO`/`FIXME`/`HACK`/`DEPRECATED`/`LEGACY`/`XXX`/`@deprecated` markers (case-insensitive) | **25** (one previously-found file, `scripts/resize-existing-images.js`, was already removed under F-11-1 today) |
| Total marker occurrences                                               | **55** (Phase 0 cited "67 across 26 files" — that count came from the broader `legacy|fallback|backward[- ]compat|compatibility` regex in `utils/maintainability-metrics.js`, which is what `lint:strict --max-legacy-markers` measures, not a literal `TODO/FIXME/HACK` sweep) |
| Category (a) action-item TODO/FIXME/HACK/XXX                           | **0** — there are NO unresolved `TODO`/`FIXME`/`HACK`/`XXX` action items in `*.js`/`*.mjs`/`*.ejs` files. |
| Category (b) stale comments about removed/legacy code (informational)  | 23 of the 55 occurrences — all describe *current behavior* of dual-path code, not dead code |
| Category (c) commented-out code blocks (≥3 consecutive code-like lines) | **0** — see methodology below |
| Category (d) `@deprecated` JSDoc symbols                               | **0** — zero `@deprecated` tags anywhere in the codebase |
| CERTAIN removal candidates                                             | **0** |
| HIGH                                                                    | **0** |
| MEDIUM (cross-phase referral)                                          | **1** (F-9-1) |
| LOW                                                                     | **2** (F-9-2, F-9-3) |

**Headline:** Phase 9 produces **no removal recommendations**. The codebase has no orphaned TODO clusters, no commented-out code blocks meeting the Phase 9 threshold, and no `@deprecated` JSDoc tags. The "legacy" word density that Phase 0 surfaced is overwhelmingly **active documentation of working dual-path code** (BYTEA-vs-TEXT cover images, legacy call signatures still supported), not stale comments preserving dead code.

One referral (F-9-1) for the redundant-code-detector's later phases: `utils/logger.js` retains a no-op compat seam (`writeToFile`, `writeToConsole`, `flushWriteQueue`, `formatMessage`, `writeQueue`, `isWriting`, `flushTimer`, and the `Logger` alias) tested exclusively by a self-referential test block in `test/logger.test.js`. That belongs to Phase 2 (dead exports) and Phase 10 (obsolete tests) — flagged here so it is not lost.

---

## Methodology

1. **Marker sweep:** ripgrep with word-boundary pattern `\b(TODO|FIXME|HACK|DEPRECATED|LEGACY|XXX)\b|@deprecated` (case-insensitive) across `*.{js,mjs,ejs}` and `*.md`. Output: 55 hits across 25 files. Excluded paths: `.claude/`, `node_modules/`, `coverage/`, generated output dirs.
2. **Each hit was read with -C 2 surrounding context** to classify.
3. **Commented-out code detection:** ran three multi-line regexes designed to find ≥3 consecutive `//` lines beginning with JS keywords or ending in `;`/`{`/`}`:
   - `^\s*//\s+(const|let|var|if|for|while|return|await|async|throw|class|require|import|export|function)\s` → 5 hits, all single-line and all confirmed prose, NOT commented-out code (2 hits inside a string-literal migration template in `scripts/migrate.js`, 3 prose comments).
   - Looser multi-line patterns matched JSDoc blocks only — no genuine commented-out code blocks found.
4. **`@deprecated` symbol sweep:** literal `@deprecated` search across all files → 0 code matches (only the audit plan and the agent prompt itself mention the string).
5. **`OLD` standalone marker sweep:** literal `\bOLD\b` (case-sensitive) across `*.{js,mjs,ejs}` → 0 matches.
6. **git history check** on every legacy-marker-bearing file via `git log -1 --format="%ai %s"` to attach a "last touched" timestamp for confidence grading.

---

## Findings

### F-9-1 — `utils/logger.js` retains a no-op legacy compat seam tested only by itself

- **Location:** `utils/logger.js:119-122` (legacy properties), `utils/logger.js:127-139` (`formatMessage`), `utils/logger.js:262-273` (no-op methods), `utils/logger.js:303` (`Logger` alias); tests in `test/logger.test.js:51-90, 266-303`.
- **Type:** Vestigial backward-compat seam + self-referential tests.
- **Confidence:** **MEDIUM** — referral, not a Phase 9 recommendation.
- **Evidence:**
  - Searches performed: `logger\.(writeToFile|writeToConsole|flushWriteQueue|writeQueue|isWriting|flushTimer|formatMessage)|\.Logger\(`.
  - References found: 11 hits, **all inside `test/logger.test.js`** (the assertions ARE "this legacy seam still exists").
  - Dynamic usage check: none plausible — these are plain object method names on the exported logger singleton; no reflection or framework convention uses them.
  - Public API check: `utils/logger.js` exports the default singleton plus `createLogger`, `Logger` alias, `LogLevels`. The `Logger` alias is grep-zero outside its own export line; `createLogger` is the live API used by `test/helpers.js` and test files via `import { createLogger } from '../utils/logger.js'`.
  - Test coverage: 4 tests in `test/logger.test.js` (`Logger.formatMessage should return valid JSON (backward compatibility)`, `Logger.formatMessage should handle all log levels`, `Logger legacy methods should exist for backward compatibility`, `Logger should have writeQueue for backward compatibility`, `Logger.shutdown should clear flushTimer if set`) exist solely to assert the legacy seam.
  - Last touched: `utils/logger.js` last modified 2026-04-23 (JSDoc types refresh); the legacy seam itself was introduced in commit `Upgrade logging to pino + add Prometheus metrics` on 2025-12-31. Seam is >4 months stable.
- **Removal Impact:** Removing the no-op methods + properties + the `Logger` alias would orphan 4-5 tests. Full `node --test test/logger.test.js` would need to drop those test blocks. No production code path calls these methods.
- **Recommendation:** **Defer to Phase 2 (dead exports) + Phase 10 (obsolete tests).** Phase 9's scope is "commented-out code" and "TODO clusters"; this is structurally a dead-export-with-self-referential-test pattern, not a comment artifact. Note here so it is not lost.
- **Verification steps for human reviewer (when Phase 2/10 picks this up):**
  1. Confirm no external consumer of `sushe-online` uses `logger.Logger`, `logger.writeToFile`, `logger.writeToConsole`, `logger.flushWriteQueue`, `logger.formatMessage`, `logger.writeQueue` (sushe-online is a server-only app, not a published library — public-API risk is low).
  2. Confirm `module.exports.Logger = createLogger` is not consumed by any tooling (it isn't — checked).
  3. Decide whether the `formatMessage` method (which is called by 2 tests but does NOT delegate to pino — it just returns a JSON string) has any debugging value worth preserving.

---

### F-9-2 — Test names containing the word "legacy" assert removal-completeness contracts (KEEP)

- **Location:** `test/app-state.test.js` (9 hits), `test/list-data-normalization.test.js` (3 hits), `test/playlist-helpers.test.js` (2 hits), `test/registration-approval.test.js` (3 hits using "legacy" for human-friendly user IDs/test descriptions), `test/factory-compat.test.js:6` ("The legacy `deps.pool` has been retired — factories reject it"), `test/fuzzy-match.test.js:314,318` ("legacy numeric threshold parameter"), `test/app-window-globals.test.js:12` ("registers only legacy shell window bindings"), `test/app-startup-ui.test.js:203` ("cleans up legacy list cache keys safely"), `test/maintainability-metrics.test.js:22,26,85` (tests of the maintainability-metrics module).
- **Type:** Category (b) — stale-sounding but documents intentional preservation/removal contracts.
- **Confidence:** **LOW** (keep) — these tests are the *enforcement mechanism* for "we removed the legacy adapter; assert it stays removed". Removing the tests would re-open the door to silently re-introducing the legacy alias mappings.
- **Evidence:**
  - Searches performed: read each test name and surrounding `it(...)` block.
  - Example: `test/app-state.test.js:83` — `'setLists does not map legacy aliases to canonical fields'` — this test verifies that after the canonical-field refactor (commits in the DB modernization stream, ending 2026-04 per Phase 0 F-0-1), the codebase NO LONGER silently rewrites `comment → comments`, `track_pick → primary_track`, etc. It's a regression guard.
  - Last touched: most of these tests were added/touched in 2026-02 through 2026-04 in the canonical-field/DB-modernization commit stream. They are part of the same effort that REMOVED the legacy code paths they reference.
- **Removal Impact:** N/A — recommendation is keep.
- **Recommendation:** **Preserve.** These are not stale legacy code; they are removal-guard tests.

---

### F-9-3 — Dual-path comments in cover-image handling describe LIVE behavior (KEEP)

- **Locations:**
  - `services/aggregate-list.js:16,23` — `Cover image data (Buffer from BYTEA or legacy string)` + `Handle both BYTEA (Buffer) and legacy TEXT (base64 string) formats`
  - `utils/image-processing.js:60` — `Handles both BYTEA buffers and legacy base64 TEXT columns`
  - `db/migrations/migrations/042_simplify_list_items_table.js:20` — describes `track_pick` as the legacy column the migration drops
  - `db/migrations/migrations/046_optimize_album_upsert.js:37` — `For albums WITHOUT external album_id (user-added or legacy)`
  - `db/migrations/migrations/029_remove_legacy_summary_columns.js:4,14,30,34,50` — the migration's own name and log messages
  - `utils/fuzzy-match.js:272` — `Support legacy call signature: isPotentialDuplicate(a, b, 0.2)`
  - `scripts/ci-changelog.js:216,246` — `Backward-compat fallback for legacy entries without hash`
  - `test/admin-events.test.js:60`, `test/registration-approval.test.js:61` — `SELECT pending events (explicit column list or legacy SELECT *)` documents that the mock accepts both shapes
  - `src/js/modules/app-window-globals.js:2` — `Registers app-wide window globals for legacy integration points.`
  - `test/helpers.js:29,56` — `mock datastore/pool that satisfies BOTH the legacy pg-pool surface (query/connect) and the canonical datastore surface`
  - `test/factory-compat.test.js:6` — referenced in F-9-2
  - `scripts/maintainability-report.js:41,62,116`, `utils/maintainability-metrics.js:180` — these are the CLI flag names / report labels for the `--max-legacy-markers` lint, not legacy code itself
- **Type:** Category (b) — informational comments about active dual-path code, migration history, or product-level legacy-data handling.
- **Confidence:** **LOW** (keep).
- **Evidence:** Every cited line was read in context. In every case the comment annotates code that is **currently executed** — fuzzy-match still accepts the 3-arg signature, image handlers still tolerate base64 text columns from older rows, migration logs still narrate the migration they perform.
- **Recommendation:** **Preserve.** These comments serve their stated purpose: telling the next maintainer why dual-path / branching code exists.

---

## What was checked and found NEGATIVE

The following sweeps returned zero genuine findings; recording them so future runs do not re-scan.

1. **Multi-line commented-out JS code blocks (≥3 consecutive `//` lines beginning with JS keywords or ending `;`/`{`/`}`)**: 5 hits, all confirmed false positives (2 inside a template literal in `scripts/migrate.js:106,114`; 3 prose comments in `test/external-identity-service.test.js:12`, `test/e2e/track-play-links.spec.js:55`, `test/e2e/api-contracts.spec.js:64`).
2. **`/* ... */` block-commented code:** matches were exclusively JSDoc, not commented-out code.
3. **`@deprecated` JSDoc tag:** zero occurrences in the entire codebase (`.js`/`.mjs`/`.ejs`).
4. **Standalone `OLD` marker (case-sensitive):** zero occurrences.
5. **`scripts/resize-existing-images.js` legacy markers**: file was already removed today under Phase 11 finding F-11-1, but stale ripgrep cache may surface it. Confirmed via `Test-Path` that the file does not exist on disk.

---

## Cross-phase referrals

- **F-9-1 → Phase 2 (dead exports) + Phase 10 (obsolete tests):** `utils/logger.js` legacy compat seam + tests. Detail above. Will not be re-litigated in Phase 9.
- **`eslint.config.mjs` "temporary workaround" header:** already documented as a Phase 11 finding (and was logged as `needs-info` in the Phase 11 report — revisit when upstream `eslint-plugin-security` issue #185 ships). Not re-flagged here.

---

## Safety recommendations

Phase 9 has no removals to perform, so the usual safety checklist (`lint:strict` before/after, full test suite, staged commits) does not apply at this stage. When Phase 2/10 pick up F-9-1, standard removal protocol applies:

1. Remove the no-op methods and properties from `utils/logger.js` in one atomic commit.
2. Remove the four corresponding test blocks from `test/logger.test.js` in the SAME commit (otherwise tests will fail).
3. Run `npm run lint:strict` and the full Node `--test` + Playwright suites.
4. Verify no `npm run report:maintainability` regression (the legacy-marker count will decrease slightly — that is intentional).
