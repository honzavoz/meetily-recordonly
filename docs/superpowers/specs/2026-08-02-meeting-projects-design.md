# Meeting Projects Design

## Goal

Let users organize one meeting under multiple projects while preserving a chronological view of every meeting.

## Navigation and filtering

The sidebar will expose two meeting views and a project list:

```text
Meeting Notes
  All Meetings       26
  Unassigned          3

Projects
  YachtNet           12
  Povolstav           7
  Interní             4
```

`All Meetings` remains the default and lists each meeting once, newest first. `Unassigned` lists meetings without projects. Selecting a project lists its meetings newest first. The active view stays highlighted, and search filters the active view by meeting title, date, and project name.

The existing `Meeting Notes` accordion remains available. The new project navigation must fit the current independent accordion behavior and the collapsed sidebar.

## Assigning projects

The meeting detail header will show project chips below the meeting title. `Add project` opens a searchable combobox that filters existing projects. Selecting a result assigns it immediately. When the typed name does not exist, the combobox offers `Create “Name”` and assigns the new project.

Each chip has a remove action. The meeting row menu in the sidebar also exposes `Add to project…` for quick assignment. One meeting can belong to multiple projects, but its database record, transcript, summary, and recording remain single instances.

The UI updates optimistically. If persistence fails, it restores the previous assignments and shows an error toast.

## Data model

Add two SQLite tables through the existing startup migration mechanism:

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_projects (
  meeting_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (meeting_id, project_id),
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_projects_project_id
  ON meeting_projects(project_id);
```

Normalize names by trimming outer whitespace, collapsing repeated internal whitespace, and applying Unicode-aware lowercase comparison. Preserve the user's display capitalization in `name`. Reject an empty normalized name. Creating an existing normalized name returns the existing project instead of creating a duplicate.

Existing meetings need no data rewrite. After migration they appear in `All Meetings` and `Unassigned`.

## Backend boundaries

Create a focused project repository and Tauri commands for:

- listing projects with meeting counts;
- searching projects by name;
- creating or returning a project by name;
- renaming and deleting a project;
- listing projects assigned to a meeting;
- assigning and removing a meeting-project relation;
- listing meetings for `all`, `unassigned`, or one project.

Deleting a project removes its relations through the foreign key and leaves meetings untouched. Assigning an existing relation succeeds without creating a duplicate. Every write updates the affected project or meeting timestamp where the existing application relies on it for refresh behavior.

Frontend project types and a service wrap the Tauri commands. Sidebar filtering and display formatting stay in pure helpers so unit tests do not need to mount the full sidebar.

## Error handling

- Reject blank names before issuing a write.
- Return the existing project for a case-insensitive normalized-name collision.
- Return a clear not-found error when a meeting or project no longer exists.
- Treat repeated assignment and repeated removal as idempotent operations.
- Roll back optimistic UI updates when a command fails.
- Keep `All Meetings` usable if loading the project list fails; show a toast and allow retry.

## Verification

- Migration test against a database containing existing meetings.
- Repository tests for normalization, duplicate creation, assignment, removal, rename, delete, counts, `all`, `unassigned`, and chronological ordering.
- Frontend helper tests for active-view filtering, search across project names, unique meetings in `All Meetings`, and counts.
- Component-level checks for combobox create/select/remove behavior and optimistic rollback.
- Full frontend tests, Rust tests for the affected database modules, and the production frontend build.
- Manual desktop check of expanded and collapsed sidebar states plus meeting-detail assignment.

## Out of scope

Projects do not have descriptions, colors, permissions, nested subprojects, automatic AI classification, or cross-meeting summaries in this version. The design leaves room to add those features without changing meeting-project relations.
