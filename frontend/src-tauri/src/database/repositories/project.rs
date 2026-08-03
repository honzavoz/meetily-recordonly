use crate::database::models::{MeetingModel, MeetingWithProjects, ProjectModel, ProjectWithCount};
use chrono::Utc;
use sqlx::{Error as SqlxError, SqlitePool};
use uuid::Uuid;

pub enum MeetingProjectFilter<'a> {
    All,
    Unassigned,
    Project(&'a str),
}

pub struct ProjectRepository;

impl ProjectRepository {
    const COLORS: [&'static str; 8] = [
        "blue", "violet", "emerald", "amber", "rose", "cyan", "orange", "slate",
    ];

    pub fn allowed_colors() -> &'static [&'static str] {
        &Self::COLORS
    }

    pub fn normalize_name(name: &str) -> Result<(String, String), SqlxError> {
        let display_name = name.split_whitespace().collect::<Vec<_>>().join(" ");
        if display_name.is_empty() {
            return Err(SqlxError::Protocol(
                "project name cannot be blank".to_string(),
            ));
        }
        let normalized_name = display_name.to_lowercase();
        Ok((display_name, normalized_name))
    }

    pub async fn list(pool: &SqlitePool) -> Result<Vec<ProjectWithCount>, SqlxError> {
        sqlx::query_as::<_, ProjectWithCount>(
            "SELECT p.id, p.name, p.normalized_name, p.color, p.created_at, p.updated_at,
                    COUNT(mp.meeting_id) AS meeting_count
             FROM projects p
             LEFT JOIN meeting_projects mp ON mp.project_id = p.id
             GROUP BY p.id, p.name, p.normalized_name, p.color, p.created_at, p.updated_at
             ORDER BY p.name COLLATE NOCASE ASC",
        )
        .fetch_all(pool)
        .await
    }

    pub async fn search(
        pool: &SqlitePool,
        query: &str,
    ) -> Result<Vec<ProjectWithCount>, SqlxError> {
        let normalized_query = query
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        let pattern = format!("%{}%", normalized_query);
        sqlx::query_as::<_, ProjectWithCount>(
            "SELECT p.id, p.name, p.normalized_name, p.color, p.created_at, p.updated_at,
                    COUNT(mp.meeting_id) AS meeting_count
             FROM projects p
             LEFT JOIN meeting_projects mp ON mp.project_id = p.id
             WHERE p.normalized_name LIKE ?
             GROUP BY p.id, p.name, p.normalized_name, p.color, p.created_at, p.updated_at
             ORDER BY p.name COLLATE NOCASE ASC",
        )
        .bind(pattern)
        .fetch_all(pool)
        .await
    }

    pub async fn create_or_get(pool: &SqlitePool, name: &str) -> Result<ProjectModel, SqlxError> {
        let (display_name, normalized_name) = Self::normalize_name(name)?;
        if let Some(project) = Self::get_by_normalized_name(pool, &normalized_name).await? {
            return Ok(project);
        }

        let id = Uuid::new_v4().to_string();
        let now = Utc::now().naive_utc();
        let project_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects")
            .fetch_one(pool)
            .await?;
        let color = Self::COLORS[project_count.rem_euclid(Self::COLORS.len() as i64) as usize];
        let insert = sqlx::query(
            "INSERT OR IGNORE INTO projects
             (id, name, normalized_name, color, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&display_name)
        .bind(&normalized_name)
        .bind(color)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await?;

        if insert.rows_affected() == 0 {
            return Self::get_by_normalized_name(pool, &normalized_name)
                .await?
                .ok_or(SqlxError::RowNotFound);
        }

        Self::get(pool, &id).await?.ok_or(SqlxError::RowNotFound)
    }

    pub async fn rename(
        pool: &SqlitePool,
        project_id: &str,
        name: &str,
    ) -> Result<ProjectModel, SqlxError> {
        let (display_name, normalized_name) = Self::normalize_name(name)?;
        if Self::get(pool, project_id).await?.is_none() {
            return Err(SqlxError::RowNotFound);
        }
        if let Some(existing) = Self::get_by_normalized_name(pool, &normalized_name).await? {
            if existing.id != project_id {
                return Err(SqlxError::Protocol(format!(
                    "project '{}' already exists",
                    display_name
                )));
            }
        }

        let now = Utc::now().naive_utc();
        sqlx::query(
            "UPDATE projects SET name = ?, normalized_name = ?, updated_at = ? WHERE id = ?",
        )
        .bind(display_name)
        .bind(normalized_name)
        .bind(now)
        .bind(project_id)
        .execute(pool)
        .await?;

        Self::get(pool, project_id)
            .await?
            .ok_or(SqlxError::RowNotFound)
    }

    pub async fn delete(pool: &SqlitePool, project_id: &str) -> Result<(), SqlxError> {
        let result = sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(project_id)
            .execute(pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(SqlxError::RowNotFound);
        }
        Ok(())
    }

    pub async fn update_color(
        pool: &SqlitePool,
        project_id: &str,
        color: &str,
    ) -> Result<ProjectModel, SqlxError> {
        if !Self::COLORS.contains(&color) {
            return Err(SqlxError::Protocol(format!(
                "unsupported project color '{}'",
                color
            )));
        }
        Self::require_project(pool, project_id).await?;
        let now = Utc::now().naive_utc();
        sqlx::query("UPDATE projects SET color = ?, updated_at = ? WHERE id = ?")
            .bind(color)
            .bind(now)
            .bind(project_id)
            .execute(pool)
            .await?;
        Self::get(pool, project_id)
            .await?
            .ok_or(SqlxError::RowNotFound)
    }

    pub async fn list_for_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<ProjectModel>, SqlxError> {
        Self::require_meeting(pool, meeting_id).await?;
        sqlx::query_as::<_, ProjectModel>(
            "SELECT p.id, p.name, p.normalized_name, p.color, p.created_at, p.updated_at
             FROM projects p
             INNER JOIN meeting_projects mp ON mp.project_id = p.id
             WHERE mp.meeting_id = ?
             ORDER BY p.name COLLATE NOCASE ASC",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    pub async fn assign(
        pool: &SqlitePool,
        meeting_id: &str,
        project_id: &str,
    ) -> Result<(), SqlxError> {
        Self::require_meeting(pool, meeting_id).await?;
        Self::require_project(pool, project_id).await?;
        let mut transaction = pool.begin().await?;
        let now = Utc::now().naive_utc();
        sqlx::query(
            "INSERT OR IGNORE INTO meeting_projects (meeting_id, project_id, created_at)
             VALUES (?, ?, ?)",
        )
        .bind(meeting_id)
        .bind(project_id)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        Self::touch_relation_owners(&mut transaction, meeting_id, project_id, now).await?;
        transaction.commit().await
    }

    pub async fn remove(
        pool: &SqlitePool,
        meeting_id: &str,
        project_id: &str,
    ) -> Result<(), SqlxError> {
        Self::require_meeting(pool, meeting_id).await?;
        Self::require_project(pool, project_id).await?;
        let mut transaction = pool.begin().await?;
        let now = Utc::now().naive_utc();
        sqlx::query("DELETE FROM meeting_projects WHERE meeting_id = ? AND project_id = ?")
            .bind(meeting_id)
            .bind(project_id)
            .execute(&mut *transaction)
            .await?;
        Self::touch_relation_owners(&mut transaction, meeting_id, project_id, now).await?;
        transaction.commit().await
    }

    pub async fn list_meetings(
        pool: &SqlitePool,
        filter: MeetingProjectFilter<'_>,
    ) -> Result<Vec<MeetingWithProjects>, SqlxError> {
        let meetings = match filter {
            MeetingProjectFilter::All => {
                sqlx::query_as::<_, MeetingModel>(
                    "SELECT id, title, created_at, updated_at, folder_path
                     FROM meetings ORDER BY created_at DESC",
                )
                .fetch_all(pool)
                .await?
            }
            MeetingProjectFilter::Unassigned => {
                sqlx::query_as::<_, MeetingModel>(
                    "SELECT m.id, m.title, m.created_at, m.updated_at, m.folder_path
                     FROM meetings m
                     WHERE NOT EXISTS (
                       SELECT 1 FROM meeting_projects mp WHERE mp.meeting_id = m.id
                     )
                     ORDER BY m.created_at DESC",
                )
                .fetch_all(pool)
                .await?
            }
            MeetingProjectFilter::Project(project_id) => {
                Self::require_project(pool, project_id).await?;
                sqlx::query_as::<_, MeetingModel>(
                    "SELECT m.id, m.title, m.created_at, m.updated_at, m.folder_path
                     FROM meetings m
                     INNER JOIN meeting_projects mp ON mp.meeting_id = m.id
                     WHERE mp.project_id = ?
                     ORDER BY m.created_at DESC",
                )
                .bind(project_id)
                .fetch_all(pool)
                .await?
            }
        };

        let mut result = Vec::with_capacity(meetings.len());
        for meeting in meetings {
            let projects = Self::list_for_meeting(pool, &meeting.id).await?;
            result.push(MeetingWithProjects {
                id: meeting.id,
                title: meeting.title,
                created_at: meeting.created_at,
                updated_at: meeting.updated_at,
                folder_path: meeting.folder_path,
                projects,
            });
        }
        Ok(result)
    }

    pub async fn get(
        pool: &SqlitePool,
        project_id: &str,
    ) -> Result<Option<ProjectModel>, SqlxError> {
        sqlx::query_as::<_, ProjectModel>(
            "SELECT id, name, normalized_name, color, created_at, updated_at FROM projects WHERE id = ?",
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await
    }

    async fn get_by_normalized_name(
        pool: &SqlitePool,
        normalized_name: &str,
    ) -> Result<Option<ProjectModel>, SqlxError> {
        sqlx::query_as::<_, ProjectModel>(
            "SELECT id, name, normalized_name, color, created_at, updated_at
             FROM projects WHERE normalized_name = ?",
        )
        .bind(normalized_name)
        .fetch_optional(pool)
        .await
    }

    async fn require_meeting(pool: &SqlitePool, meeting_id: &str) -> Result<(), SqlxError> {
        let exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM meetings WHERE id = ?")
            .bind(meeting_id)
            .fetch_optional(pool)
            .await?;
        exists.map(|_| ()).ok_or(SqlxError::RowNotFound)
    }

    async fn require_project(pool: &SqlitePool, project_id: &str) -> Result<(), SqlxError> {
        Self::get(pool, project_id)
            .await?
            .map(|_| ())
            .ok_or(SqlxError::RowNotFound)
    }

    async fn touch_relation_owners(
        transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        meeting_id: &str,
        project_id: &str,
        now: chrono::NaiveDateTime,
    ) -> Result<(), SqlxError> {
        sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(meeting_id)
            .execute(&mut **transaction)
            .await?;
        sqlx::query("UPDATE projects SET updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(project_id)
            .execute(&mut **transaction)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .unwrap();
        for statement in [
            "CREATE TABLE meetings (
               id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL, folder_path TEXT
             )",
            "CREATE TABLE projects (
               id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL,
               normalized_name TEXT NOT NULL UNIQUE, color TEXT NOT NULL DEFAULT 'blue', created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL
             )",
            "CREATE TABLE meeting_projects (
               meeting_id TEXT NOT NULL, project_id TEXT NOT NULL, created_at TEXT NOT NULL,
               PRIMARY KEY (meeting_id, project_id),
               FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
               FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
             )",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        pool
    }

    async fn add_meeting(pool: &SqlitePool, id: &str, created_at: &str) {
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
            .bind(id)
            .bind(id)
            .bind(created_at)
            .bind(created_at)
            .execute(pool)
            .await
            .unwrap();
    }

    #[test]
    fn normalizes_unicode_names_and_rejects_blank_names() {
        assert_eq!(
            ProjectRepository::normalize_name("  ŽLUTÝ   Kůň ").unwrap(),
            ("ŽLUTÝ Kůň".to_string(), "žlutý kůň".to_string())
        );
        assert!(ProjectRepository::normalize_name(" \t ").is_err());
    }

    #[tokio::test]
    async fn create_returns_existing_normalized_project() {
        let pool = test_pool().await;
        let first = ProjectRepository::create_or_get(&pool, " YachtNet ")
            .await
            .unwrap();
        let duplicate = ProjectRepository::create_or_get(&pool, "YACHTNET")
            .await
            .unwrap();
        assert_eq!(first.id, duplicate.id);
        assert_eq!(duplicate.name, "YachtNet");
    }

    #[tokio::test]
    async fn project_colors_use_palette_defaults_and_reject_unknown_values() {
        let pool = test_pool().await;
        let project = ProjectRepository::create_or_get(&pool, "YachtNet")
            .await
            .unwrap();

        assert!(ProjectRepository::allowed_colors().contains(&project.color.as_str()));

        let updated = ProjectRepository::update_color(&pool, &project.id, "emerald")
            .await
            .unwrap();
        assert_eq!(updated.color, "emerald");

        assert!(
            ProjectRepository::update_color(&pool, &project.id, "#00ff00")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn assignment_and_removal_are_idempotent_and_counts_are_correct() {
        let pool = test_pool().await;
        add_meeting(&pool, "meeting-1", "2026-08-01T10:00:00Z").await;
        let project = ProjectRepository::create_or_get(&pool, "YachtNet")
            .await
            .unwrap();
        ProjectRepository::assign(&pool, "meeting-1", &project.id)
            .await
            .unwrap();
        ProjectRepository::assign(&pool, "meeting-1", &project.id)
            .await
            .unwrap();
        assert_eq!(
            ProjectRepository::list(&pool).await.unwrap()[0].meeting_count,
            1
        );
        ProjectRepository::remove(&pool, "meeting-1", &project.id)
            .await
            .unwrap();
        ProjectRepository::remove(&pool, "meeting-1", &project.id)
            .await
            .unwrap();
        assert!(ProjectRepository::list_for_meeting(&pool, "meeting-1")
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn views_are_unique_and_newest_first() {
        let pool = test_pool().await;
        add_meeting(&pool, "older", "2026-08-01T10:00:00Z").await;
        add_meeting(&pool, "newer", "2026-08-02T10:00:00Z").await;
        let yacht = ProjectRepository::create_or_get(&pool, "YachtNet")
            .await
            .unwrap();
        let internal = ProjectRepository::create_or_get(&pool, "Interní")
            .await
            .unwrap();
        ProjectRepository::assign(&pool, "newer", &yacht.id)
            .await
            .unwrap();
        ProjectRepository::assign(&pool, "newer", &internal.id)
            .await
            .unwrap();

        let all = ProjectRepository::list_meetings(&pool, MeetingProjectFilter::All)
            .await
            .unwrap();
        assert_eq!(
            all.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            vec!["newer", "older"]
        );
        let unassigned = ProjectRepository::list_meetings(&pool, MeetingProjectFilter::Unassigned)
            .await
            .unwrap();
        assert_eq!(unassigned.len(), 1);
        assert_eq!(unassigned[0].id, "older");
        let project_meetings =
            ProjectRepository::list_meetings(&pool, MeetingProjectFilter::Project(&yacht.id))
                .await
                .unwrap();
        assert_eq!(project_meetings.len(), 1);
        assert_eq!(project_meetings[0].projects.len(), 2);
    }

    #[tokio::test]
    async fn rename_search_and_delete_leave_meetings_intact() {
        let pool = test_pool().await;
        add_meeting(&pool, "meeting-1", "2026-08-01T10:00:00Z").await;
        let project = ProjectRepository::create_or_get(&pool, "YachtNet")
            .await
            .unwrap();
        ProjectRepository::assign(&pool, "meeting-1", &project.id)
            .await
            .unwrap();
        let renamed = ProjectRepository::rename(&pool, &project.id, "Yacht Net")
            .await
            .unwrap();
        assert_eq!(renamed.normalized_name, "yacht net");
        assert_eq!(
            ProjectRepository::search(&pool, "NET").await.unwrap().len(),
            1
        );
        ProjectRepository::delete(&pool, &project.id).await.unwrap();
        let meetings: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM meetings")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(meetings.0, 1);
    }
}
