#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="$repo_root/frontend/src-tauri/migrations/20260803000000_add_meeting_projects.sql"
database="$(mktemp /private/tmp/meetily-project-migration.XXXXXX.sqlite)"
trap 'rm -f "$database"' EXIT

[[ -f "$migration" ]] || {
  echo "FAIL: missing migration $migration" >&2
  exit 1
}

sqlite3 "$database" <<'SQL'
PRAGMA foreign_keys = ON;
CREATE TABLE meetings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO meetings VALUES ('existing-meeting', 'Existing meeting', '2026-08-01T10:00:00Z', '2026-08-01T10:00:00Z');
SQL

sqlite3 "$database" < "$migration"

[[ "$(sqlite3 "$database" "SELECT COUNT(*) FROM meetings WHERE id='existing-meeting';")" == "1" ]]
[[ "$(sqlite3 "$database" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('projects','meeting_projects');")" == "2" ]]
[[ "$(sqlite3 "$database" "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_meeting_projects_project_id';")" == "1" ]]

sqlite3 "$database" <<'SQL'
PRAGMA foreign_keys = ON;
INSERT INTO projects VALUES ('project-1', 'YachtNet', 'yachtnet', '2026-08-03T10:00:00Z', '2026-08-03T10:00:00Z');
INSERT INTO meeting_projects VALUES ('existing-meeting', 'project-1', '2026-08-03T10:00:00Z');
DELETE FROM projects WHERE id='project-1';
SQL

[[ "$(sqlite3 "$database" "SELECT COUNT(*) FROM meeting_projects;")" == "0" ]]
[[ "$(sqlite3 "$database" "SELECT COUNT(*) FROM meetings WHERE id='existing-meeting';")" == "1" ]]

echo "PASS: meeting project migration preserves meetings and cascades only relations"
