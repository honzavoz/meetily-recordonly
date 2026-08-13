use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

pub const PROTOCOL_VERSION: u8 = 1;

pub fn is_native_host_invocation(args: &[String]) -> bool {
    args.iter()
        .any(|arg| arg == "--chrome-native-host" || arg == super::registration::EXTENSION_ORIGIN)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MeetEventKind {
    MeetingJoined,
    MeetingLeft,
    Heartbeat,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeetEvent {
    pub protocol_version: u8,
    pub extension_version: String,
    pub event: MeetEventKind,
    pub session_id: Uuid,
    pub sequence: u64,
    pub occurred_at: DateTime<Utc>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ProtocolError {
    #[error("unsupported Google Meet protocol version")]
    UnsupportedVersion,
    #[error("event sequence must be greater than zero")]
    InvalidSequence,
    #[error("event timestamp is outside the allowed clock skew")]
    StaleTimestamp,
    #[error("missing Google Meet event payload")]
    MissingPayload,
    #[error("invalid Google Meet event payload: {0}")]
    InvalidPayload(String),
    #[error("invalid Google Meet delivery acknowledgement path")]
    InvalidAckPath,
}

pub fn parse_google_meet_ack_arg(args: &[String]) -> Result<Option<PathBuf>, ProtocolError> {
    let Some(position) = args.iter().position(|arg| arg == "--google-meet-ack") else {
        return Ok(None);
    };
    let raw = args
        .get(position + 1)
        .ok_or(ProtocolError::InvalidAckPath)?;
    let path = PathBuf::from(raw);
    let valid_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.starts_with("meetily-google-meet-ack-") && name.ends_with(".json")
        });
    if path.parent() != Some(std::env::temp_dir().as_path()) || !valid_name {
        return Err(ProtocolError::InvalidAckPath);
    }
    Ok(Some(path))
}

impl MeetEvent {
    pub fn validate(&self, now: DateTime<Utc>) -> Result<(), ProtocolError> {
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(ProtocolError::UnsupportedVersion);
        }
        if self.sequence == 0 {
            return Err(ProtocolError::InvalidSequence);
        }
        if (now - self.occurred_at).num_seconds().abs() > 10 * 60 {
            return Err(ProtocolError::StaleTimestamp);
        }
        Ok(())
    }
}

pub fn parse_google_meet_event_arg(args: &[String]) -> Result<Option<MeetEvent>, ProtocolError> {
    let Some(position) = args.iter().position(|arg| arg == "--google-meet-event") else {
        return Ok(None);
    };
    let payload = args
        .get(position + 1)
        .ok_or(ProtocolError::MissingPayload)?;
    let event: MeetEvent = serde_json::from_str(payload)
        .map_err(|error| ProtocolError::InvalidPayload(error.to_string()))?;
    event.validate(Utc::now())?;
    Ok(Some(event))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    const VALID: &str = r#"{"protocolVersion":1,"extensionVersion":"0.1.0","event":"meeting_joined","sessionId":"550e8400-e29b-41d4-a716-446655440000","sequence":1,"occurredAt":"2026-08-13T12:00:00Z"}"#;

    #[test]
    fn accepts_a_current_supported_event() {
        let event: MeetEvent = serde_json::from_str(VALID).unwrap();
        assert_eq!(
            event.validate(Utc.with_ymd_and_hms(2026, 8, 13, 12, 5, 0).unwrap()),
            Ok(())
        );
    }

    #[test]
    fn rejects_unsupported_versions() {
        let mut event: MeetEvent = serde_json::from_str(VALID).unwrap();
        event.protocol_version = 2;
        assert_eq!(
            event.validate(event.occurred_at),
            Err(ProtocolError::UnsupportedVersion)
        );
    }

    #[test]
    fn rejects_zero_sequence_and_stale_timestamps() {
        let mut event: MeetEvent = serde_json::from_str(VALID).unwrap();
        event.sequence = 0;
        assert_eq!(
            event.validate(event.occurred_at),
            Err(ProtocolError::InvalidSequence)
        );
        event.sequence = 1;
        assert_eq!(
            event.validate(Utc.with_ymd_and_hms(2026, 8, 13, 12, 11, 0).unwrap()),
            Err(ProtocolError::StaleTimestamp),
        );
    }

    #[test]
    fn rejects_unknown_events_and_malformed_session_ids() {
        assert!(serde_json::from_str::<MeetEvent>(
            &VALID.replace("meeting_joined", "meeting_started")
        )
        .is_err());
        assert!(serde_json::from_str::<MeetEvent>(
            &VALID.replace("550e8400-e29b-41d4-a716-446655440000", "not-a-uuid")
        )
        .is_err());
    }

    #[test]
    fn parses_only_the_explicit_event_argument() {
        let args = vec!["Meetily".into(), "--google-meet-event".into(), VALID.into()];
        let parsed: MeetEvent = serde_json::from_str(VALID).unwrap();
        assert!(parsed.validate(parsed.occurred_at).is_ok());
        assert!(parse_google_meet_event_arg_at(&args, parsed.occurred_at)
            .unwrap()
            .is_some());
        assert!(parse_google_meet_event_arg(&["Meetily".into()])
            .unwrap()
            .is_none());
        assert!(
            parse_google_meet_event_arg(&["Meetily".into(), "--google-meet-event".into()]).is_err()
        );
    }

    #[test]
    fn recognizes_only_the_expected_native_host_launch() {
        assert!(is_native_host_invocation(&[
            "Meetily".into(),
            super::super::registration::EXTENSION_ORIGIN.into(),
        ]));
        assert!(!is_native_host_invocation(&[
            "Meetily".into(),
            "chrome-extension://untrusted/".into(),
        ]));
    }

    #[test]
    fn accepts_only_native_ack_files_created_in_the_temp_directory() {
        let valid = std::env::temp_dir().join("meetily-google-meet-ack-550e8400.json");
        let args = vec![
            "Meetily".into(),
            "--google-meet-ack".into(),
            valid.to_string_lossy().into_owned(),
        ];
        assert_eq!(parse_google_meet_ack_arg(&args).unwrap(), Some(valid));

        let invalid = vec![
            "Meetily".into(),
            "--google-meet-ack".into(),
            "/tmp/../victim.json".into(),
        ];
        assert!(parse_google_meet_ack_arg(&invalid).is_err());
    }

    fn parse_google_meet_event_arg_at(
        args: &[String],
        now: chrono::DateTime<Utc>,
    ) -> Result<Option<MeetEvent>, ProtocolError> {
        let Some(position) = args.iter().position(|arg| arg == "--google-meet-event") else {
            return Ok(None);
        };
        let payload = args
            .get(position + 1)
            .ok_or(ProtocolError::MissingPayload)?;
        let event: MeetEvent = serde_json::from_str(payload)
            .map_err(|error| ProtocolError::InvalidPayload(error.to_string()))?;
        event.validate(now)?;
        Ok(Some(event))
    }
}
