use super::coordinator::Decision;
use super::GoogleMeetState;
use serde::Serialize;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

pub const WINDOW_LABEL: &str = "google-meet-reminder";
pub const STATE_EVENT: &str = "google-meet-reminder-state";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderPayload {
    pub kind: String,
    pub session_id: Option<Uuid>,
    pub attempt: Option<u8>,
    pub message: Option<String>,
}

impl ReminderPayload {
    pub fn start(session_id: Uuid, attempt: u8) -> Self {
        Self {
            kind: "start".into(),
            session_id: Some(session_id),
            attempt: Some(attempt),
            message: None,
        }
    }

    pub fn stop(session_id: Uuid) -> Self {
        Self {
            kind: "stop".into(),
            session_id: Some(session_id),
            attempt: None,
            message: None,
        }
    }

    pub fn test() -> Self {
        Self {
            kind: "test".into(),
            session_id: None,
            attempt: None,
            message: None,
        }
    }

    pub fn error(session_id: Uuid, message: String) -> Self {
        Self {
            kind: "error".into(),
            session_id: Some(session_id),
            attempt: None,
            message: Some(message),
        }
    }
}

fn reminder_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        return Ok(window);
    }

    WebviewWindowBuilder::new(
        app,
        WINDOW_LABEL,
        WebviewUrl::App("google-meet-reminder.html".into()),
    )
    .title("Meetily")
    .inner_size(380.0, 210.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .center()
    .build()
    .map_err(|error| error.to_string())
}

pub fn show(app: &tauri::AppHandle, payload: ReminderPayload) -> Result<(), String> {
    let state = app.state::<GoogleMeetState>();
    *state
        .current_prompt
        .lock()
        .map_err(|error| error.to_string())? = Some(payload.clone());
    let window = reminder_window(app)?;
    window.show().map_err(|error| error.to_string())?;
    window
        .emit(STATE_EVENT, payload)
        .map_err(|error| error.to_string())
}

pub fn hide(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<GoogleMeetState>();
    *state
        .current_prompt
        .lock()
        .map_err(|error| error.to_string())? = None;
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn emit_current(app: &tauri::AppHandle) -> Result<(), String> {
    let payload = app
        .state::<GoogleMeetState>()
        .current_prompt
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    if let (Some(window), Some(payload)) = (app.get_webview_window(WINDOW_LABEL), payload) {
        window
            .emit(STATE_EVENT, payload)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn apply_decision(app: &tauri::AppHandle, decision: Decision) -> Result<(), String> {
    match decision {
        Decision::None => Ok(()),
        Decision::Hide => hide(app),
        Decision::ShowStart {
            session_id,
            attempt,
        } => show(app, ReminderPayload::start(session_id, attempt)),
        Decision::ShowStop { session_id } => show(app, ReminderPayload::stop(session_id)),
    }
}
