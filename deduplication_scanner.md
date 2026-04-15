# Deduplication Scanner Implementation Plan

## Objectives

- Replace pair-by-pair admin duplicate review with a cluster-based workflow.
- Merge album variants into a canonical record with best-available metadata.
- Guarantee no album loss for any user/list when retiring duplicate album IDs.
- Make behavior observable, testable, and deterministic.

## Current State (Baseline)

- Admin scan/review flow is pair-based:
  - Scanner: `services/duplicate-service.js` (`scanDuplicates`)
  - Admin routes: `routes/admin/duplicates.js`
  - Review UI: `src/js/modules/duplicate-review-modal.js`
  - Scan trigger: `src/js/modules/settings-drawer/handlers/audit-handlers.js`
- Merge is transactional but does not fully handle same-list collision semantics.
- UI does not present full duplicate groups (all variants for one album family).
- Route error handling for `TransactionAbort` must align with `statusCode`.

## High-Level Architecture

### 1. Scan Layer

- Keep fuzzy matching core from `utils/fuzzy-match.js`.
- Build duplicate graph (album IDs as nodes, potential duplicate matches as edges).
- Convert graph to connected components (clusters).
- Return paginated cluster summaries + member variants.

### 2. Review Layer (Admin UI)

- Replace pair modal with cluster review modal:
  - View all variants in one cluster.
  - Show suggested canonical variant.
  - Show field-level merge preview.
  - Allow actions: merge variant, mark distinct pair, skip/defer.

### 3. Merge Layer

- Transactional cluster merge service:
  - Select canonical album.
  - Merge metadata from retired variants.
  - Repoint all `list_items` to canonical album.
  - Resolve same-list collisions deterministically.
  - Delete retired album rows.
  - Emit audit event with impact details.

### 4. Safety + Observability

- Dry-run endpoint for merge impact preview.
- Structured logs for scan and merge metrics.
- Enforce post-merge invariants and fail/rollback on violation.

## Detailed Implementation Phases

## Phase 0 - Guardrails and Contracts

### Tasks

- Define canonical merge rules in code-level constants/helpers.
- Define same-list collision rules (position/comments/tracks precedence).
- Normalize API response contracts for scan, dry-run, commit, mark-distinct.
- Fix `TransactionAbort` route handling to use `statusCode` consistently.

### Files

- `routes/admin/duplicates.js`
- `db/transaction.js` (reference only; behavior already established)
- New/updated helper modules under `services/duplicate-*` and/or `utils/*`

### Exit Criteria

- API contracts documented in code comments/types.
- Error statuses propagate correctly for expected failures.

## Phase 1 - Cluster Scanner

### Tasks

- Extend scanning to output clusters instead of only pair list.
- Respect `album_distinct_pairs` exclusions while building edges/clusters.
- Add pagination (`page`, `pageSize`) and stable sort for clusters.
- Include per-cluster metadata:
  - cluster ID
  - candidate count
  - confidence summary
  - suggested canonical ID

### Files

- `services/duplicate-service.js` (or split into scanner module)
- `routes/admin/duplicates.js`

### Exit Criteria

- Scanner returns reproducible cluster output.
- No silent truncation of actionable results.

## Phase 2 - Cluster Review UI

### Tasks

- Replace/expand `duplicate-review-modal` to support cluster mode.
- Render all variants with key metadata quality indicators:
  - cover quality
  - track count/structure
  - text quality/specificity
  - source/reliability hints
- Add actions:
  - choose canonical
  - toggle merge/keep-distinct per variant pair
  - skip/defer cluster
- Add dry-run preview panel:
  - affected users/lists
  - same-list collision count
  - metadata field changes summary

### Files

- `src/js/modules/duplicate-review-modal.js` (or split into cluster modal module)
- `src/js/modules/settings-drawer/handlers/audit-handlers.js`
- `src/js/modules/settings-drawer/renderers/admin-renderer.js` (if UI controls change)

### Exit Criteria

- Admin can resolve a full cluster in one workflow.
- UI clearly shows what will change before commit.

## Phase 3 - Transactional Cluster Merge Engine

### Tasks

- Add service method: `mergeCluster({ canonicalId, retireIds, options })`.
- Implement deterministic metadata merge rules:
  - cover preference
  - release date precision
  - country normalization
  - genre merge
  - tracklist selection/merge
- Repoint `list_items` from retired IDs to canonical ID.
- Implement collision resolver for lists containing multiple retiring variants:
  - select base row (position/created_at)
  - merge comments/track picks
  - remove redundant rows
- Delete retired album rows only after successful remap/collision handling.
- Validate post-merge invariants before commit.

### Files

- `services/duplicate-service.js` (or split into `duplicate-merge-service.js`)
- Potential helper module for list item collision merge logic under `services/list/*`
- `routes/admin/duplicates.js`

### Exit Criteria

- No unique constraint violations during merge.
- No list loses album membership.
- Rollback works on any failure.

## Phase 4 - API Surface and Auditability

### Tasks

- Add/adjust endpoints:
  - `GET /admin/api/scan-duplicates` -> cluster payload
  - `POST /admin/api/merge-cluster/dry-run` -> impact preview
  - `POST /admin/api/merge-cluster` -> transactional commit
  - existing mark-distinct endpoint remains, updated for cluster UX
- Add admin event payload schema for merge audit trail:
  - canonical ID
  - retired IDs
  - affected list IDs/user IDs
  - collision resolutions
  - field-level metadata decisions

### Files

- `routes/admin/duplicates.js`
- `services/duplicate-service.js`

### Exit Criteria

- Endpoints are backward compatible where feasible or versioned if needed.
- Every committed merge emits a complete audit record.

## Phase 5 - Test Coverage

### Unit Tests

- Cluster builder (graph/components).
- Canonical suggestion heuristic.
- Metadata merge strategy per field.
- Same-list collision resolver.
- Distinct-pair exclusion behavior.

### Integration/Service Tests

- Transaction rollback on mid-merge failures.
- Multi-user remap safety.
- Same-list duplicate variants collapse to one row.
- Retired IDs fully removed from `albums` and `list_items` references.

### Frontend Tests

- Audit handler flow with cluster responses.
- Cluster modal actions and dry-run confirmation behavior.

### Candidate Test Files

- `test/duplicate-service.test.js`
- `test/settings-audit-handlers.test.js`
- New tests for cluster UI module if split.

### Exit Criteria

- New behavior covered with deterministic tests.
- Existing dedupe tests continue passing.

## Phase 6 - Rollout Strategy

### Tasks

- Release behind admin feature flag (cluster mode on/off).
- Keep legacy pair mode fallback for one release cycle.
- Run scanner in shadow mode and compare pair vs cluster outcomes.
- Promote cluster mode after stability metrics are acceptable.

### Monitoring Metrics

- Scan: clusters found, average cluster size, exclusions applied.
- Merge: success/failure counts, rollback counts, collision counts.
- Safety: invariant violations (must be zero).

### Exit Criteria

- Cluster mode stable in production admin usage.
- Legacy pair path removed only after confidence period.

## Data and Rule Decisions (To Lock Before Coding)

- Canonical suggestion scoring weights (source trust, metadata completeness, existing references).
- Tracklist merge policy when two lists are similarly complete.
- Comment merge format for conflicting non-empty values.
- Distinct-pair reversibility UX and permissions.

## Definition of Done

- Admin can review and resolve duplicates by cluster.
- Metadata consolidation follows deterministic, documented rules.
- No user/list loses album membership after any merge.
- Same-list collisions are handled without unique index failures.
- Full audit trail exists for every merge action.
- Test suite covers scanner, merge, collision, and UI review flow.
