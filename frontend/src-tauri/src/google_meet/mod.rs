pub mod commands;
pub mod coordinator;
pub mod event_queue;
pub mod native_host;
pub mod protocol;
pub mod registration;
pub mod window;

use chrono::{DateTime, Utc};
use coordinator::Coordinator;
use std::sync::Mutex;

#[derive(Default)]
pub struct GoogleMeetState {
    pub coordinator: Mutex<Coordinator>,
    pub current_prompt: Mutex<Option<window::ReminderPayload>>,
    pub last_seen_at: Mutex<Option<DateTime<Utc>>>,
}
