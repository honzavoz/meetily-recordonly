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
            r#"
            INSERT INTO summary_processes
                (meeting_id, status, created_at, updated_at, result, error)
            VALUES (?, 'completed', ?, ?, ?, NULL)
            ON CONFLICT(meeting_id) DO UPDATE SET
                result = excluded.result,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(meeting_id)
        .bind(now)
        .bind(now)
        .bind(&result_json.unwrap())
        .execute(&mut *transaction)
        .await?;

        if summary_update.rows_affected() != 1 {
            log_info!(
                "Unexpected summary upsert result for meeting_id: {}",
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
        sqlx::query_as::<_, SummaryProcess>("SELECT * FROM summary_processes WHERE meeting_id = ?")
            .bind(meeting_id)
            .fetch_optional(pool)
            .await
    }

    pub async fn create_or_reset_process(
        pool: &SqlitePool,
        meeting_id: &str,
        job_id: &str,
    ) -> Result<(), sqlx::Error> {
        log_info!(
            "Creating or resetting summary process for meeting_id: {}",
            meeting_id
        );
        let now = Utc::now();
        sqlx::query(
            r#"
            INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, start_time, result, error, metadata)
            VALUES (?, 'PENDING', ?, ?, NULL, NULL, NULL, json_object('job_id', ?))
            ON CONFLICT(meeting_id) DO UPDATE SET
                status = 'PENDING',
                updated_at = excluded.updated_at,
                start_time = NULL,
                end_time = NULL,
                result_backup = result,
                result_backup_timestamp = excluded.updated_at,
                result = result,
                error = NULL,
                metadata = excluded.metadata
            "#
        )
        .bind(meeting_id)
        .bind(now)
        .bind(now)
        .bind(job_id)
        .execute(pool)
        .await?;
        log_info!(
            "Backed up existing summary before regeneration for meeting_id: {}",
            meeting_id
        );
        Ok(())
    }

    pub async fn mark_process_running(
        pool: &SqlitePool,
        meeting_id: &str,
        job_id: &str,
    ) -> Result<bool, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query(
            r#"
            UPDATE summary_processes
            SET status = 'processing', updated_at = ?, start_time = ?, error = NULL
            WHERE meeting_id = ?
              AND json_extract(metadata, '$.job_id') = ?
              AND upper(status) = 'PENDING'
            "#,
        )
        .bind(now)
        .bind(now)
        .bind(meeting_id)
        .bind(job_id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() == 1)
    }

    pub async fn recover_interrupted_processes(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
        let now = Utc::now();
        let mut transaction = pool.begin().await?;
        let result = sqlx::query(
            r#"
            UPDATE summary_processes
            SET
                status = 'failed',
                error = 'Summary generation was interrupted when Record Only exited',
                updated_at = ?,
                end_time = ?,
                result = COALESCE(result_backup, result),
                result_backup = NULL,
                result_backup_timestamp = NULL
            WHERE upper(status) IN ('PENDING', 'PROCESSING')
            "#,
        )
        .bind(now)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        let recovered = result.rows_affected();
        transaction.commit().await?;
        Ok(recovered)
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

    pub async fn update_process_cancelled_for_job(
        pool: &SqlitePool,
        meeting_id: &str,
        job_id: &str,
    ) -> Result<bool, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query(
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
              AND json_extract(metadata, '$.job_id') = ?
              AND upper(status) = 'PENDING'
            "#,
        )
        .bind(now)
        .bind(now)
        .bind(meeting_id)
        .bind(job_id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() == 1)
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
        sqlx::query(
            r#"
            CREATE TABLE transcript_chunks (
                id INTEGER PRIMARY KEY,
                meeting_id TEXT NOT NULL
            )
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    async fn insert_meeting(pool: &SqlitePool, meeting_id: &str) {
        sqlx::query("INSERT INTO meetings (id, updated_at) VALUES (?, CURRENT_TIMESTAMP)")
            .bind(meeting_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn insert_active_process(
        pool: &SqlitePool,
        meeting_id: &str,
        status: &str,
        backup: Option<&str>,
    ) {
        insert_meeting(pool, meeting_id).await;
        sqlx::query(
            "INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, result_backup, metadata) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, json_object('job_id', ?))",
        )
        .bind(meeting_id)
        .bind(status)
        .bind(backup)
        .bind(format!("job-{meeting_id}"))
        .execute(pool)
        .await
        .unwrap();
    }

    async fn assert_recovered(pool: &SqlitePool, meeting_id: &str, expected_result: &str) {
        let row: (String, Option<String>, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT status, result, result_backup, end_time FROM summary_processes WHERE meeting_id = ?",
        )
        .bind(meeting_id)
        .fetch_one(pool)
        .await
        .unwrap();
        assert_eq!(row.0, "failed");
        assert_eq!(row.1.as_deref(), Some(expected_result));
        assert!(row.2.is_none());
        assert!(row.3.is_some());
    }

    #[tokio::test]
    async fn process_lifecycle_persists_job_id_and_processing_state() {
        let pool = test_pool().await;
        insert_meeting(&pool, "meeting-queue").await;

        SummaryProcessesRepository::create_or_reset_process(&pool, "meeting-queue", "job-1")
            .await
            .unwrap();
        assert!(
            SummaryProcessesRepository::mark_process_running(&pool, "meeting-queue", "job-1")
                .await
                .unwrap()
        );

        let row: (String, String) =
            sqlx::query_as("SELECT status, metadata FROM summary_processes WHERE meeting_id = ?")
                .bind("meeting-queue")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(row.0, "processing");
        assert_eq!(
            serde_json::from_str::<Value>(&row.1).unwrap()["job_id"],
            "job-1"
        );
        assert!(!SummaryProcessesRepository::mark_process_running(
            &pool,
            "meeting-queue",
            "stale-job"
        )
        .await
        .unwrap());
    }

    #[tokio::test]
    async fn startup_recovery_fails_active_rows_and_restores_backup() {
        let pool = test_pool().await;
        insert_active_process(&pool, "queued", "PENDING", Some(r#"{"markdown":"old"}"#)).await;
        insert_active_process(
            &pool,
            "running",
            "processing",
            Some(r#"{"markdown":"older"}"#),
        )
        .await;

        let recovered = SummaryProcessesRepository::recover_interrupted_processes(&pool)
            .await
            .unwrap();

        assert_eq!(recovered, 2);
        assert_recovered(&pool, "queued", r#"{"markdown":"old"}"#).await;
        assert_recovered(&pool, "running", r#"{"markdown":"older"}"#).await;
    }

    #[tokio::test]
    async fn stale_queued_cancellation_cannot_touch_a_newer_job() {
        let pool = test_pool().await;
        insert_meeting(&pool, "meeting-race").await;
        SummaryProcessesRepository::create_or_reset_process(&pool, "meeting-race", "new-job")
            .await
            .unwrap();

        assert!(
            !SummaryProcessesRepository::update_process_cancelled_for_job(
                &pool,
                "meeting-race",
                "old-job"
            )
            .await
            .unwrap()
        );

        let row: (String, String) =
            sqlx::query_as("SELECT status, metadata FROM summary_processes WHERE meeting_id = ?")
                .bind("meeting-race")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(row.0, "PENDING");
        assert_eq!(
            serde_json::from_str::<Value>(&row.1).unwrap()["job_id"],
            "new-job"
        );
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
            "INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, result, error) VALUES (?, 'failed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, 'previous generation failed')",
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
        let stored: (String, String, String) = sqlx::query_as(
            "SELECT status, error, result FROM summary_processes WHERE meeting_id = ?",
        )
        .bind("meeting-save")
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(stored.0, "failed");
        assert_eq!(stored.1, "previous generation failed");
        assert_eq!(serde_json::from_str::<Value>(&stored.2).unwrap(), edited);
    }

    #[tokio::test]
    async fn update_meeting_summary_creates_completed_row_when_missing() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO meetings (id, updated_at) VALUES (?, CURRENT_TIMESTAMP)")
            .bind("meeting-without-summary")
            .execute(&pool)
            .await
            .unwrap();

        let external_result = serde_json::json!({"markdown": "external result"});
        let updated = SummaryProcessesRepository::update_meeting_summary(
            &pool,
            "meeting-without-summary",
            &external_result,
        )
        .await
        .unwrap();

        assert!(updated);
        let row: (String, String, i64) = sqlx::query_as(
            "SELECT status, result, COUNT(*) OVER () FROM summary_processes WHERE meeting_id = ?",
        )
        .bind("meeting-without-summary")
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.0, "completed");
        assert_eq!(
            serde_json::from_str::<Value>(&row.1).unwrap(),
            external_result
        );
        assert_eq!(row.2, 1);
    }

    #[tokio::test]
    async fn get_summary_data_for_meeting_does_not_require_transcript_chunks() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO meetings (id, updated_at) VALUES (?, CURRENT_TIMESTAMP)")
            .bind("record-only-meeting")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, result) VALUES (?, 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)",
        )
        .bind("record-only-meeting")
        .bind(r#"{"markdown":"saved externally"}"#)
        .execute(&pool)
        .await
        .unwrap();

        let summary =
            SummaryProcessesRepository::get_summary_data_for_meeting(&pool, "record-only-meeting")
                .await
                .unwrap();

        assert!(summary.is_some());
        assert_eq!(
            summary.unwrap().result.as_deref(),
            Some(r#"{"markdown":"saved externally"}"#)
        );
    }

    #[tokio::test]
    async fn update_meeting_summary_rejects_nonexistent_meeting_without_orphan() {
        let pool = test_pool().await;

        let updated = SummaryProcessesRepository::update_meeting_summary(
            &pool,
            "missing-meeting",
            &serde_json::json!({"markdown": "must not persist"}),
        )
        .await
        .unwrap();

        assert!(!updated);
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM summary_processes WHERE meeting_id = ?")
                .bind("missing-meeting")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 0);
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
