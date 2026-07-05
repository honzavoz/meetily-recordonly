use super::constants::AUDIO_EXTENSIONS;
use super::import::extract_duration_from_metadata;
use super::recording_preferences::load_recording_preferences;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};

const INDEX_FILE_NAME: &str = "transcribe_later_index.json";

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
    let mut value = serde_json::from_str::<serde_json::Value>(&raw).unwrap_or_else(|_| {
        serde_json::json!({})
    });

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
    info!("Found {} recordings pending transcription", recordings.len());
    Ok(recordings)
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

#[tauri::command]
pub async fn delete_transcribe_later_recording(
    folder_path: String,
    audio_path: String,
) -> Result<(), String> {
    let folder = ensure_audio_inside_folder(&folder_path, &audio_path)?;
    fs::remove_dir_all(&folder)
        .map_err(|e| format!("Failed to delete recording folder: {}", e))
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
