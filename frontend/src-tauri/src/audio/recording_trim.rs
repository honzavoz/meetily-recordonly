use super::metadata::extract_duration_from_metadata;
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::UNIX_EPOCH;

pub struct TrimRequest {
    pub audio_path: PathBuf,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub size_bytes: u64,
    pub modified_at_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimResult {
    pub duration_seconds: f64,
    pub backup_path: String,
}

fn regular_file(path: &Path) -> Result<(), String> {
    let stat =
        fs::symlink_metadata(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    if !stat.file_type().is_file() {
        return Err(format!(
            "Expected a regular file, not a link or directory: {}",
            path.display()
        ));
    }
    Ok(())
}

fn unchanged(request: &TrimRequest) -> Result<(), String> {
    regular_file(&request.audio_path)?;
    let stat = fs::metadata(&request.audio_path).map_err(|e| e.to_string())?;
    let modified = stat
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    if stat.len() != request.size_bytes || modified != request.modified_at_ms {
        return Err("Recording changed. Close this dialog and open Trim again.".to_string());
    }
    Ok(())
}

fn same_contents(left: &Path, right: &Path) -> Result<bool, String> {
    let mut left = BufReader::new(fs::File::open(left).map_err(|e| e.to_string())?);
    let mut right = BufReader::new(fs::File::open(right).map_err(|e| e.to_string())?);
    let mut a = [0; 65536];
    let mut b = [0; 65536];
    loop {
        let n = left.read(&mut a).map_err(|e| e.to_string())?;
        if n == 0 {
            return Ok(right.read(&mut b).map_err(|e| e.to_string())? == 0);
        }
        if right.read_exact(&mut b[..n]).is_err() || a[..n] != b[..n] {
            return Ok(false);
        }
    }
}

// All replacements are prepared before the first rename. A failed rename restores
// files already replaced; the independent backup survives success and failure.
fn install_replacements(
    folder: &Path,
    staged: &Path,
    backup: &Path,
    names: &[PathBuf],
) -> Result<(), String> {
    for (index, name) in names.iter().enumerate() {
        if let Err(error) = fs::rename(staged.join(name), folder.join(name)) {
            let mut restore_errors = Vec::new();
            for previous in &names[..index] {
                let restore = staged.join(previous);
                let result = fs::copy(backup.join(previous), &restore)
                    .and_then(|_| fs::rename(&restore, folder.join(previous)));
                if let Err(error) = result {
                    restore_errors.push(error.to_string());
                }
            }
            return Err(format!(
                "Could not save trim: {error}. Original files are in {}. {}",
                backup.display(),
                if restore_errors.is_empty() {
                    "Previous files restored.".to_string()
                } else {
                    format!("Restore errors: {}", restore_errors.join("; "))
                }
            ));
        }
    }
    Ok(())
}

pub fn trim_recording(
    folder: &Path,
    request: &TrimRequest,
    ffmpeg: &Path,
) -> Result<TrimResult, String> {
    let folder = folder.canonicalize().map_err(|e| e.to_string())?;
    unchanged(request)?;
    let audio = request
        .audio_path
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if audio.parent() != Some(folder.as_path()) {
        return Err("Recording audio must be inside its recording folder".to_string());
    }
    let metadata_path = folder.join("metadata.json");
    regular_file(&metadata_path)?;
    let original_metadata = fs::read(&metadata_path).map_err(|e| e.to_string())?;
    let mut metadata: Value = serde_json::from_slice(&original_metadata)
        .map_err(|e| format!("Invalid recording metadata: {e}"))?;
    if metadata["status"] != "completed"
        || metadata["meeting_id"]
            .as_str()
            .is_some_and(|id| !id.trim().is_empty())
    {
        return Err("Only completed recordings awaiting transcription can be trimmed".to_string());
    }
    // Stream copying keeps the original quality. Native recordings use MP4/AAC;
    // retain the container and both names, including copy fallbacks to hardlinks.
    let extension = audio
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !matches!(extension.as_str(), "mp4" | "m4a") {
        return Err("Trim supports recorded MP4 and M4A audio".to_string());
    }
    let duration = extract_duration_from_metadata(&audio).map_err(|e| e.to_string())?;
    let (start, end) = (request.start_seconds, request.end_seconds);
    if !start.is_finite()
        || !end.is_finite()
        || !duration.is_finite()
        || start < 0.0
        || end <= start
        || end > duration
    {
        return Err("Choose a non-empty range within the recording duration".to_string());
    }
    let audio_name = PathBuf::from(audio.file_name().ok_or("Audio has no file name")?);
    let mut audio_names = vec![audio_name.clone()];
    // The metadata can refer to the readable name even if the caller selected audio.mp4.
    for name in [Some("audio.mp4"), metadata["audio_file"].as_str()]
        .into_iter()
        .flatten()
    {
        let name = PathBuf::from(name);
        if name.components().count() != 1 || name.file_name().is_none() {
            return Err("Invalid audio file name in recording metadata".to_string());
        }
        let candidate = folder.join(&name);
        if fs::symlink_metadata(&candidate).is_ok() && !audio_names.contains(&name) {
            regular_file(&candidate)?;
            if !same_contents(&audio, &candidate)? {
                return Err(
                    "Recording audio copies differ; original files were left unchanged".to_string(),
                );
            }
            audio_names.push(name);
        }
    }
    let backup_root = folder.join(".trim-backups");
    if let Ok(stat) = fs::symlink_metadata(&backup_root) {
        if !stat.file_type().is_dir() {
            return Err("Recording backup path is not a regular directory".to_string());
        }
    }
    let work = tempfile::Builder::new()
        .prefix(".trim-work-")
        .tempdir_in(&folder)
        .map_err(|e| e.to_string())?;
    let output = work.path().join(&audio_name);
    let mut command = Command::new(ffmpeg);
    command
        .stdin(Stdio::null())
        .args([
            "-nostdin",
            "-v",
            "error",
            "-n",
            "-ss",
            &format!("{start:.6}"),
            "-i",
        ])
        .arg(&audio)
        .args([
            "-t",
            &format!("{:.6}", end - start),
            "-map",
            "0:a:0",
            "-c:a",
            "copy",
            "-avoid_negative_ts",
            "make_zero",
            "-movflags",
            "+faststart",
        ])
        .arg(&output);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let result = command
        .output()
        .map_err(|e| format!("Could not start audio trim: {e}"))?;
    if !result.status.success() {
        return Err(format!(
            "Audio trim failed: {}",
            String::from_utf8_lossy(&result.stderr)
                .chars()
                .take(2000)
                .collect::<String>()
        ));
    }
    let actual_duration = extract_duration_from_metadata(&output)
        .map_err(|e| format!("Trimmed audio is invalid: {e}"))?;
    if !actual_duration.is_finite()
        || actual_duration <= 0.0
        || (actual_duration - (end - start)).abs() > 0.15
    {
        return Err(
            "Trimmed audio duration did not match the selection; original left unchanged"
                .to_string(),
        );
    }
    unchanged(request)?;
    if fs::read(&metadata_path).map_err(|e| e.to_string())? != original_metadata {
        return Err("Recording metadata changed during trim. Please try again.".to_string());
    }
    fs::create_dir_all(&backup_root).map_err(|e| format!("Could not create backup: {e}"))?;
    let backup = tempfile::Builder::new()
        .prefix("original-")
        .tempdir_in(&backup_root)
        .map_err(|e| e.to_string())?;
    let mut names = audio_names.clone();
    names.push(PathBuf::from("metadata.json"));
    for name in &names {
        fs::copy(folder.join(name), backup.path().join(name))
            .map_err(|e| format!("Could not back up recording: {e}"))?;
        fs::OpenOptions::new()
            .write(true)
            .open(backup.path().join(name))
            .and_then(|file| file.sync_all())
            .map_err(|e| e.to_string())?;
    }
    for name in audio_names.iter().skip(1) {
        fs::hard_link(&output, work.path().join(name))
            .or_else(|_| fs::copy(&output, work.path().join(name)).map(|_| ()))
            .map_err(|e| e.to_string())?;
    }
    metadata["duration_seconds"] = json!(actual_duration);
    metadata["last_trim"] = json!({ "start_seconds": start, "end_seconds": end, "backup": format!(".trim-backups/{}", backup.path().file_name().unwrap().to_string_lossy()) });
    fs::write(
        work.path().join("metadata.json"),
        serde_json::to_vec_pretty(&metadata).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    for name in &names {
        fs::OpenOptions::new()
            .write(true)
            .open(work.path().join(name))
            .and_then(|file| file.sync_all())
            .map_err(|e| e.to_string())?;
    }
    // Persist the backup before any original is replaced.
    let backup_path = backup.keep();
    install_replacements(&folder, work.path(), &backup_path, &names)?;
    Ok(TrimResult {
        duration_seconds: actual_duration,
        backup_path: backup_path.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::super::metadata::extract_duration_from_metadata;
    use super::*;
    use std::{fs, process::Command, time::UNIX_EPOCH};
    use tempfile::{tempdir, TempDir};

    fn ffmpeg() -> PathBuf {
        std::env::var_os("FFMPEG_TEST_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("ffmpeg"))
    }

    fn fixture() -> (TempDir, PathBuf, TrimRequest) {
        let root = tempdir().unwrap();
        let folder = root.path().join("Meeting");
        fs::create_dir(&folder).unwrap();
        let audio = folder.join("Meeting.mp4");
        let output = Command::new(ffmpeg())
            .args([
                "-nostdin",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000:duration=4",
                "-c:a",
                "aac",
            ])
            .arg(&audio)
            .output()
            .expect("Set FFMPEG_TEST_PATH to the bundled FFmpeg");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        fs::hard_link(&audio, folder.join("audio.mp4")).unwrap();
        fs::write(folder.join("metadata.json"), r#"{"status":"completed","audio_file":"Meeting.mp4","duration_seconds":4,"projects":[{"id":"p1"}],"meeting_name":"Meeting"}"#).unwrap();
        let request = request_for(&audio, 1.0, 3.0);
        (root, folder, request)
    }

    fn request_for(audio: &Path, start: f64, end: f64) -> TrimRequest {
        let stat = fs::metadata(audio).unwrap();
        TrimRequest {
            audio_path: audio.to_path_buf(),
            start_seconds: start,
            end_seconds: end,
            size_bytes: stat.len(),
            modified_at_ms: stat
                .modified()
                .unwrap()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        }
    }

    #[test]
    fn trims_audio_preserves_originals_and_updates_both_names_and_metadata() {
        let (_root, folder, request) = fixture();
        let original = fs::read(&request.audio_path).unwrap();
        let original_metadata = fs::read(folder.join("metadata.json")).unwrap();
        let result = trim_recording(&folder, &request, &ffmpeg()).unwrap();
        assert!((result.duration_seconds - 2.0).abs() < 0.1);
        assert!((extract_duration_from_metadata(&request.audio_path).unwrap() - 2.0).abs() < 0.1);
        assert_eq!(
            fs::read(&request.audio_path).unwrap(),
            fs::read(folder.join("audio.mp4")).unwrap()
        );
        assert_eq!(
            fs::read(Path::new(&result.backup_path).join("Meeting.mp4")).unwrap(),
            original
        );
        assert_eq!(
            fs::read(Path::new(&result.backup_path).join("metadata.json")).unwrap(),
            original_metadata
        );
        let metadata: serde_json::Value =
            serde_json::from_slice(&fs::read(folder.join("metadata.json")).unwrap()).unwrap();
        assert_eq!(metadata["projects"][0]["id"], "p1");
        assert_eq!(metadata["duration_seconds"], result.duration_seconds);
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            assert_eq!(
                fs::metadata(&request.audio_path).unwrap().ino(),
                fs::metadata(folder.join("audio.mp4")).unwrap().ino()
            );
        }
        let second = trim_recording(
            &folder,
            &request_for(&request.audio_path, 0.0, 1.0),
            &ffmpeg(),
        )
        .unwrap();
        assert_ne!(second.backup_path, result.backup_path);
        assert_eq!(
            fs::read(Path::new(&result.backup_path).join("Meeting.mp4")).unwrap(),
            original
        );
    }

    #[test]
    fn rejects_invalid_ranges_without_touching_the_recording() {
        let (_root, folder, mut request) = fixture();
        let original = fs::read(&request.audio_path).unwrap();
        for (start, end) in [
            (-1.0, 2.0),
            (2.0, 1.0),
            (1.0, 1.0),
            (0.0, 20.0),
            (f64::NAN, 2.0),
            (0.0, f64::INFINITY),
        ] {
            request.start_seconds = start;
            request.end_seconds = end;
            assert!(trim_recording(&folder, &request, &ffmpeg()).is_err());
            assert_eq!(fs::read(&request.audio_path).unwrap(), original);
        }
    }

    #[test]
    fn refuses_stale_recordings_and_unfinished_or_transcribed_metadata() {
        let (_root, folder, mut request) = fixture();
        request.size_bytes += 1;
        assert!(trim_recording(&folder, &request, &ffmpeg())
            .unwrap_err()
            .contains("changed"));
        request.size_bytes -= 1;
        for metadata in [
            r#"{"status":"recording"}"#,
            r#"{"status":"completed","meeting_id":"m1"}"#,
            "not json",
        ] {
            fs::write(folder.join("metadata.json"), metadata).unwrap();
            assert!(trim_recording(&folder, &request, &ffmpeg()).is_err());
        }
    }

    #[test]
    fn ffmpeg_failure_leaves_original_audio_and_metadata_untouched() {
        let (_root, folder, request) = fixture();
        let original = fs::read(&request.audio_path).unwrap();
        let metadata = fs::read(folder.join("metadata.json")).unwrap();
        assert!(trim_recording(&folder, &request, &folder.join("missing-ffmpeg")).is_err());
        assert_eq!(fs::read(&request.audio_path).unwrap(), original);
        assert_eq!(fs::read(folder.join("metadata.json")).unwrap(), metadata);
        assert!(!folder.join(".trim-backups").exists());
    }

    #[test]
    fn failed_install_restores_previously_replaced_files_and_keeps_backup() {
        let root = tempdir().unwrap();
        let folder = root.path().join("recording");
        let staged = root.path().join("staged");
        let backup = root.path().join("backup");
        for dir in [&folder, &staged, &backup] {
            fs::create_dir(dir).unwrap();
        }
        for name in ["audio.mp4", "metadata.json"] {
            fs::write(folder.join(name), b"original").unwrap();
            fs::write(backup.join(name), b"original").unwrap();
        }
        fs::write(staged.join("audio.mp4"), b"trimmed").unwrap();
        // Missing staged metadata makes the second rename fail after audio moved.
        assert!(install_replacements(
            &folder,
            &staged,
            &backup,
            &["audio.mp4".into(), "metadata.json".into()]
        )
        .is_err());
        assert_eq!(fs::read(folder.join("audio.mp4")).unwrap(), b"original");
        assert_eq!(fs::read(folder.join("metadata.json")).unwrap(), b"original");
        assert_eq!(fs::read(backup.join("audio.mp4")).unwrap(), b"original");
    }

    #[test]
    fn refuses_conflicting_audio_copy_without_overwriting_it() {
        let (_root, folder, request) = fixture();
        fs::remove_file(folder.join("audio.mp4")).unwrap();
        fs::write(folder.join("audio.mp4"), b"another recording").unwrap();
        assert!(trim_recording(&folder, &request, &ffmpeg()).is_err());
        assert_eq!(
            fs::read(folder.join("audio.mp4")).unwrap(),
            b"another recording"
        );
    }

    #[test]
    fn keeps_the_selected_audio_content_not_just_the_requested_length() {
        let (_root, folder, request) = fixture();
        // Four distinct one-second tones: 220, 440, 880, 1760 Hz.
        let output = Command::new(ffmpeg())
            .args([
                "-nostdin",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "aevalsrc=0.2*sin(2*PI*220*2^floor(t)*t):s=48000:d=4",
                "-c:a",
                "aac",
            ])
            .arg(&request.audio_path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let request = request_for(&request.audio_path, 1.0, 3.0);
        trim_recording(&folder, &request, &ffmpeg()).unwrap();
        let decoded = Command::new(ffmpeg())
            .args(["-nostdin", "-v", "error", "-i"])
            .arg(&request.audio_path)
            .args(["-f", "f32le", "-ac", "1", "-ar", "48000", "pipe:1"])
            .output()
            .unwrap();
        assert!(decoded.status.success());
        let samples: Vec<f32> = decoded
            .stdout
            .chunks_exact(4)
            .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
            .collect();
        for (offset, expected_hz) in [(14400, 440.0_f64), (62400, 880.0_f64)] {
            let crossings = samples[offset..offset + 19200]
                .windows(2)
                .filter(|pair| pair[0] <= 0.0 && pair[1] > 0.0)
                .count();
            assert!((crossings as f64 / 0.4 - expected_hz).abs() < 5.0);
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_in_audio_and_backup_paths() {
        use std::os::unix::fs::symlink;
        let (root, folder, request) = fixture();
        let outside = root.path().join("outside");
        fs::create_dir(&outside).unwrap();
        symlink(&outside, folder.join(".trim-backups")).unwrap();
        assert!(trim_recording(&folder, &request, &ffmpeg()).is_err());
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
        fs::remove_file(folder.join(".trim-backups")).unwrap();
        fs::remove_file(folder.join("audio.mp4")).unwrap();
        symlink(&request.audio_path, folder.join("audio.mp4")).unwrap();
        assert!(trim_recording(&folder, &request, &ffmpeg()).is_err());
    }
}
