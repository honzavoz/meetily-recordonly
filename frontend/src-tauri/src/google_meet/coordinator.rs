use crate::google_meet::protocol::{MeetEvent, MeetEventKind};
use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

const PROMPT_VISIBLE_SECONDS: i64 = 20;
const SECOND_PROMPT_AFTER_SECONDS: i64 = 50;
const SESSION_EXPIRY_HOURS: i64 = 6;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    None,
    ShowStart { session_id: Uuid, attempt: u8 },
    Hide,
    ShowStop { session_id: Uuid },
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CoordinatorError {
    #[error("Google Meet session is not active")]
    UnknownSession,
    #[error("Google Meet event sequence did not increase")]
    NonIncreasingSequence,
}

#[derive(Debug, Clone)]
struct Session {
    id: Uuid,
    last_sequence: u64,
    last_seen_at: DateTime<Utc>,
    first_prompt_at: Option<DateTime<Utc>>,
    visible_since: Option<DateTime<Utc>>,
    prompt_count: u8,
    skipped: bool,
    recording_owned: bool,
    ended: bool,
}

#[derive(Debug, Default)]
pub struct Coordinator {
    session: Option<Session>,
}

impl Coordinator {
    pub fn accept(
        &mut self,
        event: MeetEvent,
        recording: bool,
        now: DateTime<Utc>,
    ) -> Result<Decision, CoordinatorError> {
        if self
            .session
            .as_ref()
            .map_or(true, |session| session.id != event.session_id)
        {
            if event.event == MeetEventKind::MeetingLeft {
                return Ok(Decision::None);
            }
            self.session = Some(Session {
                id: event.session_id,
                last_sequence: event.sequence,
                last_seen_at: now,
                first_prompt_at: None,
                visible_since: None,
                prompt_count: 0,
                skipped: false,
                recording_owned: false,
                ended: false,
            });
        } else {
            let session = self.session.as_mut().expect("session initialized");
            if event.sequence <= session.last_sequence {
                return Err(CoordinatorError::NonIncreasingSequence);
            }
            session.last_sequence = event.sequence;
            session.last_seen_at = now;
        }

        let session = self.session.as_mut().expect("session initialized");
        match event.event {
            MeetEventKind::MeetingJoined | MeetEventKind::Heartbeat => {
                if recording || session.skipped || session.prompt_count > 0 {
                    return Ok(Decision::None);
                }
                session.prompt_count = 1;
                session.first_prompt_at = Some(now);
                session.visible_since = Some(now);
                Ok(Decision::ShowStart {
                    session_id: session.id,
                    attempt: 1,
                })
            }
            MeetEventKind::MeetingLeft => {
                session.ended = true;
                session.visible_since = None;
                if session.recording_owned && recording {
                    Ok(Decision::ShowStop {
                        session_id: session.id,
                    })
                } else {
                    self.session = None;
                    Ok(Decision::Hide)
                }
            }
        }
    }

    pub fn tick(&mut self, recording: bool, now: DateTime<Utc>) -> Vec<Decision> {
        let Some(session) = self.session.as_mut() else {
            return Vec::new();
        };

        if now - session.last_seen_at > Duration::hours(SESSION_EXPIRY_HOURS) {
            self.session = None;
            return vec![Decision::Hide];
        }

        if session.ended || session.skipped || session.recording_owned || recording {
            return Vec::new();
        }

        if let Some(visible_since) = session.visible_since {
            if now - visible_since >= Duration::seconds(PROMPT_VISIBLE_SECONDS) {
                session.visible_since = None;
                return vec![Decision::Hide];
            }
            return Vec::new();
        }

        if session.prompt_count == 1
            && session
                .first_prompt_at
                .is_some_and(|first| now - first >= Duration::seconds(SECOND_PROMPT_AFTER_SECONDS))
        {
            session.prompt_count = 2;
            session.visible_since = Some(now);
            return vec![Decision::ShowStart {
                session_id: session.id,
                attempt: 2,
            }];
        }

        Vec::new()
    }

    pub fn skip(&mut self, session_id: Uuid) -> Result<(), CoordinatorError> {
        let session = self.session_mut(session_id)?;
        session.skipped = true;
        session.visible_since = None;
        Ok(())
    }

    pub fn mark_recording_started(&mut self, session_id: Uuid) -> Result<(), CoordinatorError> {
        let session = self.session_mut(session_id)?;
        session.recording_owned = true;
        session.visible_since = None;
        Ok(())
    }

    pub fn fail_recording_start(&mut self, session_id: Uuid) -> Result<(), CoordinatorError> {
        let session = self.session_mut(session_id)?;
        session.visible_since = Some(Utc::now());
        Ok(())
    }

    pub fn keep_recording(&mut self, session_id: Uuid) -> Result<(), CoordinatorError> {
        self.session_mut(session_id)?;
        self.session = None;
        Ok(())
    }

    pub fn complete_recording_stop(&mut self, session_id: Uuid) -> Result<(), CoordinatorError> {
        self.keep_recording(session_id)
    }

    pub fn has_session(&self, session_id: Uuid) -> bool {
        self.session
            .as_ref()
            .is_some_and(|session| session.id == session_id)
    }

    pub fn clear(&mut self) {
        self.session = None;
    }

    fn session_mut(&mut self, session_id: Uuid) -> Result<&mut Session, CoordinatorError> {
        self.session
            .as_mut()
            .filter(|session| session.id == session_id)
            .ok_or(CoordinatorError::UnknownSession)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::google_meet::protocol::{MeetEvent, MeetEventKind, PROTOCOL_VERSION};
    use chrono::{Duration, TimeZone, Utc};

    fn at(seconds: i64) -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 8, 13, 12, 0, 0).unwrap() + Duration::seconds(seconds)
    }

    fn event(id: Uuid, sequence: u64, kind: MeetEventKind, seconds: i64) -> MeetEvent {
        MeetEvent {
            protocol_version: PROTOCOL_VERSION,
            extension_version: "0.1.0".into(),
            event: kind,
            session_id: id,
            sequence,
            occurred_at: at(seconds),
        }
    }

    #[test]
    fn joined_session_prompts_at_most_twice() {
        let mut coordinator = Coordinator::default();
        let id = Uuid::new_v4();
        assert_eq!(
            coordinator.accept(event(id, 1, MeetEventKind::MeetingJoined, 0), false, at(0)),
            Ok(Decision::ShowStart {
                session_id: id,
                attempt: 1
            }),
        );
        assert_eq!(
            coordinator.accept(event(id, 2, MeetEventKind::Heartbeat, 10), false, at(10)),
            Ok(Decision::None),
        );
        assert_eq!(coordinator.tick(false, at(20)), vec![Decision::Hide]);
        assert_eq!(
            coordinator.tick(false, at(50)),
            vec![Decision::ShowStart {
                session_id: id,
                attempt: 2
            }],
        );
        assert_eq!(coordinator.tick(false, at(70)), vec![Decision::Hide]);
        assert!(coordinator.tick(false, at(500)).is_empty());
    }

    #[test]
    fn stop_prompt_requires_reminder_owned_recording() {
        let mut coordinator = Coordinator::default();
        let id = Uuid::new_v4();
        coordinator
            .accept(event(id, 1, MeetEventKind::MeetingJoined, 0), false, at(0))
            .unwrap();
        coordinator.mark_recording_started(id).unwrap();
        assert_eq!(
            coordinator.accept(event(id, 2, MeetEventKind::MeetingLeft, 30), true, at(30)),
            Ok(Decision::ShowStop { session_id: id }),
        );
    }

    #[test]
    fn already_recording_and_skipped_sessions_do_not_prompt() {
        let mut coordinator = Coordinator::default();
        let id = Uuid::new_v4();
        assert_eq!(
            coordinator.accept(event(id, 1, MeetEventKind::MeetingJoined, 0), true, at(0)),
            Ok(Decision::None),
        );
        coordinator.skip(id).unwrap();
        assert!(coordinator.tick(false, at(60)).is_empty());
    }

    #[test]
    fn rejects_replayed_sequences_but_accepts_gaps() {
        let mut coordinator = Coordinator::default();
        let id = Uuid::new_v4();
        coordinator
            .accept(event(id, 1, MeetEventKind::MeetingJoined, 0), false, at(0))
            .unwrap();
        assert_eq!(
            coordinator.accept(event(id, 1, MeetEventKind::Heartbeat, 1), false, at(1)),
            Err(CoordinatorError::NonIncreasingSequence),
        );
        assert!(coordinator
            .accept(event(id, 4, MeetEventKind::Heartbeat, 2), false, at(2))
            .is_ok());
    }

    #[test]
    fn heartbeat_repairs_a_missing_join_and_sessions_expire() {
        let mut coordinator = Coordinator::default();
        let id = Uuid::new_v4();
        assert_eq!(
            coordinator.accept(event(id, 4, MeetEventKind::Heartbeat, 0), false, at(0)),
            Ok(Decision::ShowStart {
                session_id: id,
                attempt: 1
            }),
        );
        assert_eq!(
            coordinator.tick(false, at(6 * 60 * 60 + 1)),
            vec![Decision::Hide]
        );
        assert!(!coordinator.has_session(id));
    }
}
