use super::protocol::MeetEvent;
use super::registration::{
    chrome_host_manifest_path, manifest_is_owned, read_preferences, remove_owned_host_manifest,
    replace_directory_atomically, write_host_manifest, write_preferences, IntegrationPreferences,
};
use super::window::{self, ReminderPayload};
use super::GoogleMeetState;
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use tauri::{Manager, State};
use uuid::Uuid;

const PREFERENCES_FILE: &str = "google_meet_integration.json";
const EXTENSION_DIRECTORY: &str = "google-meet-chrome-extension";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleMeetIntegrationStatus {
    pub enabled: bool,
    pub extension_path: Option<String>,
    pub native_host_registered: bool,
    pub last_seen_at: Option<DateTime<Utc>>,
}

fn paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let resource = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    Ok((
        resource.join("chrome-extension"),
        app_data.join(EXTENSION_DIRECTORY),
        app_data.join(PREFERENCES_FILE),
    ))
}

fn integration_status(app: &tauri::AppHandle) -> Result<GoogleMeetIntegrationStatus, String> {
    let (_, extension, preferences_path) = paths(app)?;
    let enabled = read_preferences(&preferences_path).enabled;
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let native_host_registered = std::fs::read(chrome_host_manifest_path()?)
        .ok()
        .and_then(|data| serde_json::from_slice(&data).ok())
        .is_some_and(|manifest| manifest_is_owned(&manifest, &executable));
    let last_seen_at = app
        .state::<GoogleMeetState>()
        .last_seen_at
        .lock()
        .map_err(|error| error.to_string())?
        .to_owned();
    Ok(GoogleMeetIntegrationStatus {
        enabled,
        extension_path: extension
            .exists()
            .then(|| extension.to_string_lossy().to_string()),
        native_host_registered,
        last_seen_at,
    })
}

#[tauri::command]
pub fn install_google_meet_integration(
    app: tauri::AppHandle,
) -> Result<GoogleMeetIntegrationStatus, String> {
    let (source, destination, preferences_path) = paths(&app)?;
    if !source.join("manifest.json").exists() {
        return Err("Bundled Google Meet extension is missing".into());
    }
    replace_directory_atomically(&source, &destination).map_err(|error| error.to_string())?;
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    write_host_manifest(&chrome_host_manifest_path()?, &executable)?;
    write_preferences(&preferences_path, &IntegrationPreferences { enabled: true })?;

    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open")
            .arg("-R")
            .arg(destination.join("manifest.json"))
            .spawn();
        let _ = Command::new("open")
            .arg("-a")
            .arg("Google Chrome")
            .arg("chrome://extensions")
            .spawn();
    }

    integration_status(&app)
}

#[tauri::command]
pub fn set_google_meet_integration_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<GoogleMeetIntegrationStatus, String> {
    let (_, _, preferences_path) = paths(&app)?;
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    if enabled {
        let status = install_google_meet_integration(app.clone())?;
        return Ok(status);
    }

    remove_owned_host_manifest(&chrome_host_manifest_path()?, &executable)?;
    write_preferences(
        &preferences_path,
        &IntegrationPreferences { enabled: false },
    )?;
    app.state::<GoogleMeetState>()
        .coordinator
        .lock()
        .map_err(|error| error.to_string())?
        .clear();
    window::hide(&app)?;
    integration_status(&app)
}

#[tauri::command]
pub fn get_google_meet_integration_status(
    app: tauri::AppHandle,
) -> Result<GoogleMeetIntegrationStatus, String> {
    integration_status(&app)
}

pub fn dispatch_event(app: tauri::AppHandle, event: MeetEvent) {
    tauri::async_runtime::spawn(async move {
        let recording = crate::is_recording().await;
        if let Ok(mut last_seen_at) = app.state::<GoogleMeetState>().last_seen_at.lock() {
            *last_seen_at = Some(Utc::now());
        }
        let decision = app
            .state::<GoogleMeetState>()
            .coordinator
            .lock()
            .map_err(|error| error.to_string())
            .and_then(|mut coordinator| {
                coordinator
                    .accept(event, recording, Utc::now())
                    .map_err(|error| error.to_string())
            });
        match decision {
            Ok(decision) => {
                if let Err(error) = window::apply_decision(&app, decision) {
                    log::error!("Failed to apply Google Meet reminder: {error}");
                }
            }
            Err(error) => log::warn!("Rejected Google Meet event: {error}"),
        }
    });
}

pub fn start_coordinator_timer(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
        loop {
            interval.tick().await;
            let recording = crate::is_recording().await;
            let decisions = match app.state::<GoogleMeetState>().coordinator.lock() {
                Ok(mut coordinator) => coordinator.tick(recording, Utc::now()),
                Err(error) => {
                    log::error!("Google Meet coordinator lock failed: {error}");
                    continue;
                }
            };
            for decision in decisions {
                if let Err(error) = window::apply_decision(&app, decision) {
                    log::error!("Failed to update Google Meet reminder: {error}");
                }
            }
        }
    });
}

#[tauri::command]
pub fn google_meet_reminder_ready(app: tauri::AppHandle) -> Result<(), String> {
    window::emit_current(&app)
}

#[tauri::command]
pub fn skip_google_meet_reminder(
    app: tauri::AppHandle,
    state: State<'_, GoogleMeetState>,
    session_id: Uuid,
) -> Result<(), String> {
    state
        .coordinator
        .lock()
        .map_err(|error| error.to_string())?
        .skip(session_id)
        .map_err(|error| error.to_string())?;
    window::hide(&app)
}

#[tauri::command]
pub fn start_google_meet_recording(
    app: tauri::AppHandle,
    state: State<'_, GoogleMeetState>,
    session_id: Uuid,
) -> Result<(), String> {
    if !state
        .coordinator
        .lock()
        .map_err(|error| error.to_string())?
        .has_session(session_id)
    {
        return Err("Google Meet session is no longer active".into());
    }
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Meetily main window is unavailable".to_string())?;
    let session_json = serde_json::to_string(&session_id).map_err(|error| error.to_string())?;
    main.eval(format!(
        "sessionStorage.setItem('googleMeetStartSession', {session_json});sessionStorage.setItem('autoStartRecording','true');window.location.assign('/');"
    )).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn complete_google_meet_recording_start(
    app: tauri::AppHandle,
    state: State<'_, GoogleMeetState>,
    session_id: Uuid,
) -> Result<(), String> {
    state
        .coordinator
        .lock()
        .map_err(|error| error.to_string())?
        .mark_recording_started(session_id)
        .map_err(|error| error.to_string())?;
    window::hide(&app)
}

#[tauri::command]
pub fn fail_google_meet_recording_start(
    app: tauri::AppHandle,
    state: State<'_, GoogleMeetState>,
    session_id: Uuid,
    message: String,
) -> Result<(), String> {
    if !state
        .coordinator
        .lock()
        .map_err(|error| error.to_string())?
        .has_session(session_id)
    {
        return Err("Google Meet session is no longer active".into());
    }
    window::show(&app, ReminderPayload::error(session_id, message))
}

#[tauri::command]
pub async fn stop_google_meet_recording(
    app: tauri::AppHandle,
    state: State<'_, GoogleMeetState>,
    session_id: Uuid,
) -> Result<(), String> {
    if !state
        .coordinator
        .lock()
        .map_err(|error| error.to_string())?
        .has_session(session_id)
    {
        return Err("Google Meet session is no longer active".into());
    }
    crate::tray::stop_recording_and_post_process(app.clone()).await?;
    state
        .coordinator
        .lock()
        .map_err(|error| error.to_string())?
        .complete_recording_stop(session_id)
        .map_err(|error| error.to_string())?;
    window::hide(&app)
}

#[tauri::command]
pub fn keep_google_meet_recording(
    app: tauri::AppHandle,
    state: State<'_, GoogleMeetState>,
    session_id: Uuid,
) -> Result<(), String> {
    state
        .coordinator
        .lock()
        .map_err(|error| error.to_string())?
        .keep_recording(session_id)
        .map_err(|error| error.to_string())?;
    window::hide(&app)
}

#[tauri::command]
pub fn show_google_meet_test_reminder(app: tauri::AppHandle) -> Result<(), String> {
    window::show(&app, ReminderPayload::test())
}

#[tauri::command]
pub fn dismiss_google_meet_test_reminder(app: tauri::AppHandle) -> Result<(), String> {
    window::hide(&app)
}

#[tauri::command]
pub fn open_meetily_from_reminder(app: tauri::AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Meetily main window is unavailable".to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())?;
    window::hide(&app)
}
