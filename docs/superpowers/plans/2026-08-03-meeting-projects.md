# Meeting Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent many-to-many meeting projects with All Meetings, Unassigned, project filtering/search, inline project creation, and optimistic assignment UI.

**Architecture:** SQLite owns projects and meeting-project relations through a focused Rust repository exposed by Tauri commands. A typed frontend service and pure filtering helpers feed project state in `SidebarProvider`; reusable assignment controls render in meeting detail and sidebar rows. Existing meetings remain untouched and therefore initially appear in both All Meetings and Unassigned.

**Tech Stack:** SQLite/sqlx migrations, Rust/Tauri, React/TypeScript, Radix UI, Bun-style unit tests plus Node-compatible focused tests, Next.js production build.

---

### Task 1: Project schema and repository

**Files:**
- Create: `frontend/src-tauri/migrations/20260803000000_add_meeting_projects.sql`
- Create: `frontend/src-tauri/src/database/repositories/project.rs`
- Modify: `frontend/src-tauri/src/database/repositories/mod.rs`
- Modify: `frontend/src-tauri/src/database/models.rs`

- [ ] Write repository tests using an in-memory SQLite pool migrated with `sqlx::migrate!`.
- [ ] Verify RED for normalization, duplicate creation, assignment/removal, rename/delete, counts, all/unassigned/project filters, and newest-first ordering.
- [ ] Add `projects` and `meeting_projects` tables, relation index, foreign keys, and model structs `ProjectModel`, `ProjectWithCount`, and `MeetingWithProjects`.
- [ ] Implement `normalize_project_name` by trim, whitespace collapse, and Unicode lowercase; reject blank names.
- [ ] Implement `ProjectRepository::{list,search,create_or_get,rename,delete,list_for_meeting,assign,remove,list_meetings}` with idempotent relations and clear not-found errors.
- [ ] Update `projects.updated_at` and `meetings.updated_at` after relation writes.
- [ ] Run repository tests and `cargo fmt --check`; commit `feat: add meeting project repository`.

### Task 2: Tauri project API

**Files:**
- Modify: `frontend/src-tauri/src/api/api.rs`
- Modify: `frontend/src-tauri/src/lib.rs`

- [ ] Add serializable request/response types and commands:
  `api_list_projects`, `api_search_projects`, `api_create_project`, `api_rename_project`, `api_delete_project`, `api_get_meeting_projects`, `api_assign_meeting_project`, `api_remove_meeting_project`, and `api_list_project_meetings`.
- [ ] Validate blank input before repository writes and map `RowNotFound` to readable meeting/project errors.
- [ ] Register every command in `tauri::generate_handler!`.
- [ ] Add/extend Rust command tests where mapping behavior is not already covered by repository tests.
- [ ] Run affected Rust tests and commit `feat: expose meeting project commands`.

### Task 3: Frontend domain and filtering helpers

**Files:**
- Create: `frontend/src/types/projects.ts`
- Create: `frontend/src/services/projectService.ts`
- Create: `frontend/src/lib/meeting-projects.ts`
- Create: `frontend/tests/lib/meeting-projects.test.mjs`

- [ ] Write failing Node tests for `all`, `unassigned`, one-project filtering, unique All Meetings rows, chronological ordering, project-name search, and view counts.
- [ ] Implement `Project`, `MeetingProjectView`, and `ProjectMeeting` types with snake_case-to-camelCase mapping isolated in `projectService`.
- [ ] Wrap all project Tauri commands and reject blank create/rename calls before `invoke`.
- [ ] Implement pure helpers `filterMeetingsForProjectView`, `searchProjectMeetings`, `sortMeetingsNewestFirst`, and `getProjectViewCount`.
- [ ] Run focused tests and commit `feat: add frontend project domain`.

### Task 4: Shared project state

**Files:**
- Modify: `frontend/src/components/Sidebar/SidebarProvider.tsx`
- Modify: `frontend/src/components/Sidebar/index.tsx`

- [ ] Extend `CurrentMeeting` with `projects: Project[]` and add provider state for projects, active view (`all`, `unassigned`, or project id), loading/error, and retry.
- [ ] Load meetings with their projects and load project counts independently; project load failure must preserve All Meetings and show a retryable toast.
- [ ] Expose optimistic `assignProject`, `removeProject`, `createAndAssignProject`, `renameProject`, and `deleteProject` actions with rollback and `refetchMeetings` reconciliation.
- [ ] Keep existing recording/transcription behavior and independent accordion persistence unchanged.
- [ ] Run frontend focused tests and production build; commit `feat: add meeting project state`.

### Task 5: Sidebar project navigation and quick assignment

**Files:**
- Modify: `frontend/src/components/Sidebar/index.tsx`
- Create: `frontend/src/components/Projects/ProjectPicker.tsx`
- Create: `frontend/src/components/Projects/ProjectChips.tsx`
- Create: `frontend/src/components/Projects/ProjectSidebarNavigation.tsx`
- Create: `frontend/tests/lib/project-picker-state.test.mjs`

- [ ] Add failing tests for picker result filtering, exact normalized match, create offer, select, remove, and optimistic rollback state.
- [ ] Build a searchable accessible combobox that selects an existing project or offers `Create “name”`; blank input never creates.
- [ ] Render `All Meetings`, `Unassigned`, and Projects with counts and active styling under Meeting Notes; default to All Meetings.
- [ ] Filter the row list by active view, then search title/date/project names; each meeting appears once in All Meetings and is newest first.
- [ ] Add row action `Add to project…`; in collapsed mode retain the existing icon rail and expose project navigation after expansion.
- [ ] Add project rename/delete controls with confirmation; deleting a project must not delete meetings.
- [ ] Run focused tests and production build; commit `feat: add project sidebar navigation`.

### Task 6: Meeting-detail assignment

**Files:**
- Modify: `frontend/src/app/meeting-details/page-content.tsx`
- Modify: `frontend/src/components/MeetingDetails/SummaryPanel.tsx`
- Reuse: `frontend/src/components/Projects/ProjectPicker.tsx`
- Reuse: `frontend/src/components/Projects/ProjectChips.tsx`

- [ ] Pass current meeting projects and provider actions into `SummaryPanel`.
- [ ] Render project chips directly below the editable meeting title and an `Add project` combobox.
- [ ] Remove chips optimistically; restore on persistence failure and show an error toast.
- [ ] Ensure assignments update sidebar counts/filtering without navigation or duplicated meeting records.
- [ ] Run picker/helper tests and production build; commit `feat: assign projects from meeting details`.

### Task 7: Full verification and desktop UX

**Files:**
- Modify only if verification exposes defects.

- [ ] Run migration/repository Rust tests, all available frontend tests, project-focused Node tests, version/release preflights, and `pnpm build`.
- [ ] Run `cargo fmt --check`, `cargo check`, `shellcheck`, YAML parsing, and `git diff --check` where toolchains are available.
- [ ] Build/install an unsigned arm64 app through the updated GitHub workflow.
- [ ] In the desktop app verify: existing meetings in All and Unassigned; create YachtNet inline; assign one meeting to YachtNet plus a second project; remove one; search by project name; project and unassigned counts; newest-first ordering; expanded/collapsed sidebar; state persists after relaunch.
- [ ] Verify deleting a disposable test project leaves the meeting and data intact.
- [ ] Review requirement-by-requirement against `docs/superpowers/specs/2026-08-02-meeting-projects-design.md`, preserve unrelated data, and only then merge/push and mark the goal complete.
