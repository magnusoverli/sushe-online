# Phase 12 — Findings

**Run:** 2026-05-12  |  **Phase:** 12 — Root docs / leftovers

## Summary
- Total root-level non-standard files reviewed: 6
- Candidates: 6 (CERTAIN: 1, HIGH: 0, MEDIUM: 1, LOW: 1, needs-info: 3)

Confidence distribution rationale: only `nul` is unambiguously a botched-redirect leftover. `.restart-trigger` and `skills-lock.json` are actively used (runtime + tooling). The three planning docs are user-authored artifacts and must not be auto-removed — surfaced as `needs-info` per the audit policy.

| ID | Path | Tracked | Gitignored | Confidence | Recommendation |
|----|------|---------|------------|------------|----------------|
| F-12-1 | [`nul`](../../nul) | no | yes | CERTAIN | remove |
| F-12-2 | [`.restart-trigger`](../../.restart-trigger) | no | yes | LOW | keep |
| F-12-3 | [`skills-lock.json`](../../skills-lock.json) | yes | no | MEDIUM | keep (user judgment) |
| F-12-4 | [`DB_LAYER_UNIFICATION_PLAN.md`](../../DB_LAYER_UNIFICATION_PLAN.md) | yes | no | needs-info | user decides |
| F-12-5 | [`DB_MODERNIZATION_PLAN.tmp.txt`](../../DB_MODERNIZATION_PLAN.tmp.txt) | yes | no | needs-info | user decides |
| F-12-6 | [`DESIGN.md`](../../DESIGN.md) | no | yes | needs-info | user decides |

---

## Findings

### F-12-1 — [`nul`](../../nul)

- **Confidence:** CERTAIN
- **Type:** Leftover / dead file (botched PowerShell or shell redirect)
- **Stated purpose / first 1–2 lines:** none — file contains the error string `ls: cannot access 'mobile/.dockerignore': No such file or directory` (68 bytes total). This is the captured stderr of an `ls` command. `nul` is the Windows reserved device name; redirecting `2>nul` in cmd.exe works, but other shell forms (e.g. `2>./nul` or Git Bash `> nul` from cmd) accidentally create a literal file at this path.
- **Size / mtime:** 68 bytes, 2026-03-18 09:22:24.
- **Last commit:** none — file is untracked.
- **References found:** zero (only `.gitignore:187`, the audit plan, and `utils/maintainability-metrics.js:18` which is a different `skills-lock.json` reference — `nul` itself is referenced nowhere except the audit plan and `.gitignore`).
- **Gitignored:** yes (`.gitignore:187`). **Tracked:** no.
- **Why CERTAIN:** Not tracked, gitignored, never referenced by any code/config/script, contents are clearly accidental stderr capture from an `ls` command that doesn't exist on Windows anyway. The filename `nul` is impossible to access through normal Windows APIs (it's a reserved device), so it can never be intentionally read by code on this OS. The file was created by a botched shell redirect — the audit plan itself flagged this hypothesis.
- **Removal impact:** none. Untracked, unreferenced, inaccessible via normal Windows paths.
- **Removal mechanics caveat:** `Remove-Item .\nul` will fail because `nul` is a reserved device name in PowerShell. Use the extended path syntax: `Remove-Item -LiteralPath '\\?\C:\Users\me513\sushe-online\nul'` or `del \\?\C:\Users\me513\sushe-online\nul` from cmd.exe.
- **Recommendation:** **remove**. Untracked file, no git change required.
- **Verification steps for human reviewer:**
  - Confirm extended-path delete worked: directory listing should no longer show `nul`.
  - Nothing in the repo needs to change (file isn't tracked, not in any build).

---

### F-12-2 — [`.restart-trigger`](../../.restart-trigger)

- **Confidence:** LOW
- **Type:** Dev-workflow runtime artifact (not redundant)
- **Stated purpose / first 1–2 lines:** Contains a single line: `1770480558695` (a Unix epoch ms timestamp).
- **Size / mtime:** 13 bytes, 2026-05-11 12:12:40 (touched this week).
- **Last commit:** none — file is untracked.
- **References found:**
  - `.gitignore:185` — `# Restart trigger file for development (touched to force nodemon restart)`.
  - `services/admin-backup-service.js:434` — `const triggerFile = pathDep.join(__dirname, '../.restart-trigger');` followed by `fsDep.utimesSync(triggerFile, now, now)` / `fsDep.writeFileSync(triggerFile, String(Date.now()))`. The admin backup-restore flow touches this file in `NODE_ENV === 'development'` to force a nodemon restart after a DB restore.
- **Gitignored:** yes (`.gitignore:185`). **Tracked:** no.
- **Why LOW (= do not remove):** The file is the runtime signal of an active dev-mode feature. `services/admin-backup-service.js` actively writes to/touches this path. Deleting the file today would be harmless (the service recreates it), but the path itself is load-bearing — any removal recommendation for the path / cleanup of this mechanism requires a code change in `services/admin-backup-service.js:420-460`.
- **Removal impact:** removing the on-disk file does nothing (the service recreates on next dev-mode restore). Removing the *concept* would require code changes in `admin-backup-service.js` and dropping the `.gitignore` entry — out of scope for a redundancy audit since the feature is active.
- **Recommendation:** **keep**.
- **Verification steps for human reviewer:** none — leave as-is. If the dev-mode restart mechanism is ever replaced (e.g., nodemon swapped for tsx/swc-watch), revisit the code in `admin-backup-service.js:scheduleRestart()` first.

---

### F-12-3 — [`skills-lock.json`](../../skills-lock.json)

- **Confidence:** MEDIUM (leaning keep)
- **Type:** External-tool lockfile (active)
- **Stated purpose / first 1–2 lines:**
  ```json
  { "version": 1, "skills": { "uncodixfy": { "source": "cyxzdev/Uncodixfy", "sourceType": "github", "computedHash": "94a47b0c7cbeb0461bddeb0074ee6b0c2c5d16dc68f4a632e93abda3acd98158" } } }
  ```
  It is the lockfile for installed agent skills under `.agents/skills/`.
- **Size / mtime:** 219 bytes, 2026-03-10 07:41:52.
- **Last commit:** `d1f8467` 2026-03-10 Magnus Øverli — "Add Uncodixfy agent skill for cleaner frontend UI generation".
- **References found:**
  - The corresponding skill files are tracked: `.agents/skills/uncodixfy/SKILL.md`, `.agents/skills/uncodixfy/README.md`, `.agents/skills/uncodixfy/Uncodixfy.md`, plus images under `.agents/skills/uncodixfy/images/`. All tracked in git.
  - `utils/maintainability-metrics.js:18` lists `'skills-lock.json'` in `DEFAULT_IGNORED_PREFIXES` — the maintainability report excludes it from line/complexity scoring (passive reference, not a dependency).
  - No script in `package.json` regenerates it (no `skills`-related npm script).
- **Gitignored:** no. **Tracked:** yes.
- **Why MEDIUM (not CERTAIN to remove):** This is the manifest/lockfile for an installed agent skill (Uncodixfy) used by some external skill-management tool (similar to `package-lock.json` but for AI agent skills). The skill itself is tracked at `.agents/skills/uncodixfy/`. The `version: 1` schema and `computedHash` field are consistent with a tool-managed lockfile. The maintainability metrics file already explicitly ignores it, which suggests an awareness that it's a tool artifact.
- **Removal impact:** if the skill-management tool is still being used and re-runs at any point, it would regenerate this file or report drift. If the tool is no longer used, the file is dead weight (~219 bytes). The user is the only one who knows whether they still use the tool that produced this.
- **Recommendation:** **keep** (no evidence the skill is dead — the `.agents/skills/uncodixfy/` directory it locks against is tracked and present).
- **User question (for the human reviewer):** Are you still using the external skills-management tool that produced this lockfile (the one paired with the `.agents/skills/uncodixfy/` skill installed on 2026-03-10)? If yes → keep. If you no longer run that tool, both `skills-lock.json` and the entire `.agents/skills/uncodixfy/` tree (~4 markdown files + 5 image files) can be considered for a single coordinated removal. Phase 0 already excluded `.agents/` from the audit scope (line 263), so the skill tree was not separately reviewed.

---

### F-12-4 — [`DB_LAYER_UNIFICATION_PLAN.md`](../../DB_LAYER_UNIFICATION_PLAN.md)

- **Confidence:** needs-info (planning artifact — policy: do not auto-remove)
- **Type:** Planning doc (user-authored)
- **Stated purpose / first 1–2 lines:** "# Database Layer Unification Plan" — "Addresses recommendations 1-4 from the DB interaction audit: 1. Unify query paths through a single interface; 2. Preserve root-cause errors in `withTransaction`; 3. Error classifier + targeted retry; 4. Graceful shutdown (harden and verify — already partially implemented)."

  Lists Phase 0 (baseline & safety nets), Phase 1 (preserve root-cause errors in `withTransaction`), and continues with more phases. References a feature branch `db-layer-unification` for the work.
- **Size / mtime:** 13,903 bytes, 2026-05-11 12:41:47 (touched this week).
- **Last commit:** `893bae0` 2026-04-23 Magnus Øverli — "Consolidate shims onto deps.db across services, utils, and routes". Single commit; the file was authored, committed once, and has not been re-committed since.
- **References found:** zero outside `.gitignore`/audit. No other doc, code, or workflow references the filename. The phrase "db-layer-unification" (a feature-branch name mentioned inside this doc) appears nowhere else in the repo, so the feature branch likely never existed or has been merged/deleted.
- **Gitignored:** no. **Tracked:** yes.
- **Working-tree mtime vs git history:** The on-disk mtime is 2026-05-11, but the file's only commit is 2026-04-23. The current mtime probably just reflects checkout/rebase activity in this week, not new content. Confirm with `git diff HEAD -- DB_LAYER_UNIFICATION_PLAN.md` (should be empty if the file matches HEAD).
- **Status signal:** The plan's items 1–4 overlap heavily with work already merged into main: the "DB modernization" stream commits `54828c9..8143c88` (see Phase 0 F-0-1 / F-0-13 note 10) and the companion file `DB_MODERNIZATION_PLAN.tmp.txt` (F-12-5) describe the *completed* execution. Whether `DB_LAYER_UNIFICATION_PLAN.md` covers the same scope or a still-pending different scope is a judgment only the author can make.
- **Recommendation:** **needs-info** — do not remove without user confirmation.
- **User question:** Is `DB_LAYER_UNIFICATION_PLAN.md` (a) the planning doc that was *executed* via the DB-modernization commit stream and is now obsolete, (b) a still-pending plan with work not yet done, or (c) a reference doc you intend to keep regardless? If (a) → safe to remove (git history preserves it); if (b) → keep, and consider moving to `docs/`; if (c) → keep and move to `docs/`.

---

### F-12-5 — [`DB_MODERNIZATION_PLAN.tmp.txt`](../../DB_MODERNIZATION_PLAN.tmp.txt)

- **Confidence:** needs-info (planning artifact — policy: do not auto-remove)
- **Type:** Planning tracker (user-authored, self-described as temporary)
- **Stated purpose / first 1–2 lines:** "Database Modernization Execution Plan (Temporary Tracker). Owner: OpenCode. Date: 2026-04-23". File contains 11 phases (P0–P10), all marked `[x]` complete, plus a detailed commit log of each step in the modernization.
- **Size / mtime:** 5,151 bytes, 2026-05-11 10:54:43.
- **Last commit:** `ad2f557` 2026-04-24 Magnus Øverli — "Record final contract seam cleanup in tracker". The file has a long commit history (20 commits between 2026-04-23 and 2026-04-24) tracking each step of the modernization. After 2026-04-24 it has not been re-committed, which matches the completion of the work stream.
- **References found:** zero outside `.gitignore`/audit. Filename is not referenced from any code/script/workflow.
- **Gitignored:** no. **Tracked:** yes.
- **Strong "leftover" signals:**
  1. Filename literally ends in `.tmp.txt`.
  2. File self-describes as "(Temporary Tracker)" in line 1.
  3. All 11 phases marked `[x]` complete.
  4. No commits since 2026-04-24 — work stream is done (matches Phase 0 F-0-1 note about the merged PRs `#353..#356`).
- **Recommendation:** **needs-info** — do not remove without user confirmation, but signals strongly point to "delete" (file declares itself temporary; work is complete; tracker is obsolete).
- **User question:** This file announces itself as a temporary tracker (`.tmp.txt`) and every phase inside it is checked off. Can it be deleted? Git history retains the full commit log so nothing is lost. If you want the commit-log narrative preserved, the alternative is to move the content into a `docs/history/` archive doc.

---

### F-12-6 — [`DESIGN.md`](../../DESIGN.md)

- **Confidence:** needs-info (planning artifact — policy: do not auto-remove)
- **Type:** Design-system reference doc
- **Stated purpose / first 1–2 lines:** "# Design System Inspired by WIRED" — a detailed visual-design specification (22,765 bytes) describing typography, palette, grid, and components for a redesign inspired by WIRED magazine. Specifies WiredDisplay/BreveText/Apercu/WiredMono fonts, exact palette (`#057dbc` accent, `#1a1a1a` ink, etc.), grid rules, and component styles.
- **Size / mtime:** 22,765 bytes, 2026-04-15 14:04:30.
- **Last commit:** none — file is untracked.
- **References found:**
  - `.gitignore:191` — explicit ignore line.
  - `.gitignore:183` — also ignores a sibling `design_system/` directory (not present on disk; verified by `Get-ChildItem`).
  - No code/CSS/tailwind config references the colors or font names from this doc. The current Tailwind config (`tailwind.config.js`) does not define `WiredDisplay`, `BreveText`, `Apercu`, `WiredMono`, or color tokens `#057dbc` / WIRED-named keys. The doc has not (yet?) been implemented.
- **Gitignored:** yes (`.gitignore:191`). **Tracked:** no.
- **Why needs-info:** The doc is untracked and ignored, so it's clearly the user's personal working file — but it contains substantive design intent. Two plausible interpretations:
  1. It's a draft / future redesign concept the user wants to keep around but not commit to the repo (current behaviour: gitignored).
  2. It's a stale exploration that's no longer being pursued.
- **Removal impact:** none from a build/runtime perspective (untracked, ignored). The only impact is on the user's own working files.
- **Recommendation:** **needs-info** — this is the user's local file; only the user can decide. Strong default is "keep" because it's clearly intentional (the `.gitignore` line is explicit and was added deliberately).
- **User question:** Is `DESIGN.md` an active design-direction document you want to keep in your working tree (current state: gitignored, intentionally local), or is it a stale exploration that can be moved to `plans/` (also gitignored) or deleted? No code action either way — purely your call.

---

## Cross-cutting observations

- **Tracked-but-also-gitignored check:** none. Of the six files, the three gitignored ones (`nul`, `.restart-trigger`, `DESIGN.md`) are all untracked, as expected. No tracked-but-ignored anomaly to flag.
- **`.gitignore` post-removal hygiene:**
  - If `nul` is removed (F-12-1), the `.gitignore:187` entry `nul` becomes orphaned. It can be left in place defensively (cheap, no harm) or removed at the user's option.
  - If `DESIGN.md` is ever removed, `.gitignore:191` becomes orphaned (similar treatment).
  - The `.gitignore:185` entry for `.restart-trigger` must stay regardless — the dev-mode restart flow recreates the file.
- **No removals to record in the decisions log yet** — only `nul` is recommended for removal, and that's the user's choice to action. F-12-3, F-12-4, F-12-5, F-12-6 need user confirmation per the audit's stated policy that "User confirms before any removal" for Phase 12 (audit plan line 37).

## Open questions (consolidated)

1. **Q-12-A (F-12-3):** Is the skills-management tool that produced `skills-lock.json` still in use? If not, both the lockfile and `.agents/skills/uncodixfy/` can be retired together.
2. **Q-12-B (F-12-4):** Is `DB_LAYER_UNIFICATION_PLAN.md` obsolete (executed via the DB-modernization stream), still pending work, or kept as reference?
3. **Q-12-C (F-12-5):** Can `DB_MODERNIZATION_PLAN.tmp.txt` be deleted? Its own filename and `[x]`-completion state suggest yes.
4. **Q-12-D (F-12-6):** Keep or retire `DESIGN.md`? (Local-only file, no repo impact either way.)
