use crate::database::repositories::{
    meeting::MeetingsRepository, summary::SummaryProcessesRepository,
    transcript_chunk::TranscriptChunksRepository,
};
use crate::state::AppState;
use crate::summary::language_detection::{detect_summary_language, SummaryLanguageDetection};
use crate::summary::metadata::{
    read_detected_summary_language_from_metadata, read_summary_language_from_metadata,
    write_detected_summary_language_to_metadata, write_summary_language_to_metadata,
};
use crate::summary::queue::{
    CancelOutcome, ReservationOutcome, SummaryJobPhase, SummaryJobView, SUMMARY_QUEUE,
};
use crate::summary::service::SummaryService;
use log::{error as log_error, info as log_info, warn as log_warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

#[derive(Debug, Serialize, Deserialize)]
pub struct SummaryResponse {
    pub status: String,
    #[serde(rename = "meetingName")]
    pub meeting_name: Option<String>,
    pub meeting_id: String,
    pub start: Option<String>,
    pub end: Option<String>,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
    pub process_id: Option<String>,
    pub queue_position: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessTranscriptResponse {
    pub message: String,
    pub process_id: String,
    pub meeting_id: String,
    pub status: String,
    pub queue_position: Option<usize>,
    pub already_active: bool,
}

fn active_status(view: &SummaryJobView) -> &'static str {
    match view.phase {
        SummaryJobPhase::Reserved | SummaryJobPhase::Queued => "pending",
        SummaryJobPhase::Running => "processing",
        SummaryJobPhase::Cancelling => "cancelling",
    }
}

fn persisted_job_id(metadata: Option<&str>) -> Option<String> {
    metadata
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|value| value.get("job_id")?.as_str().map(str::to_string))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SummaryLanguageStorage {
    Metadata,
    LocalFallback,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSummaryLanguagePreference {
    pub language: Option<String>,
    pub storage: SummaryLanguageStorage,
}

impl MeetingSummaryLanguagePreference {
    fn metadata(language: Option<String>) -> Self {
        Self {
            language,
            storage: SummaryLanguageStorage::Metadata,
        }
    }

    fn local_fallback() -> Self {
        Self {
            language: None,
            storage: SummaryLanguageStorage::LocalFallback,
        }
    }
}

enum MeetingFolderResolution {
    Folder(PathBuf),
    NoFolder,
}

/// Saves a meeting summary (Native SQLx implementation)
///
/// Expected format: { "markdown": "...", "summary_json": [...BlockNote blocks...] }
#[tauri::command]
pub async fn api_save_meeting_summary<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    summary: serde_json::Value,
    _auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_meeting_summary (native) called for meeting_id: {}",
        meeting_id
    );
    let pool = state.db_manager.pool();

    match SummaryProcessesRepository::update_meeting_summary(pool, &meeting_id, &summary).await {
        Ok(true) => {
            log_info!("Summary saved successfully for meeting_id: {}", meeting_id);
            Ok(serde_json::json!({
                "message": "Meeting summary saved successfully"
            }))
        }
        Ok(false) => {
            log_warn!(
                "Meeting not found or invalid JSON for meeting_id: {}",
                meeting_id
            );
            Err("Meeting not found or can't convert the json".into())
        }
        Err(e) => {
            log_error!("Failed to save meeting summary for {}: {}", meeting_id, e);
            Err(e.to_string())
        }
    }
}

/// Gets the per-meeting summary language override from metadata.json.
#[tauri::command]
pub async fn api_get_meeting_summary_language<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<MeetingSummaryLanguagePreference, String> {
    log_info!(
        "api_get_meeting_summary_language called for meeting_id: {}",
        meeting_id
    );

    match resolve_meeting_folder(state.db_manager.pool(), &meeting_id).await? {
        MeetingFolderResolution::Folder(folder) => read_summary_language_from_metadata(&folder)
            .map(MeetingSummaryLanguagePreference::metadata)
            .map_err(|e| e.to_string()),
        MeetingFolderResolution::NoFolder => Ok(MeetingSummaryLanguagePreference::local_fallback()),
    }
}

/// Saves or clears the per-meeting summary language override in metadata.json.
#[tauri::command]
pub async fn api_save_meeting_summary_language<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    summary_language: Option<String>,
) -> Result<MeetingSummaryLanguagePreference, String> {
    log_info!(
        "api_save_meeting_summary_language called for meeting_id: {}, language: {:?}",
        meeting_id,
        summary_language
    );

    match resolve_meeting_folder(state.db_manager.pool(), &meeting_id).await? {
        MeetingFolderResolution::Folder(folder) => {
            write_summary_language_to_metadata(&folder, summary_language.as_deref())
                .map_err(|e| e.to_string())?;
            read_summary_language_from_metadata(&folder)
                .map(MeetingSummaryLanguagePreference::metadata)
                .map_err(|e| e.to_string())
        }
        MeetingFolderResolution::NoFolder => Ok(MeetingSummaryLanguagePreference::local_fallback()),
    }
}

/// Gets the cached Auto-detected summary language from metadata.json.
#[tauri::command]
pub async fn api_get_meeting_detected_summary_language<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<MeetingSummaryLanguagePreference, String> {
    log_info!(
        "api_get_meeting_detected_summary_language called for meeting_id: {}",
        meeting_id
    );

    match resolve_meeting_folder(state.db_manager.pool(), &meeting_id).await? {
        MeetingFolderResolution::Folder(folder) => {
            read_detected_summary_language_from_metadata(&folder)
                .map(MeetingSummaryLanguagePreference::metadata)
                .map_err(|e| e.to_string())
        }
        MeetingFolderResolution::NoFolder => Ok(MeetingSummaryLanguagePreference::local_fallback()),
    }
}

/// Saves or clears the cached Auto-detected summary language in metadata.json.
#[tauri::command]
pub async fn api_save_meeting_detected_summary_language<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    detected_summary_language: Option<String>,
) -> Result<MeetingSummaryLanguagePreference, String> {
    log_info!(
        "api_save_meeting_detected_summary_language called for meeting_id: {}, language: {:?}",
        meeting_id,
        detected_summary_language
    );

    match resolve_meeting_folder(state.db_manager.pool(), &meeting_id).await? {
        MeetingFolderResolution::Folder(folder) => {
            write_detected_summary_language_to_metadata(
                &folder,
                detected_summary_language.as_deref(),
            )
            .map_err(|e| e.to_string())?;
            read_detected_summary_language_from_metadata(&folder)
                .map(MeetingSummaryLanguagePreference::metadata)
                .map_err(|e| e.to_string())
        }
        MeetingFolderResolution::NoFolder => Ok(MeetingSummaryLanguagePreference::local_fallback()),
    }
}

/// Detects the dominant supported summary language from transcript segments.
#[tauri::command]
pub async fn api_detect_transcript_summary_language(
    transcript_texts: Vec<String>,
) -> Result<SummaryLanguageDetection, String> {
    Ok(detect_summary_language(&transcript_texts))
}

async fn resolve_meeting_folder(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
) -> Result<MeetingFolderResolution, String> {
    let meeting = MeetingsRepository::get_meeting_metadata(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to load meeting metadata: {}", e))?
        .ok_or_else(|| format!("Meeting not found: {}", meeting_id))?;

    let Some(folder_path) = meeting.folder_path.filter(|p| !p.trim().is_empty()) else {
        return Ok(MeetingFolderResolution::NoFolder);
    };

    Ok(MeetingFolderResolution::Folder(PathBuf::from(folder_path)))
}

/// Gets summary status and data (Native SQLx implementation)
///
/// Returns summary status (pending/processing/completed/failed) and parsed result data
#[tauri::command]
pub async fn api_get_summary<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    _auth_token: Option<String>,
) -> Result<SummaryResponse, String> {
    log_info!(
        "api_get_summary (native) called for meeting_id: {}",
        meeting_id
    );
    let pool = state.db_manager.pool();

    match SummaryProcessesRepository::get_summary_data_for_meeting(pool, &meeting_id).await {
        Ok(Some(process)) => {
            let active_job = SUMMARY_QUEUE.view_for_meeting(&meeting_id).await;
            let persisted_process_id = persisted_job_id(process.metadata.as_deref());
            let status = active_job
                .as_ref()
                .map(|job| active_status(job).to_string())
                .unwrap_or_else(|| process.status.to_lowercase());
            let process_id = active_job
                .as_ref()
                .map(|job| job.job_id.clone())
                .or(persisted_process_id);
            let queue_position = active_job.and_then(|job| job.queue_position);
            let error = process.error;

            // Parse result data if it exists (regardless of status)
            // This allows displaying restored summaries after cancellation or failure
            let data = if let Some(result_str) = process.result {
                match serde_json::from_str::<serde_json::Value>(&result_str) {
                    Ok(parsed) => Some(parsed),
                    Err(e) => {
                        log_error!("Failed to parse summary result JSON: {}", e);
                        None
                    }
                }
            } else {
                None
            };

            // Fetch meeting title from database
            let meeting_name = match MeetingsRepository::get_meeting(pool, &meeting_id).await {
                Ok(Some(meeting_details)) => {
                    log_info!("Fetched meeting title: {}", &meeting_details.title);
                    Some(meeting_details.title)
                }
                Ok(None) => {
                    log_warn!("Meeting not found for meeting_id: {}", meeting_id);
                    None
                }
                Err(e) => {
                    log_error!("Failed to fetch meeting title: {}", e);
                    None
                }
            };

            let response = SummaryResponse {
                status: status.clone(),
                meeting_name,
                meeting_id: meeting_id.clone(),
                start: process.start_time.map(|t| t.to_rfc3339()),
                end: process.end_time.map(|t| t.to_rfc3339()),
                data,
                error,
                process_id,
                queue_position,
            };

            log_info!(
                "Summary status for {}: {}, has_data: {}, meeting_name: {:?}",
                meeting_id,
                status,
                response.data.is_some(),
                response.meeting_name
            );
            Ok(response)
        }
        Ok(None) => {
            log_info!("No summary process found for meeting_id: {}", meeting_id);

            // Still fetch meeting title for idle state
            let meeting_name = match MeetingsRepository::get_meeting(pool, &meeting_id).await {
                Ok(Some(meeting_details)) => Some(meeting_details.title),
                _ => None,
            };

            Ok(SummaryResponse {
                status: "idle".to_string(),
                meeting_name,
                meeting_id,
                start: None,
                end: None,
                data: None,
                error: None,
                process_id: None,
                queue_position: None,
            })
        }
        Err(e) => {
            log_error!("Error retrieving summary for {}: {}", meeting_id, e);
            Err(format!("Failed to retrieve summary: {}", e))
        }
    }
}

/// Processes transcript and generates summary (Native SQLx implementation)
///
/// Spawns a background task and returns immediately with process_id
#[tauri::command]
pub async fn api_process_transcript<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    text: String,
    model: String,
    model_name: String,
    meeting_id: Option<String>,
    _chunk_size: Option<i32>,
    _overlap: Option<i32>,
    custom_prompt: Option<String>,
    template_id: Option<String>,
    summary_language: Option<String>,
    _auth_token: Option<String>,
) -> Result<ProcessTranscriptResponse, String> {
    use uuid::Uuid;

    let m_id = meeting_id.unwrap_or_else(|| format!("meeting-{}", Uuid::new_v4()));
    log_info!(
        "api_process_transcript (native) called for meeting_id: {}, model: {}",
        &m_id,
        &model
    );

    let pool = state.db_manager.pool().clone();
    let final_prompt = custom_prompt.unwrap_or_else(|| "".to_string());
    let final_template_id = template_id.unwrap_or_else(|| "daily_standup".to_string());

    let (reserved, token) = match SUMMARY_QUEUE.reserve(&m_id).await {
        ReservationOutcome::Existing(existing) => {
            let status = active_status(&existing).to_string();
            return Ok(ProcessTranscriptResponse {
                message: "Summary generation is already active".to_string(),
                process_id: existing.job_id,
                meeting_id: m_id,
                status,
                queue_position: existing.queue_position,
                already_active: true,
            });
        }
        ReservationOutcome::New { view, token } => (view, token),
    };
    let job_id = reserved.job_id.clone();

    // Normalise empty / whitespace-only to None so "" and null behave identically
    let summary_language = summary_language.and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    });

    // Create or reset the process entry in the database
    if let Err(e) = SummaryProcessesRepository::create_or_reset_process(&pool, &m_id, &job_id).await
    {
        SUMMARY_QUEUE.release_reservation(&m_id, &job_id).await;
        return Err(format!("Failed to initialize process: {}", e));
    }

    log_info!("✓ Summary process initialized for meeting_id: {}", &m_id);

    // Save transcript chunks data (matching Python backend behavior)
    let chunk_size = _chunk_size.unwrap_or(40000);
    let overlap = _overlap.unwrap_or(1000);

    if let Err(e) = TranscriptChunksRepository::save_transcript_data(
        &pool,
        &m_id,
        &text,
        &model,
        &model_name,
        chunk_size,
        overlap,
    )
    .await
    {
        let message = format!("Failed to save transcript data: {}", e);
        if let Err(db_error) =
            SummaryProcessesRepository::update_process_failed(&pool, &m_id, &message).await
        {
            log_error!(
                "Failed to restore summary after transcript persistence error for {}: {}",
                m_id,
                db_error
            );
        }
        SUMMARY_QUEUE.release_reservation(&m_id, &job_id).await;
        return Err(message);
    }

    log_info!("✓ Transcript chunks saved for meeting_id: {}", &m_id);

    let committed = match SUMMARY_QUEUE.commit(&job_id).await {
        Ok(view) => view,
        Err(e) => {
            let message = format!("Failed to enqueue summary generation: {}", e);
            let _ = SummaryProcessesRepository::update_process_failed(&pool, &m_id, &message).await;
            SUMMARY_QUEUE.release_reservation(&m_id, &job_id).await;
            return Err(message);
        }
    };

    // Spawn one dispatcher per job. The queue grants only this exact job ID.
    let meeting_id_clone = m_id.clone();
    let job_id_clone = job_id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = SUMMARY_QUEUE.wait_for_turn(&job_id_clone, &token).await {
            log_info!(
                "Summary job {} stopped before execution: {}",
                job_id_clone,
                e
            );
            return;
        }

        match SummaryProcessesRepository::mark_process_running(
            &pool,
            &meeting_id_clone,
            &job_id_clone,
        )
        .await
        {
            Ok(true) => {}
            Ok(false) => {
                let message = format!(
                    "Summary job {} no longer owns the persisted process",
                    job_id_clone
                );
                let _ = SummaryProcessesRepository::update_process_failed(
                    &pool,
                    &meeting_id_clone,
                    &message,
                )
                .await;
                SUMMARY_QUEUE.finish(&meeting_id_clone, &job_id_clone).await;
                return;
            }
            Err(e) => {
                let message = format!("Failed to start summary job: {}", e);
                let _ = SummaryProcessesRepository::update_process_failed(
                    &pool,
                    &meeting_id_clone,
                    &message,
                )
                .await;
                SUMMARY_QUEUE.finish(&meeting_id_clone, &job_id_clone).await;
                return;
            }
        }

        let service_pool = pool.clone();
        let service_meeting_id = meeting_id_clone.clone();
        let service_job = tauri::async_runtime::spawn(async move {
            SummaryService::process_transcript_background(
                app,
                service_pool,
                service_meeting_id,
                text,
                model,
                model_name,
                final_prompt,
                final_template_id,
                summary_language,
                token,
            )
            .await;
        });

        if let Err(e) = service_job.await {
            let message = format!("Summary worker stopped unexpectedly: {}", e);
            log_error!("{} ({})", message, meeting_id_clone);
            let _ = SummaryProcessesRepository::update_process_failed(
                &pool,
                &meeting_id_clone,
                &message,
            )
            .await;
        }

        SUMMARY_QUEUE.finish(&meeting_id_clone, &job_id_clone).await;
    });

    log_info!("🚀 Background task spawned for meeting_id: {}", &m_id);

    Ok(ProcessTranscriptResponse {
        message: "Summary generation queued".to_string(),
        process_id: job_id,
        meeting_id: m_id,
        status: active_status(&committed).to_string(),
        queue_position: committed.queue_position,
        already_active: false,
    })
}

/// Cancels an ongoing summary generation process
///
/// This command triggers the cancellation token for the specified meeting,
/// stopping the summary generation gracefully.
#[tauri::command]
pub async fn api_cancel_summary<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    process_id: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_cancel_summary called for meeting_id: {}", meeting_id);

    let active = SUMMARY_QUEUE.view_for_meeting(&meeting_id).await;
    let Some(job_id) = process_id.or_else(|| active.map(|job| job.job_id)) else {
        return Ok(serde_json::json!({
            "message": "No active summary generation to cancel",
            "meeting_id": meeting_id,
            "status": "not_active",
        }));
    };

    match SUMMARY_QUEUE.cancel(&meeting_id, &job_id).await {
        CancelOutcome::Queued(_) => {
            SummaryProcessesRepository::update_process_cancelled(
                state.db_manager.pool(),
                &meeting_id,
            )
            .await
            .map_err(|e| format!("Failed to update cancellation status: {}", e))?;
            Ok(serde_json::json!({
                "message": "Queued summary generation cancelled",
                "meeting_id": meeting_id,
                "process_id": job_id,
                "status": "cancelled",
            }))
        }
        CancelOutcome::Running(view) => Ok(serde_json::json!({
            "message": "Summary generation cancellation requested",
            "meeting_id": meeting_id,
            "process_id": view.job_id,
            "status": "cancelling",
        })),
        CancelOutcome::NotActive => {
            log_warn!(
                "No matching active summary job found for meeting_id: {}, process_id: {}",
                meeting_id,
                job_id
            );
            Ok(serde_json::json!({
                "message": "No matching active summary generation to cancel",
                "meeting_id": meeting_id,
                "process_id": job_id,
                "status": "not_active",
            }))
        }
    }
}
