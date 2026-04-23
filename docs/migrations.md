# Database Migrations — Operator Guide

This doc codifies the rules that keep existing deployments upgradable without
data loss. It covers what the runner guarantees, how to write new migrations
safely, and what "irreversible" means in practice.

## What the runner guarantees

- **Concurrent pods are safe.** `runMigrations()` acquires a Postgres advisory
  lock before looking at pending migrations. If two processes start at the
  same time, the loser blocks until the leader finishes, then sees zero
  pending migrations and returns cleanly. No duplicate-key violations, no
  partial state.
- **Forward-schema guard.** Before running anything, the runner compares the
  versions recorded in `schema_migrations` against the files on disk. If the
  database knows versions the current code does not, the process refuses to
  start with a clear error. This prevents a rolled-back deployment from
  silently operating against a DB that was already migrated forward.
- **Every migration is transactional.** `up()` runs under a single pg client
  inside `BEGIN/COMMIT`. A failure rolls back both the schema change and the
  `schema_migrations` insert — there is no half-applied state.
- **Idempotent baseline.** Migrations use `CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`, and `CREATE INDEX IF NOT EXISTS` so re-running
  the runner against a current DB is a no-op. `ensureTables()` in
  [db/index.js](../db/index.js) applies the same rule at startup.

## Writing a new migration

`npm run migrate:create my_change` scaffolds a file under
`db/migrations/migrations/` with an `up()` and a `down()`. Fill them in.

### Expand/contract for destructive changes

Never rename, drop, or re-type a column with data in a single release.
Split into two releases:

1. **Expand** (release N): add the new column / table. Populate it.
   The code still reads and writes the old column; the migration is purely
   additive and fully reversible.
2. **Contract** (release N+1, after N is fully deployed): switch the code
   to read only the new column, then in a second migration drop the old one
   and mark it `irreversible: true`.

During the N→N+1 window, the app tolerates both shapes. This is the only
pattern that keeps *any* past deployment upgradable without data loss.

### Version numbering

Migrations are executed in filename-sorted order and tracked by filename
(minus `.js`) in the `schema_migrations.version` column. Numbering is
append-only — never rewrite a committed migration file (the checksum
would mismatch, and rollouts mid-deploy would diverge).

## The `irreversible: true` convention

Some migrations cannot be auto-rolled back without losing data — row
deduplication, lossy column type conversion, data merges. Mark those
explicitly:

```js
module.exports = {
  up: async (pool) => { /* ... */ },
  down: async () => {
    // Optional — used only as documentation; the runner refuses to call it.
  },
  irreversible: true,
};
```

When `irreversible: true`, `npm run migrate:down` fails with a clear
message directing the operator to restore from backup. Preserves data,
avoids silent-no-op drift, makes the intent visible at read time.

## Version-compatibility window

The deployment contract for existing instances:

- **App version N+1 can boot against a DB last touched by N or N+1.**
- Upgrading across more than one version at a time is unsupported without
  a staged rollout.
- Downgrade (N+1 → N) requires first rolling the database back to the N
  state — the forward-schema guard blocks N from starting against an
  N+1 database.

## Big-table safety

For tables that may be large in production (`albums`, `list_items`,
`user_album_stats`):

- Prefer `ADD COLUMN` with a default in a separate `UPDATE` step; avoid
  `ALTER COLUMN TYPE` that rewrites the whole table in a single lock.
- Never `ADD COLUMN NOT NULL` in one step on a large table — add nullable,
  backfill, then add the `NOT NULL` constraint later.
- Test with production-scale synthetic data before deploying.

## Operator commands

- `npm run migrate` (alias: `npm run migrate:up`): advance the schema.
- `npm run migrate:down`: roll back the most-recently-executed migration.
  Fails cleanly if that migration is marked irreversible.
- `npm run migrate:status`: list every migration and whether it's executed.
- `npm run migrate:create <name>`: scaffold a new migration.

## When the forward-schema guard fires

Error looks like:

```
Database has migrations unknown to this code version:
080_some_new_thing, 081_another. Deploy a newer build that
includes these migrations, or roll the database back before
starting this version.
```

**What to do:** either deploy the newer code, or — if you truly need
to roll the schema back — `npm run migrate:down` repeatedly until the
unknown versions are gone, then start the older build. If any of those
migrations are `irreversible`, you cannot roll back without restoring
from a backup.
