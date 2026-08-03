use super::constants::AUDIO_EXTENSIONS;
use super::import::extract_duration_from_metadata;
use super::recording_preferences::load_recording_preferences;
use crate::database::repositories::project::ProjectRepository;
use crate::state::AppState;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};

const INDEX_FILE_NAME: &str = "transcribe_later_index.json";
const METADATA_FILE_NAME: &str = "metadata.json";
static RECORDING_PROJECT_OPERATION_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TranscribeLaterStatus {
    Pending,
    Imported,
    Hidden,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeLaterIndexEntry {
    pub audio_path: String,
    pub size_bytes: u64,
    pub modified_at_ms: u64,
    pub status: TranscribeLaterStatus,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeLaterRecording {
    pub id: String,
    pub title: String,
    pub folder_path: String,
    pub audio_path: String,
    pub size_bytes: u64,
    pub modified_at_ms: u64,
    pub duration_seconds: Option<f64>,
    pub status: TranscribeLaterStatus,
    pub index_entry: Option<TranscribeLaterIndexEntry>,
    pub projects: Vec<RecordingProject>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingProject {
    pub id: String,
    pub name: String,
    pub normalized_name: String,
    #[serde(default = "default_project_color")]
    pub color: String,
}

fn default_project_color() -> String {
    "blue".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct TranscribeLaterIndex {
    entries: HashMap<String, TranscribeLaterIndexEntry>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn modified_at_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn is_supported_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let normalized = ext.to_lowercase();
            AUDIO_EXTENSIONS.contains(&normalized.as_str())
        })
        .unwrap_or(false)
}

fn title_from_folder(folder_path: &Path) -> String {
    folder_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Recording")
        .to_string()
}

fn choose_audio_file(folder_path: &Path) -> Option<PathBuf> {
    let folder_name = folder_path.file_name()?.to_string_lossy().to_string();
    let mut supported_files = fs::read_dir(folder_path)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && is_supported_audio_file(path))
        .collect::<Vec<_>>();

    supported_files.sort();

    if let Some(named_file) = supported_files.iter().find(|path| {
        path.file_stem()
            .and_then(|stem| stem.to_str())
            .map(|stem| stem == folder_name)
            .unwrap_or(false)
    }) {
        return Some(named_file.clone());
    }

    if let Some(audio_mp4) = supported_files.iter().find(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.eq_ignore_ascii_case("audio.mp4"))
            .unwrap_or(false)
    }) {
        return Some(audio_mp4.clone());
    }

    supported_files.into_iter().next()
}

fn transcript_file_has_segments(folder_path: &Path) -> bool {
    let transcript_path = folder_path.join("transcripts.json");
    let Ok(raw) = fs::read_to_string(transcript_path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };

    value
        .get("total_segments")
        .and_then(|segments| segments.as_u64())
        .map(|segments| segments > 0)
        .unwrap_or_else(|| {
            value
                .get("segments")
                .and_then(|segments| segments.as_array())
                .map(|segments| !segments.is_empty())
                .unwrap_or(false)
        })
}

fn metadata_has_imported_meeting_id(folder_path: &Path) -> bool {
    let metadata_path = folder_path.join("metadata.json");
    let Ok(raw) = fs::read_to_string(metadata_path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };

    value
        .get("meeting_id")
        .and_then(|meeting_id| meeting_id.as_str())
        .map(|meeting_id| !meeting_id.trim().is_empty())
        .unwrap_or(false)
}

fn has_completed_import_artifacts(folder_path: &Path) -> bool {
    transcript_file_has_segments(folder_path) || metadata_has_imported_meeting_id(folder_path)
}

fn read_recording_duration_seconds(folder_path: &Path) -> Option<f64> {
    let metadata_path = folder_path.join("metadata.json");
    let raw = fs::read_to_string(metadata_path).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&raw).ok()?;

    value
        .get("duration_seconds")
        .and_then(|duration| duration.as_f64())
        .filter(|duration| duration.is_finite() && *duration > 0.0)
}

fn ensure_recording_folder(folder_path: &Path) -> Result<(), String> {
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err("Recording folder no longer exists".to_string());
    }
    Ok(())
}

fn validate_recording_folder_path(
    recordings_root: &Path,
    folder_path: &Path,
    require_pending: bool,
) -> Result<PathBuf, String> {
    ensure_recording_folder(folder_path)?;
    let canonical_root = recordings_root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve recordings folder: {}", error))?;
    let canonical_folder = folder_path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve recording folder: {}", error))?;
    if canonical_folder.parent() != Some(canonical_root.as_path()) {
        return Err("Recording folder is outside the configured recordings folder".to_string());
    }
    if choose_audio_file(&canonical_folder).is_none() {
        return Err("Recording folder contains no supported audio file".to_string());
    }
    if require_pending && has_completed_import_artifacts(&canonical_folder) {
        return Err("Recording is no longer pending transcription".to_string());
    }
    Ok(canonical_folder)
}

async fn resolve_recording_folder<R: Runtime>(
    app: &AppHandle<R>,
    folder_path: &str,
    require_pending: bool,
) -> Result<PathBuf, String> {
    let preferences = load_recording_preferences(app)
        .await
        .map_err(|error| format!("Failed to load recording preferences: {}", error))?;
    validate_recording_folder_path(
        &preferences.save_folder,
        Path::new(folder_path),
        require_pending,
    )
}

fn read_recording_metadata(folder_path: &Path) -> Result<serde_json::Value, String> {
    ensure_recording_folder(folder_path)?;
    let metadata_path = folder_path.join(METADATA_FILE_NAME);
    if !metadata_path.exists() {
        return Ok(serde_json::Value::Object(serde_json::Map::new()));
    }

    let raw = fs::read_to_string(&metadata_path)
        .map_err(|error| format!("Failed to read recording metadata: {}", error))?;
    let value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|error| format!("Failed to parse recording metadata: {}", error))?;
    if !value.is_object() {
        return Err("Failed to parse recording metadata: root must be an object".to_string());
    }
    Ok(value)
}

fn read_recording_projects(folder_path: &Path) -> Result<Vec<RecordingProject>, String> {
    let metadata = read_recording_metadata(folder_path)?;
    let parsed_projects = metadata
        .get("projects")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| serde_json::from_value::<RecordingProject>(value.clone()).ok())
        .filter(|project| {
            !project.id.trim().is_empty()
                && !project.name.trim().is_empty()
                && !project.normalized_name.trim().is_empty()
        })
        .collect::<Vec<_>>();
    let mut projects = parsed_projects
        .into_iter()
        .map(|project| (project.id.clone(), project))
        .collect::<HashMap<_, _>>()
        .into_values()
        .collect::<Vec<_>>();
    projects.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(projects)
}

fn write_recording_projects(
    folder_path: &Path,
    projects: &[RecordingProject],
) -> Result<(), String> {
    let mut metadata = read_recording_metadata(folder_path)?;
    let object = metadata
        .as_object_mut()
        .ok_or_else(|| "Failed to parse recording metadata: root must be an object".to_string())?;
    object.insert(
        "projects".to_string(),
        serde_json::to_value(projects)
            .map_err(|error| format!("Failed to serialize recording projects: {}", error))?,
    );

    let metadata_path = folder_path.join(METADATA_FILE_NAME);
    let temporary_path = folder_path.join(format!(".metadata.json.{}.tmp", uuid::Uuid::new_v4()));
    let raw = serde_json::to_string_pretty(&metadata)
        .map_err(|error| format!("Failed to serialize recording metadata: {}", error))?;
    fs::write(&temporary_path, raw)
        .map_err(|error| format!("Failed to write recording metadata: {}", error))?;
    fs::rename(&temporary_path, &metadata_path)
        .map_err(|error| format!("Failed to replace recording metadata: {}", error))
}

fn assign_recording_project(
    folder_path: &Path,
    project: RecordingProject,
) -> Result<Vec<RecordingProject>, String> {
    let mut projects = read_recording_projects(folder_path)?;
    if let Some(existing) = projects
        .iter_mut()
        .find(|existing| existing.id == project.id)
    {
        *existing = project;
    } else {
        projects.push(project);
    }
    projects.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    write_recording_projects(folder_path, &projects)?;
    Ok(projects)
}

fn remove_recording_project(
    folder_path: &Path,
    project_id: &str,
) -> Result<Vec<RecordingProject>, String> {
    let mut projects = read_recording_projects(folder_path)?;
    projects.retain(|project| project.id != project_id);
    write_recording_projects(folder_path, &projects)?;
    Ok(projects)
}

async fn assign_recording_project_serialized(
    folder_path: &Path,
    project: RecordingProject,
) -> Result<Vec<RecordingProject>, String> {
    let _guard = RECORDING_PROJECT_OPERATION_LOCK.lock().await;
    assign_recording_project(folder_path, project)
}

async fn remove_recording_project_serialized(
    folder_path: &Path,
    project_id: &str,
) -> Result<Vec<RecordingProject>, String> {
    let _guard = RECORDING_PROJECT_OPERATION_LOCK.lock().await;
    remove_recording_project(folder_path, project_id)
}

async fn transfer_recording_projects(
    pool: &SqlitePool,
    folder_path: &Path,
    meeting_id: &str,
) -> Result<Vec<RecordingProject>, String> {
    ProjectRepository::list_for_meeting(pool, meeting_id)
        .await
        .map_err(|error| format!("Failed to validate target meeting: {}", error))?;
    let stored_projects = read_recording_projects(folder_path)?;
    let mut valid_projects = Vec::with_capacity(stored_projects.len());

    for stored in stored_projects {
        let Some(project) = ProjectRepository::get(pool, &stored.id)
            .await
            .map_err(|error| format!("Failed to load recording project: {}", error))?
        else {
            continue;
        };
        ProjectRepository::assign(pool, meeting_id, &project.id)
            .await
            .map_err(|error| format!("Failed to transfer recording project: {}", error))?;
        valid_projects.push(RecordingProject {
            id: project.id,
            name: project.name,
            normalized_name: project.normalized_name,
            color: project.color,
        });
    }

    valid_projects.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    write_recording_projects(folder_path, &valid_projects)?;
    Ok(valid_projects)
}

async fn transfer_recording_projects_serialized(
    pool: &SqlitePool,
    folder_path: &Path,
    meeting_id: &str,
) -> Result<Vec<RecordingProject>, String> {
    let _guard = RECORDING_PROJECT_OPERATION_LOCK.lock().await;
    transfer_recording_projects(pool, folder_path, meeting_id).await
}

fn read_audio_duration_seconds(audio_path: &Path) -> Option<f64> {
    extract_duration_from_metadata(audio_path)
        .ok()
        .filter(|duration| duration.is_finite() && *duration > 0.0)
}

fn is_unchanged(recording: &TranscribeLaterRecording, entry: &TranscribeLaterIndexEntry) -> bool {
    recording.audio_path == entry.audio_path
        && recording.size_bytes == entry.size_bytes
        && recording.modified_at_ms == entry.modified_at_ms
}

fn index_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    Ok(app_data_dir.join(INDEX_FILE_NAME))
}

fn read_index<R: Runtime>(app: &AppHandle<R>) -> TranscribeLaterIndex {
    let path = match index_path(app) {
        Ok(path) => path,
        Err(error) => {
            warn!("Failed to resolve transcribe later index path: {}", error);
            return TranscribeLaterIndex::default();
        }
    };

    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|error| {
            warn!("Failed to parse transcribe later index: {}", error);
            TranscribeLaterIndex::default()
        }),
        Err(_) => TranscribeLaterIndex::default(),
    }
}

fn write_index<R: Runtime>(app: &AppHandle<R>, index: &TranscribeLaterIndex) -> Result<(), String> {
    let path = index_path(app)?;
    let raw = serde_json::to_string_pretty(index)
        .map_err(|e| format!("Failed to serialize transcribe later index: {}", e))?;
    fs::write(&path, raw).map_err(|e| format!("Failed to write transcribe later index: {}", e))
}

fn scan_recordings_folder(
    recordings_folder: &Path,
    index: &TranscribeLaterIndex,
) -> Vec<TranscribeLaterRecording> {
    let mut recordings = fs::read_dir(recordings_folder)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(|entry| entry.ok()))
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .filter(|path| !has_completed_import_artifacts(path))
        .filter_map(|folder_path| {
            let audio_path = choose_audio_file(&folder_path)?;
            let metadata = fs::metadata(&audio_path).ok()?;
            let audio_path_string = audio_path.to_string_lossy().to_string();
            let index_entry = index.entries.get(&audio_path_string).cloned();
            let mut recording = TranscribeLaterRecording {
                id: audio_path_string.clone(),
                title: title_from_folder(&folder_path),
                folder_path: folder_path.to_string_lossy().to_string(),
                audio_path: audio_path_string,
                size_bytes: metadata.len(),
                modified_at_ms: modified_at_ms(&metadata),
                duration_seconds: read_recording_duration_seconds(&folder_path)
                    .or_else(|| read_audio_duration_seconds(&audio_path)),
                status: TranscribeLaterStatus::Pending,
                index_entry,
                projects: read_recording_projects(&folder_path).unwrap_or_else(|error| {
                    warn!(
                        "Failed to read projects for pending recording {}: {}",
                        folder_path.display(),
                        error
                    );
                    Vec::new()
                }),
            };

            if let Some(entry) = &recording.index_entry {
                recording.status = if is_unchanged(&recording, entry) {
                    entry.status.clone()
                } else {
                    TranscribeLaterStatus::Pending
                };
            }

            Some(recording)
        })
        .filter(|recording| recording.status == TranscribeLaterStatus::Pending)
        .collect::<Vec<_>>();

    recordings.sort_by(|a, b| b.modified_at_ms.cmp(&a.modified_at_ms));
    recordings
}

fn mark_recording_status<R: Runtime>(
    app: &AppHandle<R>,
    audio_path: String,
    size_bytes: u64,
    modified_at_ms: u64,
    status: TranscribeLaterStatus,
) -> Result<(), String> {
    let mut index = read_index(app);
    index.entries.insert(
        audio_path.clone(),
        TranscribeLaterIndexEntry {
            audio_path,
            size_bytes,
            modified_at_ms,
            status,
            updated_at_ms: now_ms(),
        },
    );
    write_index(app, &index)
}

fn ensure_audio_inside_folder(folder_path: &str, audio_path: &str) -> Result<PathBuf, String> {
    let folder = PathBuf::from(folder_path);
    if !folder.exists() || !folder.is_dir() {
        return Err("Recording folder no longer exists".to_string());
    }

    let audio = PathBuf::from(audio_path);
    if !audio.exists() || !audio.is_file() {
        return Err("Recording audio no longer exists".to_string());
    }

    let canonical_folder = folder
        .canonicalize()
        .map_err(|e| format!("Failed to resolve recording folder: {}", e))?;
    let canonical_audio = audio
        .canonicalize()
        .map_err(|e| format!("Failed to resolve recording audio: {}", e))?;

    if !canonical_audio.starts_with(&canonical_folder) {
        return Err("Recording audio is not inside the recording folder".to_string());
    }

    Ok(canonical_folder)
}

fn sanitize_recording_title(title: &str) -> Result<String, String> {
    let sanitized = title
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            {
                '-'
            } else {
                ch
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    let sanitized = sanitized.chars().take(120).collect::<String>();
    let sanitized = sanitized.trim_matches('.').trim().to_string();

    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        return Err("Recording title cannot be empty".to_string());
    }

    Ok(sanitized)
}

fn paths_refer_to_same_file(path: &Path, other: &Path) -> bool {
    match (path.canonicalize(), other.canonicalize()) {
        (Ok(path), Ok(other)) => path == other,
        _ => path == other,
    }
}

fn unique_child_path(
    parent: &Path,
    stem: &str,
    extension: Option<&str>,
    current_path: Option<&Path>,
) -> Result<PathBuf, String> {
    for index in 0..1000 {
        let name = match (index, extension) {
            (0, Some(ext)) => format!("{}.{}", stem, ext),
            (0, None) => stem.to_string(),
            (_, Some(ext)) => format!("{} ({}).{}", stem, index + 1, ext),
            (_, None) => format!("{} ({})", stem, index + 1),
        };
        let candidate = parent.join(name);

        if let Some(current) = current_path {
            if paths_refer_to_same_file(&candidate, current) {
                return Ok(candidate);
            }
        }

        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("Could not find an available recording name".to_string())
}

fn update_metadata_after_rename(
    folder_path: &Path,
    title: &str,
    audio_file_name: &str,
) -> Result<(), String> {
    let metadata_path = folder_path.join("metadata.json");
    if !metadata_path.exists() {
        return Ok(());
    }

    let raw = fs::read_to_string(&metadata_path)
        .map_err(|e| format!("Failed to read recording metadata: {}", e))?;
    let mut value =
        serde_json::from_str::<serde_json::Value>(&raw).unwrap_or_else(|_| serde_json::json!({}));

    if !value.is_object() {
        value = serde_json::json!({});
    }

    if let Some(object) = value.as_object_mut() {
        object.insert("meeting_name".to_string(), serde_json::json!(title));
        object.insert("title".to_string(), serde_json::json!(title));
        object.insert("audio_file".to_string(), serde_json::json!(audio_file_name));
    }

    let raw = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("Failed to serialize recording metadata: {}", e))?;
    fs::write(&metadata_path, raw)
        .map_err(|e| format!("Failed to update recording metadata: {}", e))
}

fn open_path_with_system(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", path])
            .spawn()
            .map_err(|e| format!("Failed to open path: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open path: {}", e))?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open path: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn list_pending_recordings_to_transcribe<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<TranscribeLaterRecording>, String> {
    let preferences = load_recording_preferences(&app)
        .await
        .map_err(|e| format!("Failed to load recording preferences: {}", e))?;

    if !preferences.save_folder.exists() {
        return Ok(Vec::new());
    }

    let index = read_index(&app);
    let recordings = scan_recordings_folder(&preferences.save_folder, &index);
    info!(
        "Found {} recordings pending transcription",
        recordings.len()
    );
    Ok(recordings)
}

#[tauri::command]
pub async fn assign_transcribe_later_recording_project<R: Runtime>(
    app: AppHandle<R>,
    folder_path: String,
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<RecordingProject>, String> {
    let recording_folder = resolve_recording_folder(&app, &folder_path, true).await?;
    let project = ProjectRepository::get(state.db_manager.pool(), &project_id)
        .await
        .map_err(|error| format!("Failed to load project: {}", error))?
        .ok_or_else(|| "Project not found".to_string())?;
    assign_recording_project_serialized(
        &recording_folder,
        RecordingProject {
            id: project.id,
            name: project.name,
            normalized_name: project.normalized_name,
            color: project.color,
        },
    )
    .await
}

#[tauri::command]
pub async fn remove_transcribe_later_recording_project<R: Runtime>(
    app: AppHandle<R>,
    folder_path: String,
    project_id: String,
) -> Result<Vec<RecordingProject>, String> {
    let recording_folder = resolve_recording_folder(&app, &folder_path, true).await?;
    remove_recording_project_serialized(&recording_folder, &project_id).await
}

#[tauri::command]
pub async fn transfer_transcribe_later_recording_projects<R: Runtime>(
    app: AppHandle<R>,
    folder_path: String,
    meeting_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<RecordingProject>, String> {
    let recording_folder = resolve_recording_folder(&app, &folder_path, false).await?;
    transfer_recording_projects_serialized(state.db_manager.pool(), &recording_folder, &meeting_id)
        .await
}

#[tauri::command]
pub async fn mark_recording_transcribed<R: Runtime>(
    app: AppHandle<R>,
    audio_path: String,
    size_bytes: u64,
    modified_at_ms: u64,
) -> Result<(), String> {
    mark_recording_status(
        &app,
        audio_path,
        size_bytes,
        modified_at_ms,
        TranscribeLaterStatus::Imported,
    )
}

#[tauri::command]
pub async fn hide_recording_from_transcribe_later<R: Runtime>(
    app: AppHandle<R>,
    audio_path: String,
    size_bytes: u64,
    modified_at_ms: u64,
) -> Result<(), String> {
    mark_recording_status(
        &app,
        audio_path,
        size_bytes,
        modified_at_ms,
        TranscribeLaterStatus::Hidden,
    )
}

#[tauri::command]
pub async fn open_transcribe_later_recording_folder(folder_path: String) -> Result<(), String> {
    let folder = PathBuf::from(&folder_path);
    if !folder.exists() || !folder.is_dir() {
        return Err("Recording folder no longer exists".to_string());
    }

    open_path_with_system(&folder_path)
}

#[tauri::command]
pub async fn play_transcribe_later_recording(audio_path: String) -> Result<(), String> {
    let audio = PathBuf::from(&audio_path);
    if !audio.exists() || !audio.is_file() {
        return Err("Recording audio no longer exists".to_string());
    }

    open_path_with_system(&audio_path)
}

#[cfg(test)]
mod recording_projects_tests {
    use super::*;
    use crate::database::repositories::project::ProjectRepository;
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;
    use tempfile::tempdir;

    fn project(id: &str, name: &str) -> RecordingProject {
        RecordingProject {
            id: id.to_string(),
            name: name.to_string(),
            normalized_name: name.to_lowercase(),
            color: "blue".to_string(),
        }
    }

    #[test]
    fn older_recording_project_metadata_defaults_to_blue() {
        let project: RecordingProject = serde_json::from_value(json!({
            "id": "project-1",
            "name": "YachtNet",
            "normalizedName": "yachtnet"
        }))
        .unwrap();

        assert_eq!(project.color, "blue");
    }

    #[test]
    fn recording_projects_preserve_metadata_and_are_idempotent() {
        let recording = tempdir().unwrap();
        fs::write(
            recording.path().join("metadata.json"),
            serde_json::to_vec_pretty(&json!({
                "custom_field": "preserved",
                "duration_seconds": 12.5
            }))
            .unwrap(),
        )
        .unwrap();

        let assigned = project("project-1", "Povolstav");
        assign_recording_project(recording.path(), assigned.clone()).unwrap();
        assign_recording_project(recording.path(), assigned.clone()).unwrap();

        assert_eq!(
            read_recording_projects(recording.path()).unwrap(),
            vec![assigned]
        );
        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(recording.path().join("metadata.json")).unwrap())
                .unwrap();
        assert_eq!(saved["custom_field"], json!("preserved"));
        assert_eq!(saved["duration_seconds"], json!(12.5));
        assert_eq!(saved["projects"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn recording_projects_are_sorted_and_removable() {
        let recording = tempdir().unwrap();
        assign_recording_project(recording.path(), project("z", "Yachtnet")).unwrap();
        assign_recording_project(recording.path(), project("a", "Optimum Cars")).unwrap();

        assert_eq!(
            read_recording_projects(recording.path())
                .unwrap()
                .into_iter()
                .map(|item| item.name)
                .collect::<Vec<_>>(),
            vec!["Optimum Cars", "Yachtnet"]
        );

        remove_recording_project(recording.path(), "a").unwrap();
        assert_eq!(
            read_recording_projects(recording.path()).unwrap(),
            vec![project("z", "Yachtnet")]
        );
    }

    #[test]
    fn recording_projects_ignore_malformed_entries() {
        let recording = tempdir().unwrap();
        fs::write(
            recording.path().join("metadata.json"),
            serde_json::to_vec_pretty(&json!({
                "projects": [
                    { "id": "valid", "name": "Valid", "normalizedName": "valid" },
                    { "id": 42, "name": false },
                    null
                ]
            }))
            .unwrap(),
        )
        .unwrap();

        assert_eq!(
            read_recording_projects(recording.path()).unwrap(),
            vec![project("valid", "Valid")]
        );
    }

    #[test]
    fn recording_projects_reject_non_directory_targets() {
        let recording = tempdir().unwrap();
        let file = recording.path().join("audio.mp4");
        fs::write(&file, b"audio").unwrap();

        let error = assign_recording_project(&file, project("p", "Project")).unwrap_err();
        assert!(error.contains("Recording folder no longer exists"));
    }

    #[tokio::test]
    async fn recording_project_assignments_are_serialized_without_lost_updates() {
        let recording = tempdir().unwrap();
        let folder = recording.path().to_path_buf();

        let (first, second) = tokio::join!(
            assign_recording_project_serialized(&folder, project("p1", "First")),
            assign_recording_project_serialized(&folder, project("p2", "Second")),
        );
        first.unwrap();
        second.unwrap();

        assert_eq!(read_recording_projects(&folder).unwrap().len(), 2);
    }

    #[test]
    fn recording_project_paths_must_be_supported_children_of_the_configured_root() {
        let recordings_root = tempdir().unwrap();
        let recording = recordings_root.path().join("Meeting");
        fs::create_dir(&recording).unwrap();
        fs::write(recording.join("audio.mp4"), b"audio").unwrap();

        assert_eq!(
            validate_recording_folder_path(recordings_root.path(), &recording, true).unwrap(),
            recording.canonicalize().unwrap()
        );

        let outside_root = tempdir().unwrap();
        let outside_recording = outside_root.path().join("Meeting");
        fs::create_dir(&outside_recording).unwrap();
        fs::write(outside_recording.join("audio.mp4"), b"audio").unwrap();
        assert!(
            validate_recording_folder_path(recordings_root.path(), &outside_recording, true)
                .unwrap_err()
                .contains("outside the configured recordings folder")
        );
    }

    #[tokio::test]
    async fn recording_projects_transfer_valid_projects_once_and_drop_stale_references() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for statement in [
            "CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, folder_path TEXT)",
            "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE, color TEXT NOT NULL DEFAULT 'blue', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
            "CREATE TABLE meeting_projects (meeting_id TEXT NOT NULL, project_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (meeting_id, project_id), FOREIGN KEY (meeting_id) REFERENCES meetings(id), FOREIGN KEY (project_id) REFERENCES projects(id))",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at) VALUES ('meeting-1', 'Meeting', '2026-08-03T00:00:00', '2026-08-03T00:00:00')")
            .execute(&pool)
            .await
            .unwrap();
        let first = ProjectRepository::create_or_get(&pool, "Povolstav")
            .await
            .unwrap();
        let second = ProjectRepository::create_or_get(&pool, "Yachtnet")
            .await
            .unwrap();

        let recording = tempdir().unwrap();
        write_recording_projects(
            recording.path(),
            &[
                RecordingProject {
                    id: first.id,
                    name: first.name,
                    normalized_name: first.normalized_name,
                    color: first.color,
                },
                RecordingProject {
                    id: second.id,
                    name: second.name,
                    normalized_name: second.normalized_name,
                    color: second.color,
                },
                project("deleted-project", "Deleted"),
            ],
        )
        .unwrap();

        let transferred = transfer_recording_projects(&pool, recording.path(), "meeting-1")
            .await
            .unwrap();
        transfer_recording_projects(&pool, recording.path(), "meeting-1")
            .await
            .unwrap();

        assert_eq!(transferred.len(), 2);
        assert_eq!(
            ProjectRepository::list_for_meeting(&pool, "meeting-1")
                .await
                .unwrap()
                .len(),
            2
        );
        assert_eq!(read_recording_projects(recording.path()).unwrap().len(), 2);
    }
}

#[tauri::command]
pub async fn delete_transcribe_later_recording(
    folder_path: String,
    audio_path: String,
) -> Result<(), String> {
    let folder = ensure_audio_inside_folder(&folder_path, &audio_path)?;
    fs::remove_dir_all(&folder).map_err(|e| format!("Failed to delete recording folder: {}", e))
}

#[tauri::command]
pub async fn rename_transcribe_later_recording(
    folder_path: String,
    audio_path: String,
    title: String,
) -> Result<(), String> {
    let folder = ensure_audio_inside_folder(&folder_path, &audio_path)?;
    let audio = PathBuf::from(&audio_path)
        .canonicalize()
        .map_err(|e| format!("Failed to resolve recording audio: {}", e))?;
    let sanitized_title = sanitize_recording_title(&title)?;
    let parent = folder
        .parent()
        .ok_or_else(|| "Recording folder has no parent directory".to_string())?;
    let target_folder = unique_child_path(parent, &sanitized_title, None, Some(&folder))?;

    let original_audio_file_name = audio
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Recording audio has no file name".to_string())?
        .to_string();

    if !paths_refer_to_same_file(&target_folder, &folder) {
        fs::rename(&folder, &target_folder)
            .map_err(|e| format!("Failed to rename recording folder: {}", e))?;
    }

    let audio_after_folder_rename = target_folder.join(&original_audio_file_name);
    let mut metadata_audio_file_name = original_audio_file_name.clone();

    if !original_audio_file_name.eq_ignore_ascii_case("audio.mp4") {
        let extension = audio_after_folder_rename
            .extension()
            .and_then(|ext| ext.to_str());
        let target_audio = unique_child_path(
            &target_folder,
            &sanitized_title,
            extension,
            Some(&audio_after_folder_rename),
        )?;

        if !paths_refer_to_same_file(&target_audio, &audio_after_folder_rename) {
            fs::rename(&audio_after_folder_rename, &target_audio)
                .map_err(|e| format!("Failed to rename recording audio: {}", e))?;
        }

        metadata_audio_file_name = target_audio
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Renamed recording audio has no file name".to_string())?
            .to_string();
    }

    update_metadata_after_rename(&target_folder, &sanitized_title, &metadata_audio_file_name)
}
