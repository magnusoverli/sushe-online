# Album Deduplication Fix - Technical Plan

## Implementation Status

| Phase   | Description                   | Status   | Files                                                          |
| ------- | ----------------------------- | -------- | -------------------------------------------------------------- |
| Phase 1 | Fix album insertion logic     | COMPLETE | `utils/album-canonical.js`, `routes/api.js`                    |
| Phase 2 | Migration to clean duplicates | COMPLETE | `db/migrations/migrations/031_deduplicate_canonical_albums.js` |
| Phase 3 | Add database constraint       | COMPLETE | `db/migrations/migrations/032_add_unique_album_constraint.js`  |

### To Deploy

1. **Rebuild and restart the container**:

   ```bash
   docker compose -f docker-compose.local.yml build --no-cache app
   docker compose -f docker-compose.local.yml up -d
   ```

2. **The migrations will run automatically on startup**, or can be run manually:

   ```bash
   docker compose -f docker-compose.local.yml exec app node db/migrations/index.js
   ```

3. **Verify the fix**:
   - Check albums table: should have ~490 albums instead of 702
   - Recompute aggregate list for any year
   - Verify no duplicate albums appear

---

## Problem Statement

The aggregate list shows duplicate albums because the same album (same artist + album name) can exist multiple times in the `albums` table with different `album_id` values or with `NULL` album_id.

### Current State

- **702 albums** in the albums table
- **490 unique** artist/album combinations
- **212 duplicate entries** causing aggregate list problems

### Examples of Duplicates

```
Aara - Eiger (4 entries):
  - album_id: NULL (2 entries)
  - album_id: c98818d1-7605-40b2-b992-d09a51cdef5c (MusicBrainz)
  - album_id: 7JR5ImZkmGHe5wHPLPFDDy (Spotify)

Blood Incantation - Absolute Elsewhere (2 entries)
Guns'n roses - Spaghetti incident (2 entries)
... and 207 more duplicates
```

## Root Cause

**Location**: `routes/api.js` line 119

The `upsertAlbumRecord()` function uses:

```sql
ON CONFLICT (album_id) DO UPDATE ...
```

This only prevents duplicates when `album_id` matches. It does NOT check for duplicate artist/album names.

**Why duplicates occur**:

1. User adds album from Spotify → Creates entry with Spotify ID
2. Another user adds same album from MusicBrainz → Creates NEW entry with MusicBrainz ID
3. Another user adds manually → Creates NEW entry with NULL album_id
4. Result: 3 separate canonical entries for the same album

## The Fix (3-Phase Approach)

### Phase 1: Fix Album Insertion Logic

**Goal**: Ensure only ONE canonical entry per unique artist/album name

**Changes needed in `routes/api.js`**:

1. Before inserting an album, check if an album with the same normalized artist/album already exists:

   ```sql
   SELECT album_id FROM albums
   WHERE LOWER(TRIM(artist)) = LOWER(TRIM($1))
   AND LOWER(TRIM(album)) = LOWER(TRIM($2))
   LIMIT 1
   ```

2. **If exists**:
   - Reuse the existing `album_id`
   - Update metadata if the new data is more complete
   - Return the existing album_id to use in list_items

3. **If new**:
   - Insert as normal
   - Return the new album_id

4. **Handle NULL album_id case**:
   - For manually added albums without external ID, generate a UUID
   - This ensures every album has a usable identifier

**Result**: New albums added going forward will never create duplicates.

### Phase 2: Migration to Clean Up Existing Duplicates

**Goal**: Merge 212 duplicate album entries into single canonical entries

**Migration script logic**:

```
For each group of albums with same normalized artist/album:
  1. Identify all duplicates (same LOWER(artist) and LOWER(album))

  2. Choose the "canonical winner" using this priority:
     - Prefer album with non-NULL album_id
     - Prefer album with most complete metadata (cover_image, genres, tracks)
     - Prefer earliest created_at (oldest entry)

  3. Update all list_items pointing to duplicates:
     UPDATE list_items
     SET album_id = 'winner_id'
     WHERE album_id IN ('duplicate_ids')

  4. Delete the duplicate album records:
     DELETE FROM albums WHERE album_id IN ('duplicate_ids')

  5. Verify: Check that list_items still reference valid albums
```

**Safety measures**:

- Run in transaction (ROLLBACK on error)
- Log all merges for audit trail
- Take database backup before running
- Dry-run mode to preview changes without applying

**Result**: 702 albums → ~490 albums (clean canonical table)

### Phase 3: Add Database Constraint (Future-Proofing)

**Goal**: Prevent future duplicates at database level

**Add unique constraint**:

```sql
CREATE UNIQUE INDEX idx_albums_unique_artist_album
ON albums (LOWER(TRIM(artist)), LOWER(TRIM(album)))
WHERE artist IS NOT NULL AND album IS NOT NULL;
```

This ensures the database itself rejects duplicate artist/album combinations.

**Note**: This constraint must be added AFTER Phase 2 cleanup, otherwise it will fail due to existing duplicates.

### Phase 4: Verify Aggregate List (Optional Simplification)

Once data is clean and insertion logic is fixed:

**Option A (Conservative)**: Keep current aggregate list normalization logic as safety net

**Option B (Simplified)**: Since all albums now have unique album_ids and no duplicates exist:

- Change `buildAlbumMap()` to always group by `album_id`
- Remove normalization fallback logic
- Simpler, faster, more reliable code

## Testing Plan

1. **Unit tests for deduplication logic**:
   - Test finding existing albums by normalized name
   - Test merging albums with different IDs but same name
   - Test handling NULL album_id edge cases

2. **Migration dry-run**:
   - Run migration in test mode
   - Verify it identifies all 212 duplicates
   - Verify no data loss in list_items

3. **Integration test**:
   - After migration, recompute aggregate list for test year
   - Verify no duplicate albums appear
   - Verify point totals are correct (all votes combined)

4. **Manual verification**:
   - Check specific known duplicates (Aara - Eiger, Blood Incantation - Absolute Elsewhere)
   - Verify they appear only once in aggregate list
   - Verify all voters are listed correctly

## Rollback Plan

If something goes wrong:

1. **Before migration**: Database backup exists → restore from backup
2. **During migration**: Transaction fails → automatic ROLLBACK, no changes applied
3. **After migration**: Keep migration log → can manually reverse changes if needed

## Timeline Estimate

- **Phase 1** (Fix insertion logic): 2-3 hours (includes testing)
- **Phase 2** (Migration script): 3-4 hours (includes dry-run testing)
- **Phase 3** (Database constraint): 30 minutes
- **Phase 4** (Aggregate list simplification): 1 hour (optional)

**Total**: 1-2 days of development + testing

## Confirmed Behavior Requirements

Based on user requirements, the fix will implement:

### 1. Album Identity

**Decision**: Same artist + album name = ONE album (regardless of source)

- Spotify, MusicBrainz, Tidal, manual entries are all merged if artist/album match
- Aggregate list shows combined votes from all sources

### 2. Metadata Handling

**Decision**: "Smart merge" - First entry wins, but enhance with better quality data

- First instance added establishes the baseline metadata
- When same album added again with better/additional metadata:
  - Fill in missing fields (if first had no genres, add them from second)
  - Upgrade lower quality data (if second has higher res cover art, use it)
  - Keep existing data if new data is not better
- Example: First has cover art but no genres → Second has genres → Merge to get both

### 3. Per-List Customization

**Decision**: NO customization allowed (except genres were decided to stay canonical)

- Once album exists in canonical table, all users see the same metadata
- No per-list overrides for cover art, release date, country, etc.
- Only track_pick and comments remain per-list customizable
- **Note**: Genres are already canonical (from previous migration 027)

### 4. Manual Albums (album_id = NULL)

**Decision**: Merge with canonical entry

- If manually added album matches existing canonical album → merge them
- Manual entry's metadata contributes to "smart merge" logic
- After merge, reference points to canonical album_id

### 5. Aggregate List Display

**Decision**: 1 album with combined votes (this is the whole point!)

- "Blood Incantation - Absolute Elsewhere" with 3 votes from different sources → 1 entry
- Total points = sum of all votes
- Voter count shows all contributors
- Voters list shows all usernames and their positions

### 6. Implementation Approach

**Decision**: Careful multi-phase approach

- Phase 1: Fix insertion logic (prevent future duplicates)
- Phase 2: Migration to clean existing data (merge 212 duplicates)
- Phase 3: Add database constraints (enforce at DB level)
- Timeline: 1-2 days of careful, tested implementation

## Implementation Details

### Smart Merge Logic for Metadata

When merging albums, priority for each field:

```
album_id: Prefer non-NULL > NULL (always prefer external IDs)
artist: Keep first, fill if empty
album: Keep first, fill if empty
release_date: Keep first, fill if empty
country: Keep first, fill if empty
genre_1: Keep first, fill if empty (already canonical)
genre_2: Keep first, fill if empty (already canonical)
tracks: Keep first, fill if empty
cover_image: Prefer larger file size (higher quality)
cover_image_format: Match the chosen cover_image
summary: Keep first, fill if empty
```

This ensures:

- First entry establishes identity
- Subsequent entries enhance quality
- No data is lost unnecessarily
- Users always see the best available version
