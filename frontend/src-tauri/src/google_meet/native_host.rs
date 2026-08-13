use super::protocol::MeetEvent;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::process::Command;

const MAX_MESSAGE_BYTES: usize = 16 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum NativeHostError {
    #[error("native message exceeds 16 KiB")]
    TooLarge,
    #[error("native message I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("native message JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("native message failed validation: {0}")]
    Protocol(#[from] super::protocol::ProtocolError),
    #[error("failed to launch Meetily: {0}")]
    Launch(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeHostResponse {
    pub accepted: bool,
    pub recording: bool,
    pub app_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

impl NativeHostResponse {
    pub fn accepted(recording: bool, app_version: impl Into<String>) -> Self {
        Self {
            accepted: true,
            recording,
            app_version: app_version.into(),
            error_code: None,
        }
    }

    fn rejected(error_code: impl Into<String>) -> Self {
        Self {
            accepted: false,
            recording: false,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            error_code: Some(error_code.into()),
        }
    }
}

pub fn read_message(reader: &mut impl Read) -> Result<MeetEvent, NativeHostError> {
    let mut length_bytes = [0_u8; 4];
    reader.read_exact(&mut length_bytes)?;
    let length = u32::from_le_bytes(length_bytes) as usize;
    if length > MAX_MESSAGE_BYTES {
        return Err(NativeHostError::TooLarge);
    }

    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload)?;
    Ok(serde_json::from_slice(&payload)?)
}

pub fn write_message(
    writer: &mut impl Write,
    response: &NativeHostResponse,
) -> Result<(), NativeHostError> {
    let payload = serde_json::to_vec(response)?;
    writer.write_all(&(payload.len() as u32).to_le_bytes())?;
    writer.write_all(&payload)?;
    writer.flush()?;
    Ok(())
}

fn deliver(event: &MeetEvent) -> Result<(), NativeHostError> {
    let executable = std::env::current_exe()?;
    let payload = serde_json::to_string(event)?;
    Command::new(executable)
        .arg("--google-meet-event")
        .arg(payload)
        .spawn()
        .map_err(|error| NativeHostError::Launch(error.to_string()))?;
    Ok(())
}

pub fn run_stdio() -> i32 {
    let result = (|| -> Result<NativeHostResponse, NativeHostError> {
        let event = read_message(&mut std::io::stdin().lock())?;
        event.validate(Utc::now())?;
        deliver(&event)?;
        Ok(NativeHostResponse::accepted(
            false,
            env!("CARGO_PKG_VERSION"),
        ))
    })();

    let (response, exit_code) = match result {
        Ok(response) => (response, 0),
        Err(error) => {
            eprintln!("Meetily native host rejected message: {error}");
            (NativeHostResponse::rejected("invalid_native_message"), 1)
        }
    };

    if let Err(error) = write_message(&mut std::io::stdout().lock(), &response) {
        eprintln!("Meetily native host failed to write response: {error}");
        return 1;
    }
    exit_code
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_one_valid_native_message() {
        let json = br#"{"protocolVersion":1,"extensionVersion":"0.1.0","event":"meeting_joined","sessionId":"550e8400-e29b-41d4-a716-446655440000","sequence":1,"occurredAt":"2026-08-13T12:00:00Z"}"#;
        let mut frame = (json.len() as u32).to_le_bytes().to_vec();
        frame.extend_from_slice(json);
        let event = read_message(&mut frame.as_slice()).unwrap();
        assert_eq!(event.sequence, 1);
    }

    #[test]
    fn rejects_messages_over_16_kib() {
        let mut frame = (16_385_u32).to_le_bytes().to_vec();
        frame.resize(16_389, b'x');
        assert!(matches!(
            read_message(&mut frame.as_slice()),
            Err(NativeHostError::TooLarge)
        ));
    }

    #[test]
    fn writes_a_little_endian_response_frame() {
        let mut output = Vec::new();
        write_message(&mut output, &NativeHostResponse::accepted(false, "0.4.14")).unwrap();
        let length = u32::from_le_bytes(output[..4].try_into().unwrap()) as usize;
        assert_eq!(length, output.len() - 4);
    }
}
