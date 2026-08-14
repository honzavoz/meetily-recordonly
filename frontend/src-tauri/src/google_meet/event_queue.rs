use super::protocol::MeetEvent;
use chrono::{DateTime, Utc};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;
use uuid::Uuid;

const QUEUE_DIRECTORY_NAME: &str = "meetily-google-meet-events";
const STAGING_MAX_AGE: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, thiserror::Error)]
pub enum EventQueueError {
    #[error("Google Meet event queue I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("Google Meet event serialization failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Google Meet event queue path is not a private directory")]
    UnsafeQueueDirectory,
}

pub fn queue_dir() -> PathBuf {
    std::env::temp_dir().join(QUEUE_DIRECTORY_NAME)
}

fn ensure_queue_dir(path: &Path) -> Result<(), EventQueueError> {
    if path.exists() {
        let metadata = fs::symlink_metadata(path)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(EventQueueError::UnsafeQueueDirectory);
        }
    } else {
        fs::create_dir_all(path)?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }

    Ok(())
}

fn create_private_file(path: &Path) -> Result<File, std::io::Error> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

pub fn enqueue(event: &MeetEvent) -> Result<PathBuf, EventQueueError> {
    enqueue_in(&queue_dir(), event)
}

pub fn enqueue_in(queue_dir: &Path, event: &MeetEvent) -> Result<PathBuf, EventQueueError> {
    ensure_queue_dir(queue_dir)?;
    let id = Uuid::new_v4();
    let staging = queue_dir.join(format!("{id}.json.staging"));
    let destination = queue_dir.join(format!("{id}.json"));
    let payload = serde_json::to_vec(event)?;

    let mut file = create_private_file(&staging)?;
    file.write_all(&payload)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&staging, &destination)?;
    let _ = File::open(queue_dir).and_then(|directory| directory.sync_all());
    Ok(destination)
}

pub fn drain(now: DateTime<Utc>) -> Result<Vec<MeetEvent>, EventQueueError> {
    drain_in(&queue_dir(), now)
}

pub fn drain_in(queue_dir: &Path, now: DateTime<Utc>) -> Result<Vec<MeetEvent>, EventQueueError> {
    if !queue_dir.exists() {
        return Ok(Vec::new());
    }
    ensure_queue_dir(queue_dir)?;

    let mut events = Vec::new();
    for entry in fs::read_dir(queue_dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if !file_type.is_file() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();

        if name.ends_with(".json.staging") {
            let stale = entry
                .metadata()?
                .modified()?
                .elapsed()
                .is_ok_and(|age| age > STAGING_MAX_AGE);
            if stale {
                let _ = fs::remove_file(path);
            }
            continue;
        }
        if !name.ends_with(".json") {
            continue;
        }

        let payload = match fs::read(&path) {
            Ok(payload) => payload,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        let parsed = serde_json::from_slice::<MeetEvent>(&payload)
            .ok()
            .filter(|event| event.validate(now).is_ok());
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        if let Some(event) = parsed {
            events.push(event);
        }
    }

    events.sort_by(|left, right| {
        left.occurred_at
            .cmp(&right.occurred_at)
            .then_with(|| left.session_id.as_bytes().cmp(right.session_id.as_bytes()))
            .then_with(|| left.sequence.cmp(&right.sequence))
    });
    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::google_meet::protocol::{MeetEvent, MeetEventKind, PROTOCOL_VERSION};
    use chrono::{Duration, TimeZone, Utc};
    use std::fs;
    use uuid::Uuid;

    fn event(session_id: Uuid, sequence: u64, second: u32) -> MeetEvent {
        MeetEvent {
            protocol_version: PROTOCOL_VERSION,
            extension_version: "0.1.1".into(),
            event: MeetEventKind::MeetingJoined,
            session_id,
            sequence,
            occurred_at: Utc.with_ymd_and_hms(2026, 8, 14, 20, 0, second).unwrap(),
        }
    }

    #[test]
    fn atomically_round_trips_events_in_protocol_order() {
        let temp = tempfile::tempdir().unwrap();
        let session_id = Uuid::new_v4();
        let second = event(session_id, 2, 2);
        let first = event(session_id, 1, 1);

        enqueue_in(temp.path(), &second).unwrap();
        enqueue_in(temp.path(), &first).unwrap();

        let names = fs::read_dir(temp.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(names.len(), 2);
        assert!(names.iter().all(|name| name.ends_with(".json")));
        assert!(names.iter().all(|name| !name.ends_with(".staging")));

        let drained = drain_in(
            temp.path(),
            Utc.with_ymd_and_hms(2026, 8, 14, 20, 2, 0).unwrap(),
        )
        .unwrap();
        assert_eq!(
            drained
                .iter()
                .map(|event| event.sequence)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 0);
    }

    #[test]
    fn removes_malformed_and_stale_items_without_dispatching_them() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("malformed.json"), b"not-json").unwrap();
        let stale = event(Uuid::new_v4(), 1, 1);
        fs::write(
            temp.path().join("stale.json"),
            serde_json::to_vec(&stale).unwrap(),
        )
        .unwrap();

        let drained = drain_in(temp.path(), stale.occurred_at + Duration::minutes(11)).unwrap();
        assert!(drained.is_empty());
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 0);
    }

    #[test]
    fn ignores_staging_files() {
        let temp = tempfile::tempdir().unwrap();
        let queued = event(Uuid::new_v4(), 1, 1);
        fs::write(
            temp.path().join("unfinished.json.staging"),
            serde_json::to_vec(&queued).unwrap(),
        )
        .unwrap();

        let drained = drain_in(temp.path(), queued.occurred_at).unwrap();
        assert!(drained.is_empty());
        assert!(temp.path().join("unfinished.json.staging").exists());
    }
}
