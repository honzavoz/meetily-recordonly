use crate::database::models::SummaryProcess;
use chrono::Utc;
use serde_json::Value;
use sqlx::SqlitePool;
use tracing::{error, info as log_info};

pub struct SummaryProcessesRepository;

impl SummaryProcessesRepository {
    /// Retrieves the current summary process state for a given meeting ID.
    pub async fn get_summary_data(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<SummaryProcess>, sqlx::Error> {
        sqlx::query_as::<_, SummaryProcess>("SELECT * FROM summary_processes WHERE meeting_id = ?")
            .bind(meeting_id)
            .fetch_optional(pool)
            .await
    }

    pub async fn update_meeting_summary(
        pool: &SqlitePool,
        meeting_id: &str,
        summary: &Value,
    ) -> Result<bool, sqlx::Error> {
        let mut transaction = pool.begin().await?;

        let meeting_exists: bool = sqlx::query("SELECT 1 FROM meetings WHERE id = ?")
            .bind(meeting_id)
            .fetch_optional(&mut *transaction)
            .await?
            .is_some();

        if !meeting_exists {
            log_info!(
                "Attempted to save summary for a non-existent meeting_id: {}",
                meeting_id
            );
            transaction.rollback().await?;
            return Ok(false);
        }

        let result_json = serde_json::to_string(summary);
        if result_json.is_err() {
            error!("Can't convert the json to string for saving to Database");
            transaction.rollback().await?;
            return Ok(false);
        }
        let now = Utc::now();

        let summary_update = sqlx::query(
            "UPDATE summary_processes SET result = ?, updated_at = ? WHERE meeting_id = ?",
        )
        .bind(&result_json.unwrap())
        .bind(now)
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

        if summary_update.rows_affected() != 1 {
            log_info!(
                "Attempted to save summary without a summary process for meeting_id: {}",
                meeting_id
            );
            transaction.rollback().await?;
            return Ok(false);
        }

        sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;

        transaction.commit().await?;

        log_info!(
            "Successfully updated summary and timestamp for meeting_id: {}",
            meeting_id
        );
        Ok(true)
    }

    pub async fn get_summary_data_for_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<SummaryProcess>, sqlx::Error> {
        sqlx::query_as::<_, SummaryProcess>(
            "SELECT p.* FROM summary_processes p JOIN transcript_chunks t ON p.meeting_id = t.meeting_id WHERE p.meeting_id = ?",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn create_or_reset_process(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<(), sqlx::Error> {
        log_info!(
            "Creating or resetting summary process for meeting_id: {}",
            meeting_id
        );
        let now = Utc::now();
        sqlx::query(
            r#"
            INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, start_time, result, error)
            VALUES (?, 'PENDING', ?, ?, ?, NULL, NULL)
            ON CONFLICT(meeting_id) DO UPDATE SET
                status = 'PENDING',
                updated_at = excluded.updated_at,
                start_time = excluded.start_time,
                result_backup = result,
                result_backup_timestamp = excluded.updated_at,
                result = result,
                error = NULL
            "#
        )
        .bind(meeting_id)
        .bind(now)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await?;
        log_info!(
            "Backed up existing summary before regeneration for meeting_id: {}",
            meeting_id
        );
        Ok(())
    }

    pub async fn update_process_completed(
        pool: &SqlitePool,
        meeting_id: &str,
        result: Value, // Keep this as Value to handle both old and new formats if needed
        chunk_count: i64,
        processing_time: f64,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        let result_str = serde_json::to_string(&result)
            .map_err(|e| sqlx::Error::Protocol(format!("Failed to serialize result: {}", e)))?;

        sqlx::query(
            r#"
            UPDATE summary_processes
            SET status = 'completed', result = ?, updated_at = ?, end_time = ?, chunk_count = ?, processing_time = ?, error = NULL, result_backup = NULL, result_backup_timestamp = NULL
            WHERE meeting_id = ?
            "#
        )
        .bind(result_str)
        .bind(now)
        .bind(now)
        .bind(chunk_count)
        .bind(processing_time)
        .bind(meeting_id)
        .execute(pool)
        .await?;
        log_info!(
            "Summary completed and backup cleared for meeting_id: {}",
            meeting_id
        );
        Ok(())
    }

    pub async fn update_process_failed(
        pool: &SqlitePool,
        meeting_id: &str,
        error: &str,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();

        // Restore from backup if it exists, otherwise keep current result
        sqlx::query(
            r#"
            UPDATE summary_processes
            SET
                status = 'failed',
                error = ?,
                updated_at = ?,
                end_time = ?,
                result = COALESCE(result_backup, result),
                result_backup = NULL,
                result_backup_timestamp = NULL
            WHERE meeting_id = ?
            "#,
        )
        .bind(error)
        .bind(now)
        .bind(now)
        .bind(meeting_id)
        .execute(pool)
        .await?;
        log_info!(
            "Summary generation failed and backup restored for meeting_id: {}",
            meeting_id
        );
        Ok(())
    }

    pub async fn update_process_failed_with_result(
        pool: &SqlitePool,
        meeting_id: &str,
        error: &str,
        result: Option<Value>,
        chunk_count: i64,
        processing_time: f64,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        let result = result
            .map(|value| {
                serde_json::to_string(&value).map_err(|e| {
                    sqlx::Error::Protocol(format!("Failed to serialize failed result: {}", e))
                })
            })
            .transpose()?;

        sqlx::query(
            r#"
            UPDATE summary_processes
            SET
                status = 'failed',
                error = ?,
                updated_at = ?,
                end_time = ?,
                result = CASE
                    WHEN ? IS NULL THEN COALESCE(result_backup, result)
                    WHEN COALESCE(result_backup, result) IS NULL THEN ?
                    ELSE json_set(
                        COALESCE(result_backup, result),
                        '$.english_cache',
                        json_extract(?, '$.english_cache')
                    )
                END,
                chunk_count = ?,
                processing_time = ?,
                result_backup = NULL,
                result_backup_timestamp = NULL
            WHERE meeting_id = ?
            "#,
        )
        .bind(error)
        .bind(now)
        .bind(now)
        .bind(result.as_deref())
        .bind(result.as_deref())
        .bind(result.as_deref())
        .bind(chunk_count)
        .bind(processing_time)
        .bind(meeting_id)
        .execute(pool)
        .await?;
        log_info!(
            "Summary generation failed with result metadata for meeting_id: {}",
            meeting_id
        );
        Ok(())
    }

    pub async fn update_process_cancelled(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();

        // Restore from backup if it exists, otherwise keep current result
        sqlx::query(
            r#"
            UPDATE summary_processes
            SET
                status = 'cancelled',
                updated_at = ?,
                end_time = ?,
                error = 'Generation was cancelled by user',
                result = COALESCE(result_backup, result),
                result_backup = NULL,
                result_backup_timestamp = NULL
            WHERE meeting_id = ?
            "#,
        )
        .bind(now)
        .bind(now)
        .bind(meeting_id)
        .execute(pool)
        .await?;
        log_info!(
            "Marked summary process as cancelled and restored backup for meeting_id: {}",
            meeting_id
        );
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
        sqlx::query(
            r#"
            CREATE TABLE summary_processes (
                meeting_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                error TEXT,
                result TEXT,
                start_time TEXT,
                end_time TEXT,
                chunk_count INTEGER DEFAULT 0,
                processing_time REAL DEFAULT 0.0,
                metadata TEXT,
                result_backup TEXT,
                result_backup_timestamp TEXT
            )
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"
            CREATE TABLE meetings (
                id TEXT PRIMARY KEY,
                updated_at TEXT
            )
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn update_meeting_summary_persists_the_new_result() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO meetings (id, updated_at) VALUES (?, CURRENT_TIMESTAMP)")
            .bind("meeting-save")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, result) VALUES (?, 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)",
        )
        .bind("meeting-save")
        .bind(r#"{"markdown":"old"}"#)
        .execute(&pool)
        .await
        .unwrap();

        let edited = serde_json::json!({"markdown": "edited"});
        let updated =
            SummaryProcessesRepository::update_meeting_summary(&pool, "meeting-save", &edited)
                .await
                .unwrap();

        assert!(updated);
        let stored: String =
            sqlx::query_scalar("SELECT result FROM summary_processes WHERE meeting_id = ?")
                .bind("meeting-save")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(serde_json::from_str::<Value>(&stored).unwrap(), edited);
    }

    #[tokio::test]
    async fn update_meeting_summary_returns_false_without_summary_row() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO meetings (id, updated_at) VALUES (?, CURRENT_TIMESTAMP)")
            .bind("meeting-without-summary")
            .execute(&pool)
            .await
            .unwrap();

        let updated = SummaryProcessesRepository::update_meeting_summary(
            &pool,
            "meeting-without-summary",
            &serde_json::json!({"markdown": "edited"}),
        )
        .await
        .unwrap();

        assert!(!updated);
    }

    #[tokio::test]
    async fn failed_with_result_persists_cache_metadata_and_keeps_failed_status() {
        let pool = test_pool().await;
        let localized = serde_json::json!({
            "markdown": "Předchozí české shrnutí",
            "other_display_metadata": "keep me"
        });
        sqlx::query(
            "INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, result_backup) VALUES (?, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)",
        )
        .bind("meeting-1")
        .bind(localized.to_string())
        .execute(&pool)
        .await
        .unwrap();

        let cached =
            serde_json::json!({"markdown":"English", "english_cache":{"markdown":"English"}});
        SummaryProcessesRepository::update_process_failed_with_result(
            &pool,
            "meeting-1",
            "translation failed",
            Some(cached.clone()),
            4,
            1.25,
        )
        .await
        .unwrap();

        let row = sqlx::query_as::<_, (String, String, Option<String>, i64, f64, Option<String>, Option<String>, Option<String>)>(
            "SELECT status, error, result, chunk_count, processing_time, end_time, result_backup, result_backup_timestamp FROM summary_processes WHERE meeting_id = ?",
        )
        .bind("meeting-1")
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.0, "failed");
        assert_eq!(row.1, "translation failed");
        let merged: Value = serde_json::from_str(row.2.as_deref().unwrap()).unwrap();
        assert_eq!(merged["markdown"], localized["markdown"]);
        assert_eq!(merged["other_display_metadata"], "keep me");
        assert_eq!(merged["english_cache"], cached["english_cache"]);
        assert_eq!(row.3, 4);
        assert_eq!(row.4, 1.25);
        assert!(row.5.is_some());
        assert!(row.6.is_none());
        assert!(row.7.is_none());
    }

    #[tokio::test]
    async fn failed_without_new_result_restores_existing_backup() {
        let pool = test_pool().await;
        let backup = r#"{"markdown":"last successful result"}"#;
        sqlx::query(
            "INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, result, result_backup) VALUES (?, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?)",
        )
        .bind("meeting-2")
        .bind(r#"{"markdown":"in-progress value"}"#)
        .bind(backup)
        .execute(&pool)
        .await
        .unwrap();

        SummaryProcessesRepository::update_process_failed_with_result(
            &pool,
            "meeting-2",
            "generation failed",
            None,
            0,
            0.5,
        )
        .await
        .unwrap();

        let row = sqlx::query_as::<_, (String, Option<String>, Option<String>)>(
            "SELECT status, result, result_backup FROM summary_processes WHERE meeting_id = ?",
        )
        .bind("meeting-2")
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.0, "failed");
        assert_eq!(row.1.as_deref(), Some(backup));
        assert!(row.2.is_none());
    }
}
