use super::protocol::MeetEvent;
use super::registration::{
    chrome_host_manifest_path, manifest_is_owned, read_preferences, remove_owned_host_manifest,
    replace_directory_atomically, write_host_manifest, write_preferences, IntegrationPreferences,
    CHROME_WEB_STORE_URL,
};
use super::window::{self, ReminderPayload};
use super::GoogleMeetState;
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::path::{Path, PathBuf};
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

pub fn refresh_installed_integration(app: &tauri::AppHandle) -> Result<(), String> {
    let (source, destination, preferences_path) = paths(app)?;
    if !read_preferences(&preferences_path).enabled || !destination.exists() {
        return Ok(());
    }
    if !source.join("manifest.json").exists() {
        return Err("Bundled Google Meet extension is missing".into());
    }
    replace_directory_atomically(&source, &destination).map_err(|error| error.to_string())?;
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    write_host_manifest(&chrome_host_manifest_path()?, &executable)
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
        Command::new("open")
            .arg("-a")
            .arg("Google Chrome")
            .arg(CHROME_WEB_STORE_URL)
            .spawn()
            .map_err(|error| format!("Failed to open Chrome Web Store: {error}"))?;
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

async fn process_event(app: &tauri::AppHandle, event: MeetEvent, ack_path: Option<PathBuf>) {
    let recording = crate::is_recording().await;
    let is_ping = event.event == super::protocol::MeetEventKind::IntegrationPing;
    let decision = if is_ping {
        Ok(super::coordinator::Decision::None)
    } else {
        app.state::<GoogleMeetState>()
            .coordinator
            .lock()
            .map_err(|error| error.to_string())
            .and_then(|mut coordinator| {
                coordinator
                    .accept(event, recording, Utc::now())
                    .map_err(|error| error.to_string())
            })
    };
    let result = match decision {
        Ok(decision) => window::apply_decision(app, decision),
        Err(error) => Err(error),
    };
    if result.is_ok() {
        if let Ok(mut last_seen_at) = app.state::<GoogleMeetState>().last_seen_at.lock() {
            *last_seen_at = Some(Utc::now());
        }
    }
    if let Err(error) = &result {
        log::warn!("Rejected Google Meet event: {error}");
    }
    if let Some(path) = ack_path {
        let acknowledgement = super::native_host::DeliveryAck {
            accepted: result.is_ok(),
            recording,
            error_code: result.err().map(|_| "event_rejected".to_string()),
        };
        if let Err(error) = super::native_host::write_delivery_ack(&path, &acknowledgement) {
            log::error!("Failed to acknowledge Google Meet event: {error}");
        }
    }
}

pub fn dispatch_event(app: tauri::AppHandle, event: MeetEvent, ack_path: Option<PathBuf>) {
    tauri::async_runtime::spawn(async move {
        process_event(&app, event, ack_path).await;
    });
}

fn dispatch_events(app: tauri::AppHandle, events: Vec<MeetEvent>) {
    tauri::async_runtime::spawn(async move {
        for event in events {
            process_event(&app, event, None).await;
        }
    });
}

pub fn drain_pending_events_with(
    queue_dir: &Path,
    now: DateTime<Utc>,
    mut dispatch: impl FnMut(MeetEvent),
) -> Result<usize, String> {
    let events = super::event_queue::drain_in(queue_dir, now).map_err(|error| error.to_string())?;
    let count = events.len();
    for event in events {
        dispatch(event);
    }
    Ok(count)
}

pub fn drain_pending_events(app: &tauri::AppHandle) -> Result<usize, String> {
    let mut events = Vec::new();
    drain_pending_events_with(&super::event_queue::queue_dir(), Utc::now(), |event| {
        events.push(event)
    })?;
    let count = events.len();
    if count > 0 {
        dispatch_events(app.clone(), events);
    }
    Ok(count)
}

pub fn start_coordinator_timer(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
        loop {
            interval.tick().await;
            if let Err(error) = drain_pending_events(&app) {
                log::error!("Failed to drain queued Google Meet events: {error}");
            }
            let recording = crate::is_recording().await;
            let backend_starting = crate::is_recording_starting();
            let decisions = match app.state::<GoogleMeetState>().coordinator.lock() {
                Ok(mut coordinator) => {
                    coordinator.tick_with_backend_start(recording, backend_starting, Utc::now())
                }
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
pub async fn start_google_meet_recording(
    app: tauri::AppHandle,
    state: State<'_, GoogleMeetState>,
    session_id: Uuid,
) -> Result<(), String> {
    if crate::is_recording().await {
        state
            .coordinator
            .lock()
            .map_err(|error| error.to_string())?
            .skip(session_id)
            .map_err(|error| error.to_string())?;
        return window::hide(&app);
    }
    state
        .coordinator
        .lock()
        .map_err(|error| error.to_string())?
        .begin_recording_start(session_id)
        .map_err(|error| error.to_string())?;
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Record Only main window is unavailable".to_string())?;
    let session_json = serde_json::to_string(&session_id).map_err(|error| error.to_string())?;
    if let Err(error) = main.eval(format!(
        "sessionStorage.setItem('googleMeetStartSession', {session_json});sessionStorage.setItem('autoStartRecording','true');window.location.assign('/');"
    )) {
        let _ = state
            .coordinator
            .lock()
            .map_err(|lock_error| lock_error.to_string())?
            .fail_recording_start(session_id);
        return Err(error.to_string());
    }
    window::hide(&app)
}

#[tauri::command]
pub fn complete_google_meet_recording_start(
    app: tauri::AppHandle,
    state: State<'_, GoogleMeetState>,
    session_id: Uuid,
) -> Result<(), String> {
    let decision = state
        .coordinator
        .lock()
        .map_err(|error| error.to_string())?
        .mark_recording_started(session_id)
        .map_err(|error| error.to_string())?;
    window::apply_decision(&app, decision)
}

#[tauri::command]
pub fn fail_google_meet_recording_start(
    app: tauri::AppHandle,
    state: State<'_, GoogleMeetState>,
    session_id: Uuid,
    message: String,
) -> Result<(), String> {
    let meeting_ended = state
        .coordinator
        .lock()
        .map_err(|error| error.to_string())?
        .fail_recording_start(session_id)
        .map_err(|error| error.to_string())?;
    if meeting_ended {
        window::hide(&app)
    } else {
        window::show(&app, ReminderPayload::error(session_id, message))
    }
}

#[tauri::command]
pub async fn stop_google_meet_recording(
    app: tauri::AppHandle,
    state: State<'_, GoogleMeetState>,
    session_id: Uuid,
) -> Result<(), String> {
    state
        .coordinator
        .lock()
        .map_err(|error| error.to_string())?
        .authorize_stop(session_id)
        .map_err(|error| error.to_string())?;
    if !crate::is_recording().await {
        return Err("Recording is no longer active".into());
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
        .ok_or_else(|| "Record Only main window is unavailable".to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())?;
    window::hide(&app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::google_meet::protocol::{MeetEventKind, PROTOCOL_VERSION};
    use chrono::TimeZone;

    fn event(sequence: u64, second: u32) -> MeetEvent {
        MeetEvent {
            protocol_version: PROTOCOL_VERSION,
            extension_version: "0.1.1".into(),
            event: MeetEventKind::Heartbeat,
            session_id: Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap(),
            sequence,
            occurred_at: Utc.with_ymd_and_hms(2026, 8, 14, 20, 0, second).unwrap(),
        }
    }

    #[test]
    fn drains_only_valid_events_in_protocol_order() {
        let temp = tempfile::tempdir().unwrap();
        super::super::event_queue::enqueue_in(temp.path(), &event(2, 2)).unwrap();
        super::super::event_queue::enqueue_in(temp.path(), &event(1, 1)).unwrap();
        std::fs::write(temp.path().join("invalid.json"), b"not-json").unwrap();
        let mut dispatched = Vec::new();

        let count = drain_pending_events_with(
            temp.path(),
            Utc.with_ymd_and_hms(2026, 8, 14, 20, 2, 0).unwrap(),
            |event| dispatched.push(event.sequence),
        )
        .unwrap();

        assert_eq!(count, 2);
        assert_eq!(dispatched, vec![1, 2]);
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    }
}
