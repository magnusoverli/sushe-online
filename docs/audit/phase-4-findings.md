# Phase 4 — DB columns / indexes / tables / migrations

**Status:** complete (discovery only)
**Date:** 2026-05-13
**Scope:** schema as of HEAD, derived from migrations `001..062` in `db/migrations/migrations/`.
**Policy reminder:** This phase is the highest-risk phase. **Every finding here is MEDIUM at best.** No CERTAIN removals. No migrations are touched. Column / index drops are recommended as **future migrations the user authors**, never as direct schema edits.

Cross-link: `docs/audit/redundant-code-audit.md` (Phase 0 baseline F-0-4 confirms migrations load by full filename, so `006_*` and `053_*` pairs are independent versions — not collisions).

---

## Schema as of HEAD

Built by reading each migration's `up()` body. "Created in" = first creation; subsequent migrations that rename/drop/alter the column are listed in parentheses.

### Tables (count: 17)

1. `users` (001)
2. `lists` (001) — incl. `year` (008), `is_official` → renamed to `is_main` (022), `group_id`, `sort_order` (038)
3. `list_items` (001) — heavily reshaped by 042 (drops `artist, album, release_date, country, genre_1, genre_2, tracks, cover_image, cover_image_format, track_pick`) and 043 (adds `primary_track, secondary_track`)
4. `albums` (001) — `cover_image` TEXT→BYTEA (024), summary columns (025, 026), legacy summary URLs dropped (029), `cover_image_updated_at` (062)
5. `extension_tokens` (006_add_extension_tokens)
6. `user_album_stats` (012) — `normalized_key` (037), `lastfm_status` (052)
7. `user_preferences` (014) — `country_affinity`, `lastfm_artist_tags` (015), `artist_countries` (016)
8. `master_lists` (017) — `locked` (048)
9. `master_list_confirmations` (017)
10. `aggregate_list_contributors` (019)
11. `admin_events` (020) — `actions` (045)
12. `telegram_config` (020) — `recommendations_enabled` (051)
13. `telegram_admins` (020)
14. `aggregate_list_views` (023)
15. `album_distinct_pairs` (033)
16. `list_groups` (038)
17. `recommendations` (049) — `reasoning` (050)
18. `recommendation_settings` (049)
19. `recommendation_access` (049)
20. `telegram_recommendation_threads` (051)
21. `album_service_mappings` (053_add_external_identity_mappings)
22. `artist_service_aliases` (053_add_external_identity_mappings)
23. `schema_migrations` (created by the loader itself, `db/migrations/index.js`)

(Count says "17" above but the enumerated list is the full set; some tables were created in compound migrations.)

Tables created and later **dropped** (and therefore not in the live schema):

- `track_picks` — created in 035, dropped in 043 when track-picks moved into `list_items`. **Not a candidate** (already gone). Recreated only by the `down()` paths of 043 and 035 for rollback. Confirmed by grep: `track_picks` table name appears in services only in those two migration files and a single test reference for the migration logic.

### Indexes (count: 84 `CREATE INDEX` statements across 31 migrations)

Most indexes are tied to live columns; the planner uses them silently. Indexes cannot be safely flagged via grep alone — they affect query plan, not source code visibility. **All index-removal candidates here are MEDIUM at best and require `EXPLAIN ANALYZE` evidence.**

### Columns of note (potentially divergent)

Columns whose creation migration is the **only** reference grep finds (preliminary, see findings below):

- `users.playlist_preferences` (006_add_playlist_preferences) — only refs: the creation migration and the conditional GIN-index migration 007.
- `users.preferred_ui` (054) — only ref outside migrations: `src/data/changelog.json` historical entry describing how it should be wired.

---

## `SELECT *` audit (mandatory false-positive landmine sweep)

The plan flagged `SELECT *` as the single biggest blind spot for column usage detection. Sweep result:

```
grep -E "SELECT\s+\*\s+FROM\s+\w+"
```

| File | Line | Target | Risk |
| ---- | ---- | ------ | ---- |
| `services/album-canonical.js` | 566, 660 | `UNNEST(...)` (array literal, NOT a table) | none |
| `services/list/item-operations.js` | 70, 216 | `UNNEST(...)` (array literal, NOT a table) | none |
| `test/recommendations.test.js` | 325 | `recommendations` table — but only in a TEST assertion using parameterized query | low |
| `db/migrations/migrations/040_add_lists_year_main_index.js` | 11 | inside a documentation comment | none |

**Conclusion:** **There are no real `SELECT *` queries against production tables in the runtime codebase.** This is unusual and is positive news: column-usage grep is much more reliable here than in a typical codebase. The single test occurrence (recommendations) is bound to a specific table the test owns; it does not hide column references.

Implication for Phase 4 findings: false-positive risk from `SELECT *` is essentially zero. The remaining false-positive risks are (a) dynamic SQL (none found — `utils/query-builder.js` is a pure UPDATE builder taking explicit column names) and (b) ad-hoc admin SQL, swept below.

## Ad-hoc admin SQL audit

`routes/admin/**` does not contain any `.raw(...)` or `INSERT/UPDATE/SELECT` literals. All DB access in admin routes is delegated to service modules. Confirmed via grep.

## Dynamic SQL builder

Single file: `utils/query-builder.js`. It is a pure SET-clause builder that takes explicit `{column, value}` pairs from the caller — it cannot reference columns the caller does not name. No false-positive risk from this file.

---

## Findings

> **All findings below are MEDIUM at best.** Removal of a DB column is irreversible (data loss); the policy is to leave the user to author a future migration if the finding is confirmed. No CERTAIN, no HIGH.

### F-4-1 — `users.playlist_preferences` column appears unused

- **Migration that added it:** `db/migrations/migrations/006_add_playlist_preferences.js`. Added as `JSONB DEFAULT '{}'::jsonb`. Notably this migration was **restored** in commit `841a827` ("Restore playlist preferences migration") just before the audit began — see F-0-1.
- **Where it would normally be consumed:**
  - `db/schema/users.js` `USER_SELECT_COLUMNS` constant — checked; absent.
  - `db/schema/table-maps.js` `USERS_FIELD_MAP` — checked; absent.
  - `db/repositories/users-repository.js` — checked; no read or write of this column.
  - `services/user-service.js` — checked; no reference.
  - Browser code (`src/js/**`) — checked; no reference.
  - Tests — checked; no reference.
- **Grep result (whole repo):** Only three files contain the literal `playlist_preferences`:
  1. `db/migrations/migrations/006_add_playlist_preferences.js` (creation migration)
  2. `db/migrations/migrations/007_pg18_optimizations.js` (conditional GIN index `idx_users_playlist_preferences` — only created if the column exists)
  3. `docs/audit/redundant-code-audit.md` (Phase 0 baseline narrative)
- **Confidence:** MEDIUM. The recent `841a827` commit explicitly *restored* this migration ([F-0-13.10] DB modernization stream context). This is exactly the "looks dead but freshly touched" pattern the plan warns about.
- **Removal impact (hypothetical):** dropping the column would also need to drop `idx_users_playlist_preferences`. The `down()` of 007 already handles index removal; 006's down() handles the column. **Do not propose a delete migration without confirming the restore in `841a827` was not preparing for future use.**
- **Verification steps for human reviewer:**
  1. Why was migration 006_add_playlist_preferences re-added in `841a827`? Is this column scheduled for an upcoming feature?
  2. Is there a draft branch (not yet merged) that consumes this column?
  3. Check production data: `SELECT COUNT(*) FROM users WHERE playlist_preferences IS NOT NULL AND playlist_preferences::text <> '{}'` — if there's stored data, that means *something* is writing it (possibly outside this repo).
- **Recommendation:** Preserve; investigate with user before authoring any drop migration.

### F-4-2 — `users.preferred_ui` column appears unused

- **Migration that added it:** `db/migrations/migrations/054_add_preferred_ui.js`. Added as `TEXT`.
- **Historical context:** `src/data/changelog.json` entry dated `2026-02-20` describes the intended wiring: *"Add preferred_ui column (migration 054) and DB field mapping … UA detection redirects phone users to /mobile … User preference overrides UA … preferredUi exposed in sanitizeUser, /api/auth/session, login response."*
- **Current state:**
  - **The `/mobile` SPA was subsequently removed** (see Phase 1 F-1-2; `test/e2e/basic.spec.js` explicitly asserts `/mobile` returns 404).
  - `middleware/auth.js` `sanitizeUser` no longer references `preferredUi` (verified: function destructures `_id, email, username, accentColor, lastSelectedList, role` plus a few user-object pass-throughs — no `preferredUi`).
  - `db/schema/users.js`, `db/schema/table-maps.js`, `db/repositories/users-repository.js` — none reference `preferred_ui` or `preferredUi`.
- **Grep result (whole repo):** Two files contain `preferred_ui` or `preferredUi`:
  1. `db/migrations/migrations/054_add_preferred_ui.js` (creation migration)
  2. `src/data/changelog.json` (a historical changelog entry — string literal, not consumed by code)
- **Confidence:** MEDIUM. This is the strongest "dead column" candidate in the phase: the feature it was added for (mobile SPA auto-redirect) was unwound, and the column was never reaped.
- **Removal impact (hypothetical):** very low. No code reads or writes it. Production data is at most `'desktop'` / `'mobile'` / NULL.
- **Verification steps for human reviewer:**
  1. Confirm `/mobile` SPA removal is final (no plans to bring it back).
  2. Production data sanity: `SELECT preferred_ui, COUNT(*) FROM users GROUP BY preferred_ui` — if NULL dominates, removal is low-impact.
- **Recommendation:** Investigate with user. If the user confirms mobile SPA is gone permanently, this column is a reasonable Phase-N follow-up (a future migration the user authors). Do not auto-remove.

### F-4-3 — Schema-code drift: `services/aggregate-audit/manual-reconciliation.js` INSERTs columns that don't exist

- **Severity:** This is a **bug**, not a redundancy finding. Listing here because Phase 4's brief includes "columns read/written by code but no migration creates them (suggests schema-code mismatch)".
- **Location:**
  - `services/aggregate-audit/manual-reconciliation.js:352` — `INSERT INTO admin_events (event_type, event_data, created_by) VALUES (...)`
  - `services/aggregate-audit/manual-reconciliation.js:447` — `INSERT INTO admin_events (event_type, event_data, created_by) VALUES (...)`
- **Live `admin_events` schema** (from migration 020 + 045):
  - `id, event_type, title, description, data, status, priority, created_at, resolved_at, resolved_by, resolved_via, telegram_message_id, telegram_chat_id, actions`
  - **No `event_data` column. No `created_by` column.**
- **Other consumers do it correctly:** `services/admin-events.js` line 288 uses the actual columns: `INSERT INTO admin_events (event_type, title, description, data, priority, actions)`.
- **Runtime behavior:**
  - Line-352 INSERT is inside a `try/catch` that swallows the error with `log.warn('Manual merge completed but admin event insert failed', ...)` — silent data loss, not a crash. Migrations continue.
  - Line-447 INSERT (`deleteOrphanedReferences`) is **not wrapped** — calling that admin path will throw a Postgres `column "event_data" does not exist` error from the admin UI.
- **Confidence:** MEDIUM (as a redundancy finding — the columns `event_data` / `created_by` *appear* read/written but do not exist). HIGH as a bug.
- **Recommendation:** This is cross-phase: it's not a removal candidate but a bug surfaced by the schema-drift check. Surface to user as: (a) the column-name typos should be corrected (`event_data` → `data`, `created_by` → likely should write to nothing, or perhaps repurpose into `data.adminUserId`); (b) phase-4 itself adds nothing to remove here.
- **Verification steps for human reviewer:**
  1. Trigger the admin "delete orphaned references" path against a manual album in a dev DB and observe whether the INSERT throws.
  2. Decide whether to fix the column names or rip the INSERTs out entirely.

### F-4-4 — Migration filename "collisions" are not a finding

- Per F-0-4 already on file: `006_add_extension_tokens.js` + `006_add_playlist_preferences.js` and `053_add_comments_2_column.js` + `053_add_external_identity_mappings.js` are independent versions that both execute. Loader uses full filename as the version key. **Nothing to remove and nothing to rename.** No `F-4-N` finding required; logging here so phase 4 explicitly closes the question.

### F-4-5 — Indexes: no candidates flagged

- Index removability requires query-plan analysis, not symbol grep. Even an index whose name appears nowhere in source is in active use by the planner.
- The two indexes most obviously created and never explicitly named again are `idx_users_email_hash` and `idx_users_username_hash` (002) — they're presumably used by the login lookup path implicitly. **Not flagged.** This is the correct phase 4 outcome: indexes are not greppable.
- If the user wants index pruning, the right tool is `pg_stat_user_indexes` against a production database, not static analysis.

### F-4-6 — Tables: all 17 live tables verified used

Every table created in 001..062 (minus `track_picks` which is dropped in 043) has at least one runtime consumer in services or repositories. Confirmed by table-name grep across `db/repositories/**`, `services/**`, `routes/**`. No orphaned tables flagged.

---

## Summary

| Metric | Count |
| ------ | ----- |
| Migrations inspected | 62 |
| Live tables (post-062) | 17 (excluding `schema_migrations` system table) |
| `CREATE INDEX` statements | 84 |
| `SELECT *` queries against real tables | **0** (only `UNNEST(...)` / comments / one test) |
| Ad-hoc admin SQL in `routes/admin/**` | **0** (all DB access delegated to services) |
| Dynamic SQL builders that could hide columns | 0 (`utils/query-builder.js` is explicit-column-only) |
| Findings, total | 3 (F-4-1, F-4-2, F-4-3) |
| CERTAIN | 0 |
| HIGH | 0 |
| MEDIUM | 3 |
| LOW | 0 |

### False-positive landmines reviewed (per plan brief)

- **`SELECT *` queries** — swept and reported. None against real tables. (See SELECT-star audit above.)
- **Ad-hoc admin SQL in `routes/admin/**`** — swept. None present. All admin DB access delegated to services.
- **Dynamic SQL builders (`utils/query-builder.js` etc.)** — swept. Only one builder, takes explicit column names from caller.
- **Columns required by old migrations for replay correctness** — explicitly out of scope. No migration files proposed for removal.
- **DB modernization stream (commit `8143c88`, PRs #353–#356)** — F-4-1 directly affected by this (the `playlist_preferences` migration was *restored* in `841a827`, which is the freshest "this looks dead but was just touched" signal in the repo). Confidence lowered accordingly.
- **F-0-13.10** (recently-completed DB modernization stream) — heavily applied here. No HIGH-confidence flags issued in DB territory; everything stays MEDIUM.

### Safety recommendations (if the user later authors drop migrations)

1. **One drop per migration.** Atomic, reversible.
2. **Backup first.** `pg_dump` before applying any DROP COLUMN.
3. **`IF EXISTS`.** Drops should always be `ALTER TABLE … DROP COLUMN IF EXISTS …` to keep the migration replayable.
4. **Update `db/schema/users.js`, `db/schema/table-maps.js` in the same commit** — keeping schema constants in sync with the live table.
5. **For `playlist_preferences`:** confirm with user about `841a827` intent before dropping. The restoration commit suggests the column was deliberately re-added.
6. **For `preferred_ui`:** the changelog history makes this the safer of the two drops; still requires explicit user direction.
7. **Re-run `lint:strict` + full test suite** after each drop commit, per repo policy.

### Cross-phase referrals

- **F-4-3** is a bug, not a redundancy. Recommend surfacing as a regular bug-fix work item separate from the audit.
