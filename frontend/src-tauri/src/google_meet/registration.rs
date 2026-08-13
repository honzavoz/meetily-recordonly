use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const NATIVE_HOST_NAME: &str = "cz.honzavoz.meetily.recordonly.google_meet";
pub const EXTENSION_ID: &str = "fonilmfiddnidgjpcijiocffkbbeaddo";
pub const EXTENSION_ORIGIN: &str = "chrome-extension://fonilmfiddnidgjpcijiocffkbbeaddo/";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationPreferences {
    pub enabled: bool,
}

pub fn build_host_manifest(executable: &Path) -> Value {
    json!({
        "name": NATIVE_HOST_NAME,
        "description": "Meetily Google Meet recording reminder",
        "path": executable,
        "type": "stdio",
        "allowed_origins": [EXTENSION_ORIGIN],
    })
}

pub fn manifest_is_owned(value: &Value, executable: &Path) -> bool {
    value.get("name").and_then(Value::as_str) == Some(NATIVE_HOST_NAME)
        && value.get("path").and_then(Value::as_str) == executable.to_str()
        && value
            .get("allowed_origins")
            .and_then(Value::as_array)
            .is_some_and(|origins| {
                origins.len() == 1 && origins[0].as_str() == Some(EXTENSION_ORIGIN)
            })
}

fn copy_directory(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_directory(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

pub fn replace_directory_atomically(source: &Path, destination: &Path) -> io::Result<()> {
    let parent = destination
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "destination has no parent"))?;
    fs::create_dir_all(parent)?;

    let name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid destination name"))?;
    let staging = parent.join(format!("{name}.staging"));
    let backup = parent.join(format!("{name}.backup"));
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    if backup.exists() {
        fs::remove_dir_all(&backup)?;
    }

    copy_directory(source, &staging)?;
    let had_destination = destination.exists();
    if had_destination {
        fs::rename(destination, &backup)?;
    }

    if let Err(error) = fs::rename(&staging, destination) {
        if had_destination {
            let _ = fs::rename(&backup, destination);
        }
        return Err(error);
    }

    if backup.exists() {
        fs::remove_dir_all(backup)?;
    }
    Ok(())
}

pub fn chrome_host_manifest_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Home directory is unavailable".to_string())?;
    Ok(home
        .join("Library/Application Support/Google/Chrome/NativeMessagingHosts")
        .join(format!("{NATIVE_HOST_NAME}.json")))
}

pub fn write_host_manifest(path: &Path, executable: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid native host path".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let staging = path.with_extension("json.staging");
    let data = serde_json::to_vec_pretty(&build_host_manifest(executable))
        .map_err(|error| error.to_string())?;
    fs::write(&staging, data).map_err(|error| error.to_string())?;
    fs::rename(staging, path).map_err(|error| error.to_string())
}

pub fn remove_owned_host_manifest(path: &Path, executable: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let value: Value = serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
        .map_err(|error| format!("Existing Chrome native host manifest is invalid: {error}"))?;
    if !manifest_is_owned(&value, executable) {
        return Err("Refusing to remove a Chrome native host owned by another installation".into());
    }
    fs::remove_file(path).map_err(|error| error.to_string())?;
    Ok(true)
}

pub fn read_preferences(path: &Path) -> IntegrationPreferences {
    fs::read(path)
        .ok()
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_default()
}

pub fn write_preferences(path: &Path, preferences: &IntegrationPreferences) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid preference path".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let staging = path.with_extension("json.staging");
    fs::write(
        &staging,
        serde_json::to_vec_pretty(preferences).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::rename(staging, path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn host_manifest_allows_only_the_bundled_extension() {
        let executable = Path::new("/Applications/Meetily.app/Contents/MacOS/meetily");
        let value = build_host_manifest(executable);
        assert_eq!(value["name"], NATIVE_HOST_NAME);
        assert_eq!(value["type"], "stdio");
        assert_eq!(
            value["allowed_origins"],
            serde_json::json!([EXTENSION_ORIGIN])
        );
        assert_eq!(value["path"], executable.to_string_lossy().as_ref());
    }

    #[test]
    fn replaces_extension_directory_without_leaving_staging_data() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let destination = temp.path().join("installed");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("manifest.json"), "new").unwrap();
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("old.js"), "old").unwrap();

        replace_directory_atomically(&source, &destination).unwrap();

        assert_eq!(
            fs::read_to_string(destination.join("manifest.json")).unwrap(),
            "new"
        );
        assert!(!destination.join("old.js").exists());
        assert!(!temp.path().join("installed.staging").exists());
    }

    #[test]
    fn removes_only_a_manifest_owned_by_this_installation() {
        let executable = Path::new("/Applications/Meetily.app/Contents/MacOS/meetily");
        assert!(manifest_is_owned(
            &build_host_manifest(executable),
            executable
        ));
        assert!(!manifest_is_owned(
            &build_host_manifest(executable),
            Path::new("/Applications/Other.app/Contents/MacOS/meetily"),
        ));
    }
}
